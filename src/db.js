import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';

const schema = `
CREATE TABLE IF NOT EXISTS settings (
  guild_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  PRIMARY KEY (guild_id, key)
);
CREATE TABLE IF NOT EXISTS verifications (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`;

export function openDb(file) {
  if (file !== ':memory:') mkdirSync('data', { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(schema);
  return db;
}

// node --test sets NODE_TEST_CONTEXT, so tests never touch the real database file.
export const db = openDb(process.env.NODE_TEST_CONTEXT ? ':memory:' : 'data/demobot.db');

export function getSetting(guildId, key) {
  return db.prepare('SELECT value FROM settings WHERE guild_id = ? AND key = ?').get(guildId, key)?.value ?? null;
}

export function setSetting(guildId, key, value) {
  db.prepare('INSERT INTO settings (guild_id, key, value) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET value = excluded.value')
    .run(guildId, key, value);
}

export function getSettings(guildId) {
  const rows = db.prepare('SELECT key, value FROM settings WHERE guild_id = ?').all(guildId);
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}
