# Mythbound co-op server

A tiny relay that lets up to four Mythbound players share a world. One player hosts (their game runs the monsters
and bosses); friends join with a five-letter room code. The server only makes rooms and passes messages.

```sh
npm install
npm start      # listens on $PORT (default 8080): health check at /health, WebSocket at /ws
npm test
```

## Accounts

Players can make an account (a username and password, no email) and keep up to five heroes on the server, so they
can play the same hero on any device. Accounts switch on when the `DATABASE_URL` environment variable names a
PostgreSQL database (a free [Neon](https://neon.tech) database works: in Render, open the service, then Environment,
and add `DATABASE_URL` with Neon's connection string). Without it, co-op still works and the game offers offline play.

- Passwords are stored as scrypt hashes; recovery codes (80 random bits) and sign-in tokens as SHA-256 hashes.
- A forgotten password is reset with the recovery code shown once when the account is made.
- Login attempts are rate-limited per address and per username.
- `GET /health` reports `accounts: true` when the database is connected.

`npm test` runs against an in-memory store; set `TEST_DATABASE_URL` to also run the tests on PostgreSQL.

## Files

`server.js` starts the relay (it is what Render runs); the relay itself is in `relay.js`, which the tests import.

It is deployed on Render's free plan from `render.yaml` at the repository root. Free services fall asleep after 15
minutes without players and take about a minute to wake up on the next connection.
