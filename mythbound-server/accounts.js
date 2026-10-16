// Player accounts: a username and password (no email), a recovery code for a
// forgotten password, and up to MAX_SLOTS saved heroes that follow the player
// to any device. Passwords are stored as scrypt hashes and recovery codes as
// SHA-256 (they are random); sign-ins hand out a random token, stored only as
// its SHA-256.

import { createHash, randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);

export const MAX_SLOTS = 5;
const MAX_BODY = 512 * 1024;
const MAX_SAVE = 400 * 1024;
const MAX_PROFILE = 8 * 1024;
/** Sign-ins last this long without being used. */
const SESSION_IDLE_MS = 180 * 24 * 3600 * 1000;
const USERNAME = /^[A-Za-z0-9_]{3,16}$/;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const SCRYPT = { N: 16384, r: 8, p: 1 };

/**
 * Admins (builder mode and the admin panel): these usernames, but only the
 * accounts that already existed when admin was handed out, so nobody can take
 * an unclaimed name later and become admin. ADMINS and ADMIN_BEFORE (a date)
 * in the server's environment change them.
 */
const ADMINS = (process.env.ADMINS ?? 'R88,Rock').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const ADMIN_BEFORE = process.env.ADMIN_BEFORE ? Date.parse(process.env.ADMIN_BEFORE) : Date.UTC(2026, 9, 17);
/** A build's link id: 8 letters and digits (about 40 random bits). */
const BUILD_ID = /^[a-z0-9]{8}$/;
const BUILD_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const MAX_BUILD = 300 * 1024;
const MAX_BUILDS = 50;
const MAX_EDITS = 4000;

async function hashSecret(secret) {
  const salt = randomBytes(16);
  const key = /** @type {Buffer} */ (await scrypt(secret, salt, 32, SCRYPT));
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

/**
 * Recovery codes carry 80 random bits, far too many to guess, so a plain
 * SHA-256 keeps them safe without the slow hashing passwords need (the free
 * server has a small share of one CPU).
 */
const hashCode = (code) => `sha256$${createHash('sha256').update(code).digest('hex')}`;

async function checkSecret(secret, stored) {
  const [kind, N, r, p, salt, key] = String(stored).split('$');
  if (kind === 'sha256' && N) {
    const want = Buffer.from(N, 'hex');
    const got = createHash('sha256').update(secret).digest();
    return got.length === want.length && timingSafeEqual(got, want);
  }
  if (kind !== 'scrypt' || !key) return false;
  const want = Buffer.from(key, 'base64');
  const got = /** @type {Buffer} */ (await scrypt(secret, Buffer.from(salt, 'base64'), want.length, { N: Number(N), r: Number(r), p: Number(p) }));
  return got.length === want.length && timingSafeEqual(got, want);
}

/** A recovery code like K7QM-2XRP-9TDA-HV3C (80 random bits). */
function newRecoveryCode() {
  let s = '';
  for (let i = 0; i < 16; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)] + (i % 4 === 3 && i < 15 ? '-' : '');
  return s;
}
const normCode = (c) => String(c ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

/** Only the few fields the slot list shows, cleaned. */
function cleanSummary(s) {
  const o = s && typeof s === 'object' ? s : {};
  const str = (v, n) => String(v ?? '').slice(0, n);
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return { name: str(o.name, 24), classId: str(o.classId, 16), subclassId: str(o.subclassId, 16), raceId: str(o.raceId, 16), roleId: str(o.roleId, 16), level: num(o.level), playTime: num(o.playTime), zone: str(o.zone, 24) };
}

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Counts events per key over a sliding window. */
class Limiter {
  constructor(max, windowMs) {
    this.max = max;
    this.windowMs = windowMs;
    /** @type {Map<string, number[]>} */
    this.hits = new Map();
  }
  /** Records a hit; false when the key is over its limit. */
  hit(key, now) {
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    list.push(now);
    this.hits.set(key, list);
    if (this.hits.size > 20000) this.sweep(now);
    return list.length <= this.max;
  }
  count(key, now) {
    return (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs).length;
  }
  clear(key) {
    this.hits.delete(key);
  }
  sweep(now) {
    for (const [k, list] of this.hits) if (!list.some((t) => now - t < this.windowMs)) this.hits.delete(k);
  }
}

/**
 * The /api routes. Returns an HTTP handler that answers true when it handled
 * the request.
 * @param {import('./store.js').Store} store
 */
export function accountsApi(store, { now = () => Date.now(), admins = ADMINS, adminBefore = ADMIN_BEFORE } = {}) {
  const adminSet = new Set(admins.map((a) => a.toLowerCase()));
  /** @param {import('./store.js').User} user */
  const isAdmin = (user) => adminSet.has(user.username.toLowerCase()) && Number(user.createdAt) < adminBefore;

  async function admin(req) {
    const a = await auth(req);
    if (!isAdmin(a.user)) throw new HttpError(403, 'not-admin', 'Only admins can do that.');
    return a;
  }

  /** A build's edits: a list of small flat objects (the game checks each one again when it loads them). */
  function cleanBuild(body) {
    const name = String(body.name ?? 'My build').trim().slice(0, 40) || 'My build';
    const edits = Array.isArray(body.edits) ? body.edits : null;
    if (!edits || edits.length > MAX_EDITS) throw new HttpError(400, 'bad-build', 'A build is a list of up to 4000 changes.');
    const clean = edits.map((e) => {
      const o = {};
      if (!e || typeof e !== 'object') return o;
      for (const [k, v] of Object.entries(e).slice(0, 12)) {
        if (typeof v === 'number' && Number.isFinite(v)) o[String(k).slice(0, 12)] = Math.round(v * 1000) / 1000;
        else if (typeof v === 'string') o[String(k).slice(0, 12)] = v.slice(0, 32);
      }
      return o;
    });
    const data = JSON.stringify(clean);
    if (data.length > MAX_BUILD) throw new HttpError(413, 'too-big', 'This build is too large.');
    return { name, data };
  }

  const newBuildId = () => Array.from({ length: 8 }, () => BUILD_ALPHABET[randomInt(BUILD_ALPHABET.length)]).join('');
  const buildId = (s) => {
    if (!BUILD_ID.test(String(s))) throw new HttpError(404, 'no-build', 'There is no such build.');
    return String(s);
  };
  const perIp = new Limiter(240, 60_000);
  const authPerIp = new Limiter(30, 10 * 60_000);
  // Families and friends often share one address: room for a few accounts each.
  const signupPerIp = new Limiter(20, 60 * 60_000);
  const failsPerUser = new Limiter(8, 10 * 60_000);

  async function auth(req) {
    const m = /^Bearer\s+(\S+)$/.exec(req.headers.authorization ?? '');
    if (!m) throw new HttpError(401, 'signed-out', 'Please log in.');
    const tokenHash = sha256(m[1]);
    const s = await store.findSession(tokenHash);
    const t = now();
    if (!s || t - s.lastUsed > SESSION_IDLE_MS) throw new HttpError(401, 'signed-out', 'Please log in again.');
    // Note the use at most once an hour (fewer database writes).
    if (t - s.lastUsed > 3600_000) await store.touchSession(tokenHash, t);
    const user = await store.userById(s.userId);
    if (!user) throw new HttpError(401, 'signed-out', 'Please log in again.');
    return { user, tokenHash };
  }

  async function newSession(userId) {
    const token = randomBytes(32).toString('base64url');
    await store.createSession(sha256(token), userId, now());
    return token;
  }

  const slotNumber = (s) => {
    const n = Number(s);
    if (!Number.isInteger(n) || n < 0 || n >= MAX_SLOTS) throw new HttpError(404, 'no-slot', 'There is no such slot.');
    return n;
  };

  const routes = {
    async 'POST /api/signup'(req, body, ip) {
      const username = String(body.username ?? '').trim();
      const password = String(body.password ?? '');
      if (!USERNAME.test(username)) throw new HttpError(400, 'username', 'Usernames are 3 to 16 letters, numbers or _.');
      if (password.length < 6 || password.length > 128) throw new HttpError(400, 'password', 'Passwords need at least 6 characters.');
      if (!signupPerIp.hit(ip, now())) throw new HttpError(429, 'slow-down', 'Too many new accounts from here. Try again later.');
      const recovery = newRecoveryCode();
      const id = await store.createUser({ username, passHash: await hashSecret(password), recoveryHash: hashCode(normCode(recovery)), createdAt: now() });
      if (id === null) throw new HttpError(409, 'taken', 'That username is taken. If you just made it, use Log in instead; otherwise try another name.');
      return [201, { token: await newSession(id), username, recovery, admin: isAdmin({ username, createdAt: now() }) }];
    },

    async 'POST /api/login'(req, body) {
      const username = String(body.username ?? '').trim();
      const password = String(body.password ?? '');
      const key = username.toLowerCase();
      if (failsPerUser.count(key, now()) >= 8) throw new HttpError(429, 'locked', 'Too many wrong passwords. Wait a few minutes and try again.');
      const user = USERNAME.test(username) ? await store.findUser(username) : null;
      if (!user || !(await checkSecret(password, user.passHash))) {
        failsPerUser.hit(key, now());
        throw new HttpError(401, 'wrong', 'Wrong username or password.');
      }
      failsPerUser.clear(key);
      return [200, { token: await newSession(user.id), username: user.username, admin: isAdmin(user) }];
    },

    async 'POST /api/recover'(req, body) {
      const username = String(body.username ?? '').trim();
      const password = String(body.password ?? '');
      const key = `recover:${username.toLowerCase()}`;
      if (failsPerUser.count(key, now()) >= 8) throw new HttpError(429, 'locked', 'Too many tries. Wait a few minutes and try again.');
      if (password.length < 6 || password.length > 128) throw new HttpError(400, 'password', 'Passwords need at least 6 characters.');
      const user = USERNAME.test(username) ? await store.findUser(username) : null;
      if (!user || !(await checkSecret(normCode(body.recovery), user.recoveryHash))) {
        failsPerUser.hit(key, now());
        throw new HttpError(401, 'wrong', 'That username and recovery code do not match.');
      }
      failsPerUser.clear(key);
      // A fresh code replaces the used one, and every old sign-in ends.
      const recovery = newRecoveryCode();
      await store.setSecrets(user.id, await hashSecret(password), hashCode(normCode(recovery)));
      await store.deleteSessions(user.id);
      return [200, { token: await newSession(user.id), username: user.username, recovery }];
    },

    async 'POST /api/logout'(req) {
      const { tokenHash } = await auth(req);
      await store.deleteSession(tokenHash);
      return [200, { ok: true }];
    },

    async 'GET /api/me'(req) {
      const { user } = await auth(req);
      return [200, { username: user.username, profile: user.profile ?? {}, admin: isAdmin(user) }];
    },

    async 'PUT /api/me'(req, body) {
      const { user } = await auth(req);
      const profile = body.profile && typeof body.profile === 'object' ? body.profile : {};
      if (JSON.stringify(profile).length > MAX_PROFILE) throw new HttpError(413, 'too-big', 'Profile too large.');
      await store.setProfile(user.id, profile);
      return [200, { ok: true }];
    },

    async 'GET /api/slots'(req) {
      const { user } = await auth(req);
      return [200, { max: MAX_SLOTS, slots: await store.listSlots(user.id) }];
    },

    async 'GET /api/slot'(req, body, ip, n) {
      const { user } = await auth(req);
      const s = await store.getSlot(user.id, slotNumber(n));
      if (!s) throw new HttpError(404, 'empty', 'That slot is empty.');
      return [200, { save: JSON.parse(s.data), updatedAt: s.updatedAt }];
    },

    async 'PUT /api/slot'(req, body, ip, n) {
      const { user } = await auth(req);
      const slot = slotNumber(n);
      if (!body.save || typeof body.save !== 'object') throw new HttpError(400, 'bad-save', 'Nothing to save.');
      const data = JSON.stringify(body.save);
      if (data.length > MAX_SAVE) throw new HttpError(413, 'too-big', 'This save is too large.');
      const base = Number.isInteger(body.base) && body.base >= 0 ? body.base : 0;
      const r = await store.putSlot(user.id, slot, data, cleanSummary(body.summary), base, now());
      if ('conflict' in r) return [409, { error: 'conflict', message: 'This hero was saved from another device since you loaded it.', updatedAt: r.conflict }];
      return [200, { updatedAt: r.updatedAt }];
    },

    async 'DELETE /api/slot'(req, body, ip, n) {
      const { user } = await auth(req);
      await store.deleteSlot(user.id, slotNumber(n));
      return [200, { ok: true }];
    },

    // Builder mode's saved worlds: anyone with the link can play one; admins make and save them.
    async 'GET /api/build'(req, body, ip, id) {
      const b = await store.getBuild(buildId(id));
      if (!b) throw new HttpError(404, 'no-build', 'There is no such build.');
      return [200, { id: b.id, name: b.name, owner: b.owner, edits: JSON.parse(b.data), updatedAt: b.updatedAt }];
    },

    async 'GET /api/builds'(req) {
      const { user } = await admin(req);
      return [200, { builds: await store.listBuilds(user.id) }];
    },

    async 'POST /api/builds'(req, body) {
      const { user } = await admin(req);
      if ((await store.listBuilds(user.id)).length >= MAX_BUILDS) throw new HttpError(409, 'full', `You have ${MAX_BUILDS} builds already. Delete one first.`);
      const { name, data } = cleanBuild(body);
      for (let tries = 0; tries < 5; tries++) {
        const id = newBuildId();
        if (await store.createBuild({ id, ownerId: user.id, name, data, now: now() })) return [201, { id, name, updatedAt: now() }];
      }
      throw new HttpError(503, 'unavailable', 'Could not save the build. Try again.');
    },

    async 'PUT /api/build'(req, body, ip, id) {
      const { user } = await admin(req);
      const b = await store.getBuild(buildId(id));
      if (!b) throw new HttpError(404, 'no-build', 'There is no such build.');
      if (b.ownerId !== user.id) throw new HttpError(403, 'not-yours', 'This build belongs to someone else. Save it as a new build instead.');
      const { name, data } = cleanBuild(body);
      return [200, { id: b.id, name, updatedAt: await store.putBuild(b.id, name, data, now()) }];
    },

    async 'DELETE /api/build'(req, body, ip, id) {
      const { user } = await admin(req);
      const b = await store.getBuild(buildId(id));
      if (b && b.ownerId !== user.id) throw new HttpError(403, 'not-yours', 'This build belongs to someone else.');
      if (b) await store.deleteBuild(b.id);
      return [200, { ok: true }];
    },
  };

  const send = (res, status, obj) => {
    res.writeHead(status, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    });
    res.end(JSON.stringify(obj));
  };

  const readBody = (req) =>
    new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) {
          reject(new HttpError(413, 'too-big', 'Request too large.'));
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => {
        if (!chunks.length) return resolve({});
        try {
          const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          resolve(v && typeof v === 'object' ? v : {});
        } catch {
          reject(new HttpError(400, 'bad-json', 'Could not read the request.'));
        }
      });
      req.on('error', reject);
    });

  /** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res */
  return async function handle(req, res) {
    const path = (req.url ?? '/').split('?')[0];
    if (!path.startsWith('/api/')) return false;
    if (req.method === 'OPTIONS') {
      // The browser's permission check before a cross-site request (logged too: if it fails, nothing else arrives).
      console.log(`api OPTIONS ${path} 204 (asks for ${req.headers['access-control-request-method'] ?? '?'} from ${req.headers.origin ?? '?'})`);
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'access-control-allow-headers': 'content-type, authorization',
        'access-control-max-age': '600',
      });
      res.end();
      return true;
    }
    const ip = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket.remoteAddress || '?';
    const started = Date.now();
    // One line per request for the host's logs (never names, passwords or tokens).
    const log = (status, code = '') => console.log(`api ${req.method} ${path} ${status}${code ? ` ${code}` : ''} ${Date.now() - started}ms`);
    try {
      if (!perIp.hit(ip, now())) throw new HttpError(429, 'slow-down', 'Too many requests. Slow down a little.');
      const slot = /^\/api\/slots\/(\d+)$/.exec(path);
      const build = /^\/api\/builds\/([^/]+)$/.exec(path);
      const route = routes[slot ? `${req.method} /api/slot` : build ? `${req.method} /api/build` : `${req.method} ${path}`];
      if (!route) throw new HttpError(404, 'not-found', 'Not found.');
      if (/^\/api\/(signup|login|recover)$/.test(path) && !authPerIp.hit(ip, now())) throw new HttpError(429, 'slow-down', 'Too many tries. Wait a few minutes.');
      const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await readBody(req);
      const [status, out] = await route(req, body, ip, slot?.[1] ?? build?.[1]);
      send(res, status, out);
      log(status, out?.error);
    } catch (err) {
      if (err instanceof HttpError) {
        send(res, err.status, { error: err.code, message: err.message });
        log(err.status, err.code);
      } else {
        log(503, 'error');
        console.error('Accounts error:', err);
        send(res, 503, { error: 'unavailable', message: 'The account service had a problem. Try again in a moment.' });
      }
    }
    return true;
  };
}
