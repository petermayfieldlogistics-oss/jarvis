import { test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { startServer, PROTOCOL_VERSION } from './relay.js';

function client(port) {
  const ws = new WebSocket(`ws://localhost:${port}/ws`);
  const inbox = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    const i = waiters.findIndex((w) => w.match(msg));
    if (i >= 0) waiters.splice(i, 1)[0].resolve(msg);
    else inbox.push(msg);
  });
  return {
    ws,
    open: () => new Promise((r) => ws.once('open', r)),
    send: (m) => ws.send(JSON.stringify(m)),
    next: (t) =>
      new Promise((resolve, reject) => {
        const i = inbox.findIndex((m) => m.t === t);
        if (i >= 0) return resolve(inbox.splice(i, 1)[0]);
        const timer = setTimeout(() => reject(new Error(`timed out waiting for ${t}`)), 2000);
        waiters.push({ match: (m) => m.t === t, resolve: (m) => (clearTimeout(timer), resolve(m)) });
      }),
  };
}

test('health check answers', async () => {
  const srv = await startServer(0);
  const res = await fetch(`http://localhost:${srv.port}/health`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).game, 'mythbound');
  await srv.close();
});

test('host creates a room, a guest joins, messages relay both ways', async () => {
  const srv = await startServer(0);
  const host = client(srv.port);
  const guest = client(srv.port);
  await Promise.all([host.open(), guest.open()]);

  host.send({ t: 'create', name: 'Aria', version: PROTOCOL_VERSION });
  const created = await host.next('created');
  assert.match(created.room, /^[A-Z2-9]{5}$/);

  guest.send({ t: 'join', room: created.room.toLowerCase(), name: 'Bram<script>', version: PROTOCOL_VERSION });
  const joined = await guest.next('joined');
  assert.equal(joined.hostId, created.id);
  assert.deepEqual(joined.players.map((p) => p.name).sort(), ['Aria', 'Bramscript']);
  const peer = await host.next('peer-join');
  assert.equal(peer.id, joined.id);

  guest.send({ t: 'send', to: 'host', d: { hello: 'host' } });
  assert.deepEqual((await host.next('msg')).d, { hello: 'host' });
  host.send({ t: 'send', to: 'all', d: { world: 1 } });
  const toGuest = await guest.next('msg');
  assert.equal(toGuest.from, created.id);
  assert.deepEqual(toGuest.d, { world: 1 });

  host.ws.close();
  assert.equal((await guest.next('closed')).reason, 'host-disconnected');
  guest.ws.close();
  await srv.close();
});

test('rejects bad codes, full rooms and old versions', async () => {
  const srv = await startServer(0);
  const host = client(srv.port);
  await host.open();
  host.send({ t: 'create', name: 'H', version: PROTOCOL_VERSION });
  const { room } = await host.next('created');

  const lost = client(srv.port);
  await lost.open();
  lost.send({ t: 'join', room: 'ZZZZZ', name: 'L', version: PROTOCOL_VERSION });
  assert.equal((await lost.next('error')).code, 'no-room');
  lost.send({ t: 'join', room, name: 'L', version: 0 });
  assert.equal((await lost.next('error')).code, 'version');

  const guests = [];
  for (let i = 0; i < 3; i++) {
    const g = client(srv.port);
    await g.open();
    g.send({ t: 'join', room, name: `G${i}`, version: PROTOCOL_VERSION });
    await g.next('joined');
    guests.push(g);
  }
  lost.send({ t: 'join', room, name: 'L', version: PROTOCOL_VERSION });
  assert.equal((await lost.next('error')).code, 'room-full');

  // A guest leaving tells the others, and frees a place.
  guests[0].send({ t: 'leave' });
  assert.equal((await host.next('peer-leave')).id !== undefined, true);
  lost.send({ t: 'join', room, name: 'L', version: PROTOCOL_VERSION });
  await lost.next('joined');

  for (const c of [host, lost, ...guests]) c.ws.close();
  await srv.close();
});
