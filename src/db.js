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
CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY,
  guild_id TEXT NOT NULL,
  number INTEGER NOT NULL,
  channel_id TEXT,
  opener_id TEXT NOT NULL,
  category TEXT NOT NULL,
  reason TEXT,
  priority TEXT NOT NULL DEFAULT 'normal',
  claimer_id TEXT,
  opened_at INTEGER NOT NULL,
  claimed_at INTEGER,
  closed_at INTEGER,
  closed_by TEXT,
  rating INTEGER,
  last_activity INTEGER NOT NULL,
  warned_at INTEGER,
  UNIQUE (guild_id, number)
);
CREATE INDEX IF NOT EXISTS tickets_channel ON tickets (channel_id);
CREATE TABLE IF NOT EXISTS cases (
  guild_id TEXT NOT NULL,
  number INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  mod_id TEXT NOT NULL,
  action TEXT NOT NULL,
  reason TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, number)
);
CREATE TABLE IF NOT EXISTS giveaways (
  id INTEGER PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT,
  host_id TEXT NOT NULL,
  prize TEXT NOT NULL,
  winners INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  ended INTEGER NOT NULL DEFAULT 0,
  winner_ids TEXT
);
CREATE TABLE IF NOT EXISTS giveaway_entries (
  giveaway_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  PRIMARY KEY (giveaway_id, user_id)
);
CREATE TABLE IF NOT EXISTS suggestions (
  id INTEGER PRIMARY KEY,
  guild_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  staff_id TEXT,
  staff_reason TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS suggestion_votes (
  suggestion_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  vote INTEGER NOT NULL,
  PRIMARY KEY (suggestion_id, user_id)
);
CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  answers TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewer_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS role_menus (
  id INTEGER PRIMARY KEY,
  guild_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  single INTEGER NOT NULL,
  role_ids TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  text TEXT NOT NULL,
  due_at INTEGER NOT NULL,
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
