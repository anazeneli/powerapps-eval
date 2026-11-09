import { rmSync } from 'node:fs';
import { DB_FILE, ensureDataDir } from './config.js';
import { openDb } from './db.js';
import { seed } from './seed.js';

ensureDataDir();
for (const suffix of ['', '-wal', '-shm']) rmSync(DB_FILE + suffix, { force: true });
const db = openDb(DB_FILE);
seed(db);
console.log(`Seeded ${DB_FILE}`);
db.close();
