import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountsApi } from './accounts.js';
import { startServer } from './relay.js';
import { memoryStore, pgStore } from './store.js';

/** A running server on a free port with the given store, and a small client for it. */
async function setup(store) {
  await store.init();
  const server = await startServer(0, { accounts: accountsApi(store) });
  const base = `http://localhost:${server.port}`;
  const call = async (method, path, body, token) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  return { call, close: async () => (await server.close(), await store.close()) };
}

const save = (name, level) => ({ character: { name, level, classId: 'warrior' }, world: { gameMinutes: 480 } });

async function scenario(store) {
  const { call, close } = await setup(store);
  try {
    // Sign up: a token and a recovery code.
    const su = await call('POST', '/api/signup', { username: 'Aria_7', password: 'dragons' });
    assert.equal(su.status, 201);
    assert.match(su.body.recovery, /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    const token = su.body.token;

    // Names are unique whatever their case; bad names and short passwords are refused.
    assert.equal((await call('POST', '/api/signup', { username: 'aria_7', password: 'whatever' })).status, 409);
    assert.equal((await call('POST', '/api/signup', { username: 'no spaces', password: 'whatever' })).status, 400);
    assert.equal((await call('POST', '/api/signup', { username: 'Shorty', password: '123' })).status, 400);

    // Log in (any case), wrong password refused.
    const li = await call('POST', '/api/login', { username: 'ARIA_7', password: 'dragons' });
    assert.equal(li.status, 200);
    assert.equal(li.body.username, 'Aria_7');
    assert.equal((await call('POST', '/api/login', { username: 'Aria_7', password: 'nope!!' })).status, 401);
    assert.equal((await call('POST', '/api/login', { username: 'Nobody', password: 'dragons' })).status, 401);

    // Slots need a sign-in.
    assert.equal((await call('GET', '/api/slots')).status, 401);
    assert.equal((await call('GET', '/api/slots', undefined, 'bogus')).status, 401);
    const empty = await call('GET', '/api/slots', undefined, token);
    assert.deepEqual(empty.body, { max: 5, slots: [] });

    // Save into slot 0, read it back from "another device" (the second sign-in).
    const put = await call('PUT', '/api/slots/0', { save: save('Aria', 3), summary: { name: 'Aria', classId: 'warrior', level: 3, evil: '<script>' }, base: 0 }, token);
    assert.equal(put.status, 200);
    const v1 = put.body.updatedAt;
    const list = await call('GET', '/api/slots', undefined, li.body.token);
    assert.equal(list.body.slots.length, 1);
    assert.equal(list.body.slots[0].summary.name, 'Aria');
    assert.equal(list.body.slots[0].summary.evil, undefined);
    const got = await call('GET', '/api/slots/0', undefined, li.body.token);
    assert.deepEqual(got.body.save, save('Aria', 3));
    assert.equal(got.body.updatedAt, v1);

    // The other device saves on top of v1; the first, still on v1, is told rather than overwriting.
    const v2 = (await call('PUT', '/api/slots/0', { save: save('Aria', 4), summary: { name: 'Aria', level: 4 }, base: v1 }, li.body.token)).body.updatedAt;
    assert.ok(v2 > v1);
    const stale = await call('PUT', '/api/slots/0', { save: save('Aria', 3), summary: { name: 'Aria', level: 3 }, base: v1 }, token);
    assert.equal(stale.status, 409);
    assert.equal(stale.body.updatedAt, v2);
    assert.equal((await call('GET', '/api/slots/0', undefined, token)).body.save.character.level, 4);
    // A new hero can't land on an occupied slot by accident either.
    assert.equal((await call('PUT', '/api/slots/0', { save: save('X', 1), summary: {}, base: 0 }, token)).status, 409);

    // Only five slots.
    assert.equal((await call('PUT', '/api/slots/5', { save: save('Y', 1), summary: {}, base: 0 }, token)).status, 404);
    assert.equal((await call('GET', '/api/slots/abc', undefined, token)).status, 404);

    // Profile (unlocks) follows the account.
    assert.equal((await call('PUT', '/api/me', { profile: { unlocks: { ancient: true } } }, token)).status, 200);
    assert.deepEqual((await call('GET', '/api/me', undefined, li.body.token)).body, { username: 'Aria_7', profile: { unlocks: { ancient: true } }, admin: false });

    // Delete a slot.
    assert.equal((await call('DELETE', '/api/slots/0', undefined, token)).status, 200);
    assert.equal((await call('GET', '/api/slots/0', undefined, token)).status, 404);

    // Forgot the password: the recovery code sets a new one, ends old sign-ins, and is replaced.
    assert.equal((await call('POST', '/api/recover', { username: 'Aria_7', recovery: 'AAAA-BBBB-CCCC-DDDD', password: 'newpass' })).status, 401);
    const rec = await call('POST', '/api/recover', { username: 'aria_7', recovery: su.body.recovery.toLowerCase().replace(/-/g, ' '), password: 'newpass' });
    assert.equal(rec.status, 200);
    assert.notEqual(rec.body.recovery, su.body.recovery);
    assert.equal((await call('GET', '/api/slots', undefined, token)).status, 401);
    assert.equal((await call('POST', '/api/login', { username: 'Aria_7', password: 'dragons' })).status, 401);
    assert.equal((await call('POST', '/api/login', { username: 'Aria_7', password: 'newpass' })).status, 200);
    assert.equal((await call('POST', '/api/recover', { username: 'Aria_7', recovery: su.body.recovery, password: 'again1' })).status, 401);

    // Log out ends that sign-in only.
    const t2 = (await call('POST', '/api/login', { username: 'Aria_7', password: 'newpass' })).body.token;
    assert.equal((await call('POST', '/api/logout', undefined, t2)).status, 200);
    assert.equal((await call('GET', '/api/me', undefined, t2)).status, 401);
    assert.equal((await call('GET', '/api/me', undefined, rec.body.token)).status, 200);

    // Guessing passwords locks the name for a while, even with the right one.
    await call('POST', '/api/signup', { username: 'Target', password: 'secret1' });
    for (let i = 0; i < 8; i++) await call('POST', '/api/login', { username: 'Target', password: `guess${i}` });
    const locked = await call('POST', '/api/login', { username: 'Target', password: 'secret1' });
    assert.equal(locked.status, 429);
  } finally {
    await close();
  }
}

test('accounts: sign up, log in, slots across devices, recovery, lockout (memory store)', () => scenario(memoryStore()));

test('accounts: the same on PostgreSQL', { skip: !process.env.TEST_DATABASE_URL && 'set TEST_DATABASE_URL to run' }, async () => {
  const store = await pgStore(process.env.TEST_DATABASE_URL);
  await store.init();
  // Start from empty tables.
  const { default: pg } = await import('pg');
  const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await c.connect();
  await c.query('TRUNCATE users, sessions, slots RESTART IDENTITY CASCADE');
  await c.end();
  await scenario(store);
});

test('without a database the API says accounts are off', async () => {
  const server = await startServer(0);
  try {
    const health = await (await fetch(`http://localhost:${server.port}/health`)).json();
    assert.equal(health.accounts, false);
    const res = await fetch(`http://localhost:${server.port}/api/login`, { method: 'POST', body: '{}' });
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error, 'no-accounts');
  } finally {
    await server.close();
  }
});

test('admins and builds: only the named, older accounts are admins; anyone can open a build by its link', async () => {
  const store = memoryStore();
  await store.init();
  let t = Date.UTC(2026, 0, 1);
  const server = await startServer(0, { accounts: accountsApi(store, { now: () => t, admins: ['R88', 'Rock'], adminBefore: Date.UTC(2026, 5, 1) }) });
  const base = `http://localhost:${server.port}`;
  const call = async (method, path, body, token) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  try {
    const r88 = await call('POST', '/api/signup', { username: 'R88', password: 'builder1' });
    const rock = await call('POST', '/api/signup', { username: 'rock', password: 'builder2' });
    const pleb = await call('POST', '/api/signup', { username: 'Pleb', password: 'player1' });
    assert.equal((await call('GET', '/api/me', undefined, r88.body.token)).body.admin, true);
    assert.equal((await call('GET', '/api/me', undefined, rock.body.token)).body.admin, true);
    assert.equal((await call('GET', '/api/me', undefined, pleb.body.token)).body.admin, false);
    // Players can't make builds.
    assert.equal((await call('POST', '/api/builds', { name: 'x', edits: [] }, pleb.body.token)).status, 403);
    assert.equal((await call('POST', '/api/builds', { name: 'x', edits: [] })).status, 401);
    // An admin saves a build and gets its link id; anyone can open it.
    const made = await call('POST', '/api/builds', { name: 'Castle', edits: [{ t: 'add', k: 'tower', x: 5, z: -3.25, evil: { nested: 1 } }] }, r88.body.token);
    assert.equal(made.status, 201);
    assert.match(made.body.id, /^[a-z0-9]{8}$/);
    const open = await call('GET', `/api/builds/${made.body.id}`);
    assert.equal(open.status, 200);
    assert.equal(open.body.owner, 'R88');
    assert.deepEqual(open.body.edits, [{ t: 'add', k: 'tower', x: 5, z: -3.25 }]);
    assert.equal((await call('GET', '/api/builds/nosuchxx')).status, 404);
    // Saving over it: the owner yes, another admin no.
    assert.equal((await call('PUT', `/api/builds/${made.body.id}`, { name: 'Castle 2', edits: [] }, r88.body.token)).status, 200);
    assert.equal((await call('PUT', `/api/builds/${made.body.id}`, { name: 'Mine', edits: [] }, rock.body.token)).status, 403);
    assert.equal((await call('GET', '/api/builds', undefined, r88.body.token)).body.builds[0].name, 'Castle 2');
    // A look-alike made after admin was handed out is not an admin.
    await call('DELETE', `/api/builds/${made.body.id}`, undefined, r88.body.token);
    assert.equal((await call('GET', `/api/builds/${made.body.id}`)).status, 404);
    t = Date.UTC(2026, 11, 1);
    await store.deleteSessions(2);
    const late = await call('POST', '/api/signup', { username: 'Rock_', password: 'imposter' });
    assert.equal(late.body.admin, false);
  } finally {
    await server.close();
    await store.close();
  }
});
