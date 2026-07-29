const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'raimart.db'));
// Note: WAL mode is deliberately NOT enabled here. Railway's persistent Volumes
// use network-backed storage, and SQLite's WAL mode relies on file-locking
// behavior that can be unreliable on network filesystems, causing crashes.
// The default rollback-journal mode is slower but much more reliable here.

// ---------- SCHEMA ----------
db.exec(`
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  emoji TEXT DEFAULT '🛒'
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id),
  unit TEXT DEFAULT 'piece',
  price REAL NOT NULL,
  image_url TEXT DEFAULT '',
  in_stock INTEGER NOT NULL DEFAULT 1,
  offer_percent REAL DEFAULT 0,
  offer_active INTEGER NOT NULL DEFAULT 0,
  featured INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL
);
`);

// ---------- SEED DEFAULT CATEGORIES ----------
const catCount = db.prepare('SELECT COUNT(*) as c FROM categories').get().c;
if (catCount === 0) {
  const insertCat = db.prepare('INSERT INTO categories (name, emoji) VALUES (?, ?)');
  const defaults = [
    ['Fruits & Vegetables', '🥕'],
    ['Dairy & Bakery', '🥛'],
    ['Atta, Rice & Dal', '🌾'],
    ['Oil, Ghee & Masala', '🧂'],
    ['Snacks & Sweets', '🍪'],
    ['Beverages', '🥤'],
    ['Personal Care', '🧴'],
    ['Household', '🧼'],
  ];
  for (const row of defaults) insertCat.run(...row);
}

// ---------- SEED DEFAULT ADMIN ----------
const adminCount = db.prepare('SELECT COUNT(*) as c FROM admins').get().c;
if (adminCount === 0) {
  const defaultUser = process.env.ADMIN_USER || 'admin';
  const defaultPass = process.env.ADMIN_PASS || 'raimart@2026';
  const hash = bcrypt.hashSync(defaultPass, 10);
  db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run(defaultUser, hash);
  console.log(`\n[seed] Default admin created -> username: ${defaultUser} | password: ${defaultPass}`);
  console.log('[seed] CHANGE THIS PASSWORD after first login.\n');
}

// Small helper so route files can run multiple inserts safely together,
// mirroring the .transaction() helper the old driver provided.
db.runInTransaction = function (fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
};

module.exports = db;
