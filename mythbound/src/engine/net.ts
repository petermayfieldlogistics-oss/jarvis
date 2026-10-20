// The connection to the co-op relay server (mythbound-server). The server
// only makes rooms and passes messages along; the host's game runs the world.

export const PROTOCOL_VERSION = 1;
export const DEFAULT_SERVER = 'wss://mythbound-server.onrender.com/ws';
/** Where the game is published with co-op working (the artifact page blocks outside connections). */
export const PAGES_URL = 'https://petermayfieldlogistics-oss.github.io/jarvis/mythbound/';

export interface PeerInfo {
  id: number;
  name: string;
}

export type ServerMsg =
  | { t: 'created'; room: string; id: number }
  | { t: 'joined'; room: string; id: number; hostId: number; players: PeerInfo[] }
  | { t: 'peer-join'; id: number; name: string }
  | { t: 'peer-leave'; id: number }
  | { t: 'msg'; from: number; d: unknown }
  | { t: 'closed'; reason: string }
  | { t: 'error'; code: string; message: string };

export type Destination = 'host' | 'all' | number;

/**
 * The relay's WebSocket address from whatever was typed in the Co-op server
 * box: a bare host, an https:// link or a wss:// address all work. A secure
 * page can only talk to secure addresses, so http/ws are upgraded except for
 * a server on this computer.
 */
export function serverUrl(input?: string): string {
  let text = (input ?? '').trim();
  if (!text) return DEFAULT_SERVER;
  if (!/^[a-z]+:\/\//i.test(text)) text = `wss://${text}`;
  try {
    const u = new URL(text);
    const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname);
    const secure = typeof location === 'undefined' || location.protocol === 'https:';
    if (u.protocol === 'https:' || u.protocol === 'wss:') u.protocol = 'wss:';
    else if (u.protocol === 'http:' || u.protocol === 'ws:') u.protocol = secure && !local ? 'wss:' : 'ws:';
    else return DEFAULT_SERVER;
    // A pasted page link (the site itself, or its /health check) means the relay at /ws.
    if (u.pathname === '/' || u.pathname === '' || u.pathname === '/health') u.pathname = '/ws';
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch {
    return DEFAULT_SERVER;
  }
}

/** The server's health address for a WebSocket address (used to wake a sleeping free server). */
export function healthUrl(ws: string): string {
  try {
    const u = new URL(serverUrl(ws));
    u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:';
    u.pathname = '/health';
    u.search = '';
    return u.toString();
  } catch {
    return '';
  }
}

/**
 * Waits for a free server that may be asleep (it shows a loading page for a
 * minute or two while it starts). Resolves with what its health check says,
 * or null if it never answered.
 */
export async function wakeServer(wsUrl: string, status: (text: string) => void, limitMs = 150_000): Promise<{ accounts: boolean } | null> {
  const health = healthUrl(wsUrl);
  if (!health) return null;
  const start = Date.now();
  while (Date.now() - start < limitMs) {
    const waited = Math.round((Date.now() - start) / 1000);
    status(waited < 3 ? 'Reaching the server…' : `Waking the server… ${waited} s (it can take a minute or two)`);
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 25_000);
      const r = await fetch(health, { cache: 'no-store', signal: ctl.signal });
      clearTimeout(timer);
      const body = r.ok ? await r.json().catch(() => null) : null;
      if (body && body.game === 'mythbound') return { accounts: body.accounts === true };
    } catch {
      // Asleep, starting up, or the loading page: wait and try again.
    }
    await new Promise((res) => setTimeout(res, 3000));
  }
  return null;
}

/** The server's web address (https://…) for its WebSocket address. */
export function httpBase(ws: string): string {
  try {
    const u = new URL(serverUrl(ws));
    u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:';
    return u.origin;
  } catch {
    return '';
  }
}

export class Net {
  private ws: WebSocket | null = null;
  /** Called for every message from the server (`size`: its length, to measure what a line carries). */
  onMessage: (m: ServerMsg, size: number) => void = () => {};
  /** Called once when an open connection drops. */
  onDrop: () => void = () => {};

  get open() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** Bytes sent but still waiting to go out (our own upload is the limit when this grows). */
  get backlog() {
    return this.ws?.bufferedAmount ?? 0;
  }

  /**
   * Wakes the server (free servers sleep after a quiet spell and take up to a
   * minute to start) and opens the connection.
   */
  async connect(address: string, status: (text: string) => void): Promise<void> {
    this.close();
    const url = serverUrl(address);
    await wakeServer(url, status);
    // Even without an answer, try the connection itself before giving up.
    status('Connecting…');
    await new Promise<void>((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch {
        reject(new Error('This page is not allowed to connect to the server.'));
        return;
      }
      this.ws = ws;
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error('The server is not answering. If this keeps happening, check that it shows "Live" on Render.'));
      }, 30_000);
      ws.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error('Could not connect to the server. It may still be waking up: try again in a minute.'));
      };
      ws.onclose = () => {
        clearTimeout(timer);
        if (this.ws === ws) {
          this.ws = null;
          this.onDrop();
        }
      };
      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return;
        let m: ServerMsg;
        try {
          m = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (m && typeof m === 'object' && typeof m.t === 'string') this.onMessage(m, ev.data.length);
      };
    });
  }

  create(name: string) {
    this.raw({ t: 'create', name, version: PROTOCOL_VERSION });
  }

  join(room: string, name: string) {
    this.raw({ t: 'join', room, name, version: PROTOCOL_VERSION });
  }

  /** Sends `d` to `to`; returns the bytes it took (0 when not connected). */
  send(to: Destination, d: unknown): number {
    return this.raw({ t: 'send', to, d });
  }

  close() {
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;
    try {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'leave' }));
      ws.close();
    } catch {
      /* already gone */
    }
  }

  private raw(m: object): number {
    if (this.ws?.readyState !== WebSocket.OPEN) return 0;
    const text = JSON.stringify(m);
    this.ws.send(text);
    return text.length;
  }
}
