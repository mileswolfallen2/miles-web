import { loadEnv } from '../lib/env.js';
import { loadConfig } from '../config.js';
import { openDatabase } from '../db/index.js';
import { migrate } from '../db/migrate.js';
import { seedConfig } from '../db/seed.js';

loadEnv();
const config = loadConfig();
const db = openDatabase(config.dbPath);
const count = migrate(db);
seedConfig(db, config);
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all()
  .map((row) => row.name);
db.close();

console.log(`Database ready: ${config.dbPath}`);
console.log(`Migrations applied: ${count}`);
console.log(`Tables: ${tables.join(', ')}`);
