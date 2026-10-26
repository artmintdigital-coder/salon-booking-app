// ---------------------------------------------------------------------------
// SQLite setup (better-sqlite3, synchronous — perfect for the transaction
// logic in bookingService.js). To move to PostgreSQL later, replace only
// this file and the SQL in the routes: the slot logic in slots.js and the
// booking rules in bookingService.js do not depend on SQLite specifics.
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'salon.db');

let db = null;

function getDb() {
  if (db) return db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);
  db.pragma('foreign_keys = ON');
  createSchema(db);
  return db;
}

/** All tables from the spec. `IF NOT EXISTS` keeps this safe to re-run. */
function createSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS salons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      address TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
      buffer_minutes INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS owners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      salon_id INTEGER NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
      name TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      salon_id INTEGER NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
      price INTEGER NOT NULL CHECK (price >= 0),  -- price in whole rupees (₹)
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS staff (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      salon_id INTEGER NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- One row per staff member per weekday they work (0 = Sunday .. 6 = Saturday)
    CREATE TABLE IF NOT EXISTS staff_days (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
      weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
      UNIQUE (staff_id, weekday)
    );

    -- One row per salon per weekday. is_closed = 1 means the salon is shut.
    -- lunch_start/lunch_end are optional; NULL means "no lunch break".
    CREATE TABLE IF NOT EXISTS working_hours (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      salon_id INTEGER NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
      weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
      is_closed INTEGER NOT NULL DEFAULT 0,
      open_time TEXT,
      close_time TEXT,
      lunch_start TEXT,
      lunch_end TEXT,
      UNIQUE (salon_id, weekday)
    );

    -- Salon-wide blocks. start_time/end_time NULL = whole day blocked.
    CREATE TABLE IF NOT EXISTS blocked_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      salon_id INTEGER NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      start_time TEXT,
      end_time TEXT,
      reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      salon_id INTEGER NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (salon_id, phone)
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      salon_id INTEGER NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
      booking_code TEXT NOT NULL UNIQUE,  -- human-friendly ID shown to customers, e.g. SB-A1B2C3
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      total_duration INTEGER NOT NULL,
      total_price INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'Confirmed'
        CHECK (status IN ('Confirmed', 'Completed', 'Cancelled', 'No-show')),
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS booking_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
      service_id INTEGER NOT NULL REFERENCES services(id),
      price INTEGER NOT NULL,             -- price snapshot at booking time
      duration_minutes INTEGER NOT NULL,  -- duration snapshot at booking time
      UNIQUE (booking_id, service_id)
    );
  `);
}

module.exports = { getDb, createSchema };
