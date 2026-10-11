// Mythbound co-op relay server (started by server.js; the tests start their own).
//
// Players meet in small rooms identified by a short code. The host's game is
// the authority for the world (monsters, bosses, time of day); this server
// only creates rooms and passes messages between the players in them.
//
// Protocol (JSON over WebSocket at /ws):
//   client -> server
//     { t: 'create', name, version }          make a room and become its host
//     { t: 'join', room, name, version }      join a room by code
//     { t: 'send', to, d }                    to: 'host' | 'all' | player id
//     { t: 'leave' }
//   server -> client
//     { t: 'created', room, id }
//     { t: 'joined', room, id, hostId, players: [{ id, name }] }
//     { t: 'peer-join', id, name }  { t: 'peer-leave', id }
//     { t: 'msg', from, d }
//     { t: 'closed', reason }                 the host left; the room is gone
//     { t: 'error', code, message }

import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';

export const PROTOCOL_VERSION = 1;
const MAX_PLAYERS = 4;
const MAX_ROOMS = 500;
const MAX_MESSAGE_BYTES = 64 * 1024;
/** Messages per second each player may send (bursts allowed). */
const RATE = 90;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 5;

/** @type {Map<string, { code: string, hostId: number, players: Map<number, Player> }>} */
const rooms = new Map();
let nextId = 1;

/**
 * @typedef {{ id: number, name: string, ws: import('ws').WebSocket, room: string | null, tokens: number, last: number, alive: boolean }} Player
 */

function newCode() {
  for (let attempt = 0; attempt < 50; attempt++) {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    if (!rooms.has(code)) return code;
  }
  return null;
}

function send(player, msg) {
  if (player.ws.readyState === player.ws.OPEN) player.ws.send(JSON.stringify(msg));
}

function cleanName(name) {
  return String(name ?? 'Hero').replace(/[^\p{L}\p{N} '_-]/gu, '').trim().slice(0, 20) || 'Hero';
}

function leaveRoom(player, reason = 'left') {
  const room = player.room && rooms.get(player.room);
  player.room = null;
  if (!room) return;
  room.players.delete(player.id);
  if (room.hostId === player.id) {
    // Without its host the world stops; everyone goes back to their own game.
    for (const other of room.players.values()) {
      other.room = null;
      send(other, { t: 'closed', reason: reason === 'left' ? 'host-left' : reason });
    }
    rooms.delete(room.code);
    return;
  }
  for (const other of room.players.values()) send(other, { t: 'peer-leave', id: player.id });
  if (room.players.size === 0) rooms.delete(room.code);
}

function handle(player, msg) {
  switch (msg.t) {
    case 'create': {
      if (msg.version !== PROTOCOL_VERSION) return send(player, { t: 'error', code: 'version', message: 'Your game is a different version. Reload the page.' });
      if (rooms.size >= MAX_ROOMS) return send(player, { t: 'error', code: 'full', message: 'The server is full. Try again later.' });
      leaveRoom(player);
      const code = newCode();
      if (!code) return send(player, { t: 'error', code: 'full', message: 'Could not make a room. Try again.' });
      player.name = cleanName(msg.name);
      rooms.set(code, { code, hostId: player.id, players: new Map([[player.id, player]]) });
      player.room = code;
      return send(player, { t: 'created', room: code, id: player.id });
    }
    case 'join': {
      if (msg.version !== PROTOCOL_VERSION) return send(player, { t: 'error', code: 'version', message: 'Your game is a different version than the host’s. Both reload the page.' });
      const code = String(msg.room ?? '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) return send(player, { t: 'error', code: 'no-room', message: `No room called ${code || '(blank)'}. Check the code.` });
      if (room.players.size >= MAX_PLAYERS) return send(player, { t: 'error', code: 'room-full', message: 'That room already has 4 players.' });
      leaveRoom(player);
      player.name = cleanName(msg.name);
      for (const other of room.players.values()) send(other, { t: 'peer-join', id: player.id, name: player.name });
      room.players.set(player.id, player);
      player.room = code;
      return send(player, {
        t: 'joined',
        room: code,
        id: player.id,
        hostId: room.hostId,
        players: [...room.players.values()].map((p) => ({ id: p.id, name: p.name })),
      });
    }
    case 'send': {
      const room = player.room && rooms.get(player.room);
      if (!room) return;
      const out = { t: 'msg', from: player.id, d: msg.d };
      if (msg.to === 'all') {
        for (const other of room.players.values()) if (other !== player) send(other, out);
      } else {
        const id = msg.to === 'host' ? room.hostId : Number(msg.to);
        const target = room.players.get(id);
        if (target && target !== player) send(target, out);
      }
      return;
    }
    case 'leave':
      return leaveRoom(player);
  }
}

export function startServer(port = Number(process.env.PORT) || 8080) {
  const http = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (path === '/' || path === '/health') {
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: true, game: 'mythbound', version: PROTOCOL_VERSION, rooms: rooms.size }));
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  });

  const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: MAX_MESSAGE_BYTES });
  /** @type {Map<import('ws').WebSocket, Player>} */
  const connections = new Map();

  wss.on('connection', (ws) => {
    /** @type {Player} */
    const player = { id: nextId++, name: 'Hero', ws, room: null, tokens: RATE, last: Date.now(), alive: true };
    connections.set(ws, player);
    ws.on('pong', () => (player.alive = true));
    ws.on('message', (raw, isBinary) => {
      // Token bucket: refill RATE tokens per second, up to RATE.
      const now = Date.now();
      player.tokens = Math.min(RATE, player.tokens + ((now - player.last) / 1000) * RATE);
      player.last = now;
      if (player.tokens < 1) return;
      player.tokens -= 1;
      if (isBinary) return;
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg && typeof msg === 'object' && typeof msg.t === 'string') handle(player, msg);
    });
    ws.on('close', () => {
      connections.delete(ws);
      leaveRoom(player, 'host-disconnected');
    });
    ws.on('error', () => {});
  });

  // Drop connections that stopped answering (phones going to sleep, lost Wi-Fi).
  const heartbeat = setInterval(() => {
    for (const [ws, p] of connections) {
      if (!p.alive) {
        ws.terminate();
        continue;
      }
      p.alive = false;
      ws.ping();
    }
  }, 25_000);
  wss.on('close', () => clearInterval(heartbeat));

  return new Promise((resolve) => {
    http.listen(port, () => {
      resolve({
        port: /** @type {import('node:net').AddressInfo} */ (http.address()).port,
        close: () =>
          new Promise((done) => {
            for (const ws of wss.clients) ws.terminate();
            wss.close();
            http.close(() => done(undefined));
          }),
      });
    });
  });
}
