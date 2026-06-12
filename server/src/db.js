import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'vanadiel.db');

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    email         TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS characters (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id      INTEGER NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    current_job     TEXT NOT NULL,
    gil             INTEGER NOT NULL DEFAULT 0,
    jobs_json       TEXT NOT NULL,
    inventory_json  TEXT NOT NULL,
    equipment_json  TEXT NOT NULL,
    quests_json     TEXT NOT NULL,
    appearance_json TEXT NOT NULL,
    recruited_json  TEXT NOT NULL DEFAULT '{}',
    auto_magic_json TEXT NOT NULL DEFAULT '{}',
    boss_down       INTEGER NOT NULL DEFAULT 0,
    hp              REAL,
    mp              REAL,
    pos_x           REAL,
    pos_z           REAL,
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);
