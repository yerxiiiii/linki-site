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
    selected_features TEXT NOT NULL DEFAULT '',
    message           TEXT NOT NULL DEFAULT '',
    lang              TEXT NOT NULL DEFAULT 'zh',
    page_path         TEXT NOT NULL DEFAULT '',
    ip                TEXT NOT NULL DEFAULT '',
    user_agent        TEXT NOT NULL DEFAULT '',
    created_at        TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
`);

try {
  db.exec("ALTER TABLE leads ADD COLUMN selected_features TEXT NOT NULL DEFAULT ''");
} catch {
  // 已存在该列（老数据库迁移场景），忽略
}

export default db;
