// Starts the Mythbound co-op relay. Render runs this file (`node server.js`).
// The relay itself lives in relay.js so tests can start their own copies.
//
// Player accounts switch on when DATABASE_URL names a PostgreSQL database
// (a free Neon database, set in Render's Environment page). Without one, or if
// it can't be reached, co-op still works and the game offers offline play.

import { accountsApi } from './accounts.js';
import { startServer } from './relay.js';
import { pgStore } from './store.js';

process.on('uncaughtException', (err) => console.error('Uncaught error:', err));
process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));

async function accounts() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log('No DATABASE_URL: accounts are off.');
    return undefined;
  }
  try {
    const store = await pgStore(url);
    await store.init();
    console.log('Accounts are on.');
    return accountsApi(store);
  } catch (err) {
    console.error('Could not open the accounts database, so accounts are off:', err.message);
    return undefined;
  }
}

/**
 * Render's free plan puts a server to sleep after 15 minutes without visitors,
 * and the next player then waits about a minute. Visiting our own public
 * address every 10 minutes keeps it awake (one always-on server fits in the
 * free plan's monthly hours). Only /health is visited, so the database can
 * still nap. Set KEEP_AWAKE=off to let the server sleep again.
 */
function keepAwake() {
  const self = process.env.RENDER_EXTERNAL_URL;
  if (!self || process.env.KEEP_AWAKE === 'off') return;
  const ping = () => fetch(`${self}/health`, { signal: AbortSignal.timeout(30_000) }).catch(() => {});
  setInterval(ping, 10 * 60_000).unref();
  console.log(`Keeping awake: visiting ${self}/health every 10 minutes.`);
}

startServer(Number(process.env.PORT) || 8080, { accounts: await accounts() }).then(
  ({ port }) => {
    console.log(`Mythbound relay listening on port ${port}`);
    keepAwake();
  },
  (err) => {
    // Without its port the server is useless: stop, so the host starts it again.
    console.error('Could not start:', err.message);
    process.exit(1);
  },
);
