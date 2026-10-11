// Player accounts on the Mythbound server: sign-in, the hero slots kept there,
// and uploading saves while playing. The server is the co-op relay (see
// mythbound-server/accounts.js); its address comes from the Co-op settings.

import { DEFAULT_SERVER, httpBase, PAGES_URL, wakeServer } from './net';
import { normalizeSave, readLocal, serializeSave, writeLocal, type SaveData } from './state';

const SESSION_KEY = 'mythbound.account.v1';

export interface SlotSummary {
  name: string;
  classId: string;
  subclassId: string;
  raceId: string;
  roleId: string;
  level: number;
  playTime: number;
  zone: string;
}

export interface SlotInfo {
  slot: number;
  summary: SlotSummary;
  updatedAt: number;
}

export interface Profile {
  unlocks?: { ancient?: boolean };
}

export class CloudError extends Error {
  constructor(public code: string, message: string, public status = 0) {
    super(message);
  }
}

/** What the slot list shows for a save. */
export function summarize(data: SaveData): SlotSummary {
  const c = data.character;
  return { name: c.name, classId: c.classId, subclassId: c.subclassId ?? '', raceId: c.raceId, roleId: c.roleId, level: c.level, playTime: Math.round(data.world.playTime), zone: '' };
}

export class Cloud {
  session: { username: string; token: string } | null = readLocal(SESSION_KEY);
  /** Set once the server has answered (accounts on or off). */
  private awake: { accounts: boolean } | null = null;
  /** A wake-up in progress, shared by everyone waiting for it. */
  private waking: Promise<{ accounts: boolean } | null> | null = null;
  /** Who hears how the wake-up is going (the form on screen). */
  private wakeStatus: (text: string) => void = () => {};

  constructor(private server: () => string) {}

  get base() {
    return httpBase(this.server() || DEFAULT_SERVER);
  }

  get signedIn() {
    return !!this.session;
  }

  /** The device key for this account's copy of a slot (kept in case the upload can't happen). */
  localKey(slot: number) {
    return `mythbound.cloud.${this.session?.username.toLowerCase() ?? 'none'}.${slot}`;
  }

  /**
   * Starts waking the server in the background (a free server naps when
   * nobody plays and takes a minute to start), so it is usually up by the
   * time a name and password are typed.
   */
  warm() {
    if (this.awake || this.waking) return this.waking;
    this.waking = wakeServer(this.server() || DEFAULT_SERVER, (t) => this.wakeStatus(t)).then((r) => {
      this.awake = r;
      this.waking = null;
      return r;
    });
    return this.waking;
  }

  /** Wakes the server if needed and checks that accounts are on. */
  async ready(status: (text: string) => void) {
    if (this.awake?.accounts) return;
    this.wakeStatus = status;
    // Ask again if it last said accounts were off (the database may be back).
    if (this.awake && !this.awake.accounts) this.awake = null;
    if (!this.awake) await this.warm();
    this.wakeStatus = () => {};
    if (!this.awake) {
      const sandboxed = !/github\.io$|^localhost$|^127\.0\.0\.1$/.test(location.hostname);
      throw new CloudError('offline', sandboxed ? `This copy of the game can't go online. Accounts work at ${PAGES_URL}` : 'The server did not answer. Check your internet, or try again in a minute.');
    }
    if (!this.awake.accounts) throw new CloudError('no-accounts', 'Accounts are not available on the server right now (its database is missing or down). You can play offline meanwhile.');
  }

  private async call<T>(method: string, path: string, body?: unknown, o: { keepalive?: boolean } = {}): Promise<T> {
    let res: Response;
    // Never wait forever: a request the server hasn't answered in 40 s has failed.
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 40_000);
    try {
      res = await fetch(this.base + path, {
        method,
        headers: { 'content-type': 'application/json', ...(this.session ? { authorization: `Bearer ${this.session.token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store',
        keepalive: o.keepalive,
        signal: ctl.signal,
      });
    } catch {
      // It may be asleep again: wake it before the next try.
      this.awake = null;
      if (ctl.signal.aborted) throw new CloudError('timeout', 'The server took too long to answer. Try again in a moment.');
      throw new CloudError('network', 'Could not reach the server. Check your internet connection.');
    } finally {
      clearTimeout(timer);
    }
    const out = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string };
    if (!res.ok) {
      if (res.status === 401 && out.error === 'signed-out') this.forget();
      throw new CloudError(out.error ?? 'error', out.message ?? `The server said no (${res.status}).`, res.status);
    }
    return out;
  }

  private remember(username: string, token: string) {
    this.session = { username, token };
    writeLocal(SESSION_KEY, this.session);
  }

  /** Signs out on this device only. */
  forget() {
    this.session = null;
    writeLocal(SESSION_KEY, null);
  }

  async signup(username: string, password: string): Promise<string> {
    const r = await this.call<{ token: string; username: string; recovery: string }>('POST', '/api/signup', { username, password });
    this.remember(r.username, r.token);
    return r.recovery;
  }

  async login(username: string, password: string) {
    const r = await this.call<{ token: string; username: string }>('POST', '/api/login', { username, password });
    this.remember(r.username, r.token);
  }

  /** Sets a new password with the recovery code; returns the new recovery code. */
  async recover(username: string, recovery: string, password: string): Promise<string> {
    const r = await this.call<{ token: string; username: string; recovery: string }>('POST', '/api/recover', { username, recovery, password });
    this.remember(r.username, r.token);
    return r.recovery;
  }

  async logout() {
    try {
      await this.call('POST', '/api/logout');
    } catch {
      /* signed out here either way */
    }
    this.forget();
  }

  async profile(): Promise<Profile> {
    return (await this.call<{ profile: Profile }>('GET', '/api/me')).profile ?? {};
  }

  async setProfile(profile: Profile) {
    await this.call('PUT', '/api/me', { profile });
  }

  async slots(): Promise<{ max: number; slots: SlotInfo[] }> {
    return this.call('GET', '/api/slots');
  }

  async load(slot: number): Promise<{ save: SaveData; updatedAt: number }> {
    const r = await this.call<{ save: SaveData; updatedAt: number }>('GET', `/api/slots/${slot}`);
    return { save: normalizeSave(r.save), updatedAt: r.updatedAt };
  }

  /** Saves over the version `base` (0 for an empty slot). Resolves with the new version. */
  async store(slot: number, data: SaveData, base: number, o: { keepalive?: boolean } = {}): Promise<number> {
    const save = serializeSave(data);
    const body = { save, summary: summarize(data), base };
    // Keep-alive requests (sent as the page closes) are limited to 64 kB.
    const keepalive = o.keepalive && JSON.stringify(body).length < 60_000;
    return (await this.call<{ updatedAt: number }>('PUT', `/api/slots/${slot}`, body, { keepalive })).updatedAt;
  }

  async remove(slot: number) {
    await this.call('DELETE', `/api/slots/${slot}`);
  }
}

/**
 * Uploads a hero's saves to its account slot while playing: at most every 20
 * seconds, at once when the page is hidden or closed, and never over a
 * newer save made on another device.
 */
export class SlotSync {
  private pending: SaveData | null = null;
  private busy = false;
  private lastPush = 0;
  private timer = 0;
  private stopped = false;

  constructor(private cloud: Cloud, private slot: number, private version: number, private notify: (text: string, kind?: string) => void) {
    document.addEventListener('visibilitychange', this.onHidden);
    window.addEventListener('pagehide', this.onLeave);
  }

  /** A new save to upload (the latest one wins). */
  push(data: SaveData) {
    if (this.stopped) return;
    this.pending = data;
    const wait = Math.max(0, 20_000 - (Date.now() - this.lastPush));
    if (!this.busy && !this.timer) this.timer = window.setTimeout(() => this.send(), wait);
  }

  /** Sends what is waiting right now (leaving the game, hiding the page). */
  flush(keepalive = false) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = 0;
    void this.send(keepalive);
  }

  dispose() {
    this.flush(true);
    document.removeEventListener('visibilitychange', this.onHidden);
    window.removeEventListener('pagehide', this.onLeave);
  }

  // Phones may close a hidden page without warning: send what's waiting first.
  private onHidden = () => {
    if (document.visibilityState === 'hidden') this.flush(true);
  };
  private onLeave = () => this.flush(true);

  private async send(keepalive = false) {
    this.timer = 0;
    const data = this.pending;
    if (!data || this.busy || this.stopped) return;
    this.busy = true;
    this.pending = null;
    this.lastPush = Date.now();
    try {
      this.version = await this.cloud.store(this.slot, data, this.version, { keepalive });
    } catch (err) {
      const e = err as CloudError;
      if (e.code === 'conflict' || e.status === 409) {
        this.stopped = true;
        this.notify('This hero was saved on another device. Progress here stays on this device only: return to the title and load the hero again.', 'warn');
      } else if (e.code === 'signed-out') {
        this.stopped = true;
        this.notify('You were signed out, so this hero is only saving on this device. Log in again from the title screen.', 'warn');
      } else {
        // The network or server hiccupped: try again a little later.
        if (!this.pending) this.pending = data;
      }
    } finally {
      this.busy = false;
      if (this.pending && !this.stopped && !this.timer) this.timer = window.setTimeout(() => this.send(), 20_000);
    }
  }
}
