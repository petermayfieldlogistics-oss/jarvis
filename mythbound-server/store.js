// Where accounts and saved heroes are kept: PostgreSQL in production (a free
// Neon database, given to the server as DATABASE_URL), or memory for tests.
// Times are whole milliseconds; a slot's updatedAt doubles as its version.

/**
 * @typedef {{ id: number, username: string, passHash: string, recoveryHash: string, profile: object }} User
 * @typedef {{ slot: number, summary: object, updatedAt: number }} SlotInfo
 * @typedef {{
 *   init(): Promise<void>,
 *   close(): Promise<void>,
 *   createUser(u: { username: string, passHash: string, recoveryHash: string }): Promise<number | null>,
 *   findUser(username: string): Promise<User | null>,
 *   userById(id: number): Promise<User | null>,
 *   setSecrets(id: number, passHash: string, recoveryHash: string): Promise<void>,
 *   setProfile(id: number, profile: object): Promise<void>,
 *   createSession(tokenHash: string, userId: number, now: number): Promise<void>,
 *   findSession(tokenHash: string): Promise<{ userId: number, lastUsed: number } | null>,
 *   touchSession(tokenHash: string, now: number): Promise<void>,
 *   deleteSession(tokenHash: string): Promise<void>,
 *   deleteSessions(userId: number): Promise<void>,
 *   listSlots(userId: number): Promise<SlotInfo[]>,
 *   getSlot(userId: number, slot: number): Promise<{ data: string, updatedAt: number } | null>,
 *   putSlot(userId: number, slot: number, data: string, summary: object, base: number, now: number): Promise<{ updatedAt: number } | { conflict: number }>,
 *   deleteSlot(userId: number, slot: number): Promise<void>,
 * }} Store
 */

/** @returns {Store} */
export function memoryStore() {
  /** @type {Map<number, User>} */
  const users = new Map();
  /** @type {Map<string, { userId: number, lastUsed: number }>} */
  const sessions = new Map();
  /** @type {Map<string, { data: string, summary: object, updatedAt: number }>} */
  const slots = new Map();
  let nextId = 1;
  const key = (u, s) => `${u}:${s}`;
  return {
    async init() {},
    async close() {},
    async createUser({ username, passHash, recoveryHash }) {
      for (const u of users.values()) if (u.username.toLowerCase() === username.toLowerCase()) return null;
      const id = nextId++;
      users.set(id, { id, username, passHash, recoveryHash, profile: {} });
      return id;
    },
    async findUser(username) {
      for (const u of users.values()) if (u.username.toLowerCase() === username.toLowerCase()) return { ...u };
      return null;
    },
    async userById(id) {
      const u = users.get(id);
      return u ? { ...u } : null;
    },
    async setSecrets(id, passHash, recoveryHash) {
      const u = users.get(id);
      if (u) Object.assign(u, { passHash, recoveryHash });
    },
    async setProfile(id, profile) {
      const u = users.get(id);
      if (u) u.profile = profile;
    },
    async createSession(tokenHash, userId, now) {
      sessions.set(tokenHash, { userId, lastUsed: now });
    },
    async findSession(tokenHash) {
      const s = sessions.get(tokenHash);
      return s ? { ...s } : null;
    },
    async touchSession(tokenHash, now) {
      const s = sessions.get(tokenHash);
      if (s) s.lastUsed = now;
    },
    async deleteSession(tokenHash) {
      sessions.delete(tokenHash);
    },
    async deleteSessions(userId) {
      for (const [k, s] of sessions) if (s.userId === userId) sessions.delete(k);
    },
    async listSlots(userId) {
      const out = [];
      for (const [k, v] of slots) {
        const [u, s] = k.split(':').map(Number);
        if (u === userId) out.push({ slot: s, summary: v.summary, updatedAt: v.updatedAt });
      }
      return out.sort((a, b) => a.slot - b.slot);
    },
    async getSlot(userId, slot) {
      const v = slots.get(key(userId, slot));
      return v ? { data: v.data, updatedAt: v.updatedAt } : null;
    },
    async putSlot(userId, slot, data, summary, base, now) {
      const k = key(userId, slot);
      const cur = slots.get(k);
      if ((cur ? cur.updatedAt : 0) !== base) return { conflict: cur ? cur.updatedAt : 0 };
      const updatedAt = Math.max(now, base + 1);
      slots.set(k, { data, summary, updatedAt });
      return { updatedAt };
    },
    async deleteSlot(userId, slot) {
      slots.delete(key(userId, slot));
    },
  };
}

/** @returns {Promise<Store>} */
export async function pgStore(url) {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: url, max: 5, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 20_000 });
  // A dropped idle connection (the database napping) must not take the server down.
  pool.on('error', (err) => console.error('Database connection error:', err.message));
  const q = (text, params) => pool.query(text, params);
  const user = (r) => r && { id: r.id, username: r.username, passHash: r.pass_hash, recoveryHash: r.recovery_hash, profile: r.profile ?? {} };
  return {
    async init() {
      await q(`CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT NOT NULL,
        username_key TEXT NOT NULL UNIQUE,
        pass_hash TEXT NOT NULL,
        recovery_hash TEXT NOT NULL,
        profile JSONB NOT NULL DEFAULT '{}',
        created_at BIGINT NOT NULL
      )`);
      await q(`CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        last_used BIGINT NOT NULL
      )`);
      await q('CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)');
      await q(`CREATE TABLE IF NOT EXISTS slots (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        slot SMALLINT NOT NULL,
        data TEXT NOT NULL,
        summary JSONB NOT NULL,
        updated_at BIGINT NOT NULL,
        PRIMARY KEY (user_id, slot)
      )`);
    },
    async close() {
      await pool.end();
    },
    async createUser({ username, passHash, recoveryHash }) {
      const r = await q(
        `INSERT INTO users (username, username_key, pass_hash, recovery_hash, created_at) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (username_key) DO NOTHING RETURNING id`,
        [username, username.toLowerCase(), passHash, recoveryHash, Date.now()],
      );
      return r.rows[0]?.id ?? null;
    },
    async findUser(username) {
      const r = await q('SELECT * FROM users WHERE username_key = $1', [username.toLowerCase()]);
      return user(r.rows[0]) ?? null;
    },
    async userById(id) {
      const r = await q('SELECT * FROM users WHERE id = $1', [id]);
      return user(r.rows[0]) ?? null;
    },
    async setSecrets(id, passHash, recoveryHash) {
      await q('UPDATE users SET pass_hash = $2, recovery_hash = $3 WHERE id = $1', [id, passHash, recoveryHash]);
    },
    async setProfile(id, profile) {
      await q('UPDATE users SET profile = $2 WHERE id = $1', [id, JSON.stringify(profile)]);
    },
    async createSession(tokenHash, userId, now) {
      await q('INSERT INTO sessions (token_hash, user_id, last_used) VALUES ($1, $2, $3)', [tokenHash, userId, now]);
    },
    async findSession(tokenHash) {
      const r = await q('SELECT user_id, last_used FROM sessions WHERE token_hash = $1', [tokenHash]);
      const s = r.rows[0];
      return s ? { userId: s.user_id, lastUsed: Number(s.last_used) } : null;
    },
    async touchSession(tokenHash, now) {
      await q('UPDATE sessions SET last_used = $2 WHERE token_hash = $1', [tokenHash, now]);
    },
    async deleteSession(tokenHash) {
      await q('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
    },
    async deleteSessions(userId) {
      await q('DELETE FROM sessions WHERE user_id = $1', [userId]);
    },
    async listSlots(userId) {
      const r = await q('SELECT slot, summary, updated_at FROM slots WHERE user_id = $1 ORDER BY slot', [userId]);
      return r.rows.map((s) => ({ slot: s.slot, summary: s.summary, updatedAt: Number(s.updated_at) }));
    },
    async getSlot(userId, slot) {
      const r = await q('SELECT data, updated_at FROM slots WHERE user_id = $1 AND slot = $2', [userId, slot]);
      const s = r.rows[0];
      return s ? { data: s.data, updatedAt: Number(s.updated_at) } : null;
    },
    async putSlot(userId, slot, data, summary, base, now) {
      const updatedAt = Math.max(now, base + 1);
      // Only overwrite the version the player last saw, so two devices can't silently undo each other.
      if (base > 0) {
        const r = await q(
          'UPDATE slots SET data = $3, summary = $4, updated_at = $6 WHERE user_id = $1 AND slot = $2 AND updated_at = $5 RETURNING updated_at',
          [userId, slot, data, JSON.stringify(summary), base, updatedAt],
        );
        if (r.rowCount) return { updatedAt };
      } else {
        const r = await q(
          `INSERT INTO slots (user_id, slot, data, summary, updated_at) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (user_id, slot) DO NOTHING RETURNING updated_at`,
          [userId, slot, data, JSON.stringify(summary), updatedAt],
        );
        if (r.rowCount) return { updatedAt };
      }
      const cur = await q('SELECT updated_at FROM slots WHERE user_id = $1 AND slot = $2', [userId, slot]);
      return { conflict: cur.rows[0] ? Number(cur.rows[0].updated_at) : 0 };
    },
    async deleteSlot(userId, slot) {
      await q('DELETE FROM slots WHERE user_id = $1 AND slot = $2', [userId, slot]);
    },
  };
}
