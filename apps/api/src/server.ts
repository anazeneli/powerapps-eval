import { buildApp } from './app.js';
import { DB_FILE, PORT, ensureDataDir } from './config.js';
import { openDb } from './platform/db.js';
import { seed } from './seed.js';

ensureDataDir();
const db = openDb(DB_FILE);
const { n } = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
if (n === 0) seed(db);

const app = buildApp(db, { logger: true });
app.listen({ port: PORT, host: '127.0.0.1' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
