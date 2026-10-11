// Starts the Mythbound co-op relay. Render runs this file (`node server.js`).
// The relay itself lives in relay.js so tests can start their own copies.

import { startServer } from './relay.js';

process.on('uncaughtException', (err) => console.error('Uncaught error:', err));
process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));

startServer().then(({ port }) => console.log(`Mythbound relay listening on port ${port}`));
