import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultDbPath = join(__dirname, 'data', 'linki-leads.db');
const DB_PATH = process.env.DB_PATH || defaultDbPath;

mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS leads (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    name              TEXT NOT NULL,
    email             TEXT NOT NULL,
    contact           TEXT NOT NULL DEFAULT '',
    intent            TEXT NOT NULL,
    gender            TEXT NOT NULL DEFAULT '',
    age_range         TEXT NOT NULL DEFAULT '',
    selected_features TEXT NOT NULL DEFAULT '',
    message           TEXT NOT NULL DEFAULT '',
    lang              TEXT NOT NULL DEFAULT 'zh',
    page_path         TEXT NOT NULL DEFAULT '',
    utm_source        TEXT NOT NULL DEFAULT '',
    utm_medium        TEXT NOT NULL DEFAULT '',
    utm_campaign      TEXT NOT NULL DEFAULT '',
    utm_content       TEXT NOT NULL DEFAULT '',
    utm_term          TEXT NOT NULL DEFAULT '',
    agent_id          TEXT NOT NULL DEFAULT '',
    prompt_id         TEXT NOT NULL DEFAULT '',
    creative_id       TEXT NOT NULL DEFAULT '',
    landing_path      TEXT NOT NULL DEFAULT '',
    referrer          TEXT NOT NULL DEFAULT '',
    ip                TEXT NOT NULL DEFAULT '',
    user_agent        TEXT NOT NULL DEFAULT '',
    geo_country       TEXT NOT NULL DEFAULT '',
    geo_region        TEXT NOT NULL DEFAULT '',
    geo_city          TEXT NOT NULL DEFAULT '',
    geo_checked       INTEGER NOT NULL DEFAULT 0,
    created_at        TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
`);

const leadColumns = new Set(db.prepare('PRAGMA table_info(leads)').all().map((column) => column.name));
const leadMigrations = {
  selected_features: "TEXT NOT NULL DEFAULT ''",
  gender: "TEXT NOT NULL DEFAULT ''",
  age_range: "TEXT NOT NULL DEFAULT ''",
  utm_source: "TEXT NOT NULL DEFAULT ''",
  utm_medium: "TEXT NOT NULL DEFAULT ''",
  utm_campaign: "TEXT NOT NULL DEFAULT ''",
  utm_content: "TEXT NOT NULL DEFAULT ''",
  utm_term: "TEXT NOT NULL DEFAULT ''",
  agent_id: "TEXT NOT NULL DEFAULT ''",
  prompt_id: "TEXT NOT NULL DEFAULT ''",
  creative_id: "TEXT NOT NULL DEFAULT ''",
  landing_path: "TEXT NOT NULL DEFAULT ''",
  referrer: "TEXT NOT NULL DEFAULT ''",
  geo_country: "TEXT NOT NULL DEFAULT ''",
  geo_region: "TEXT NOT NULL DEFAULT ''",
  geo_city: "TEXT NOT NULL DEFAULT ''",
  geo_checked: 'INTEGER NOT NULL DEFAULT 0',
};

for (const [name, definition] of Object.entries(leadMigrations)) {
  if (!leadColumns.has(name)) db.exec(`ALTER TABLE leads ADD COLUMN ${name} ${definition}`);
}

export default db;
