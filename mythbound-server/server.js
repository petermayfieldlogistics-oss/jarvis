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

startServer(Number(process.env.PORT) || 8080, { accounts: await accounts() }).then(({ port }) => console.log(`Mythbound relay listening on port ${port}`));
