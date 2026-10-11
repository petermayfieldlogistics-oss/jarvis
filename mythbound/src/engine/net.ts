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

/** The server's health address for a WebSocket address (used to wake a sleeping free server). */
export function healthUrl(ws: string): string {
  try {
    const u = new URL(ws);
    u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:';
    u.pathname = '/health';
    u.search = '';
    return u.toString();
  } catch {
    return '';
  }
}

export class Net {
  private ws: WebSocket | null = null;
  /** Called for every message from the server. */
  onMessage: (m: ServerMsg) => void = () => {};
  /** Called once when an open connection drops. */
  onDrop: () => void = () => {};

  get open() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Wakes the server (free servers sleep after a quiet spell and take up to a
   * minute to start) and opens the connection.
   */
  async connect(url: string, status: (text: string) => void): Promise<void> {
    this.close();
    if (!/^wss?:\/\//.test(url)) throw new Error('The server address must start with wss://');
    const health = healthUrl(url);
    if (health) {
      // A sleeping free server shows a loading page for a while; wait for the relay itself to answer.
      const start = Date.now();
      const deadline = start + 150_000;
      let awake = false;
      while (!awake && Date.now() < deadline) {
        status(`Waking the server… ${Math.round((Date.now() - start) / 1000)} s (it can take a minute or two)`);
        try {
          const ctl = new AbortController();
          const timer = setTimeout(() => ctl.abort(), 25_000);
          const r = await fetch(health, { cache: 'no-store', signal: ctl.signal });
          clearTimeout(timer);
          const body = r.ok ? await r.json().catch(() => null) : null;
          awake = !!body && body.game === 'mythbound';
        } catch {
          // Asleep, starting up, or the loading page: wait and try again.
        }
        if (!awake) await new Promise((res) => setTimeout(res, 3000));
      }
      // Even without an answer, try the connection itself before giving up.
    }
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
        if (m && typeof m === 'object' && typeof m.t === 'string') this.onMessage(m);
      };
    });
  }

  create(name: string) {
    this.raw({ t: 'create', name, version: PROTOCOL_VERSION });
  }

  join(room: string, name: string) {
    this.raw({ t: 'join', room, name, version: PROTOCOL_VERSION });
  }

  send(to: Destination, d: unknown) {
    this.raw({ t: 'send', to, d });
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

  private raw(m: object) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }
}
