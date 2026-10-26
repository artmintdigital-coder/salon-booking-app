// Run: npm test  (Node's built-in test runner, no extra dependencies)
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { computeAvailableSlots, isSlotFree } = require('../server/slots');
const { isValidPhone } = require('../server/validation');
const { createSchema } = require('../server/db');
const svc = require('../server/bookingService');
const { getKolkataNow, addDays } = require('../server/utils/time');

// --- Pure slot logic -------------------------------------------------------

test('generates 15-minute slots that fit fully inside working hours', () => {
  const slots = computeAvailableSlots({ openTime: '10:00', closeTime: '11:00', durationMinutes: 30 });
  assert.deepEqual(slots, ['10:00', '10:15', '10:30']);
});

test('a booking blocks overlapping slots, but touching slots stay free', () => {
  const busy = [{ start: '11:00', end: '11:30' }];
  const slots = computeAvailableSlots({ openTime: '10:00', closeTime: '12:00', durationMinutes: 30, busy });
  assert.ok(slots.includes('10:30')); // ends exactly when the booking starts
  assert.ok(slots.includes('11:30')); // starts exactly when the booking ends
  assert.ok(!slots.includes('11:00'));
  assert.ok(!slots.includes('10:45')); // would overlap 11:00-11:30
});

test('buffer time keeps a gap after each appointment', () => {
  const busy = [{ start: '11:00', end: '11:30' }];
  const slots = computeAvailableSlots({ openTime: '10:00', closeTime: '13:00', durationMinutes: 30, bufferMinutes: 15, busy });
  assert.ok(!slots.includes('11:30')); // only 0 min after the booking, needs 15
  assert.ok(slots.includes('11:45'));
});

test('lunch break and blocked ranges remove slots', () => {
  const busy = [{ start: '14:00', end: '15:00' }, { start: '16:00', end: '18:00' }];
  const slots = computeAvailableSlots({ openTime: '13:00', closeTime: '19:00', durationMinutes: 60, busy });
  assert.ok(!slots.some((s) => s >= '13:30' && s < '15:00'));
  assert.ok(!slots.some((s) => s >= '15:30' && s < '18:00'));
  assert.ok(slots.includes('15:00'));
  assert.ok(slots.includes('18:00'));
});

test('nothing fits when the total duration exceeds the working day', () => {
  assert.deepEqual(
    computeAvailableSlots({ openTime: '10:00', closeTime: '11:00', durationMinutes: 90 }),
    []
  );
});

test('closed day returns no slots', () => {
  assert.deepEqual(
    computeAvailableSlots({ openTime: null, closeTime: null, durationMinutes: 30 }),
    []
  );
});

test('phone validation accepts exactly 10 digits', () => {
  assert.equal(isValidPhone('9876543210'), true);
  assert.equal(isValidPhone('987654321'), false);
  assert.equal(isValidPhone('98765 43210'), false);
  assert.equal(isValidPhone('98765432101'), false);
});

// --- Booking rules against a real (in-memory) database ---------------------

function setupDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  createSchema(db);
  const salonId = db.prepare(
    "INSERT INTO salons (name, slug, address, phone, buffer_minutes) VALUES ('Test Salon', 'test', '', '', 0)"
  ).run().lastInsertRowid;
  const salon = db.prepare('SELECT * FROM salons WHERE id = ?').get(salonId);
  const insertHours = db.prepare(
    'INSERT INTO working_hours (salon_id, weekday, is_closed, open_time, close_time) VALUES (?, ?, 0, ?, ?)'
  );
  for (let d = 0; d <= 6; d++) insertHours.run(salonId, d, '10:00', '20:00');
  const svcId = db.prepare(
    'INSERT INTO services (salon_id, name, duration_minutes, price) VALUES (?, ?, 30, 299)'
  ).run(salonId, 'Haircut').lastInsertRowid;
  const staffId = db.prepare('INSERT INTO staff (salon_id, name) VALUES (?, ?)').run(salonId, 'Asha').lastInsertRowid;
  db.prepare('INSERT INTO staff_days (staff_id, weekday) VALUES (?, ?)').run(staffId, 1);
  return { db, salon, svcId, staffId };
}

test('double-booking the same slot is rejected inside the transaction', () => {
  const { db, salon, svcId, staffId } = setupDb();
  // Pick a Monday within the next 30 days so the staff member works that day.
  let date = addDays(getKolkataNow().date, 1);
  while (new Date(`${date}T00:00:00Z`).getUTCDay() !== 1) date = addDays(date, 1);
  const input = { customerName: 'Test User', phone: '9876543210', serviceIds: [svcId], staffId, date, startTime: '11:00' };
  const first = svc.createBooking(db, salon, input);
  assert.equal(first.status, 'Confirmed');
  assert.throws(
    () => svc.createBooking(db, salon, { ...input, phone: '9876543219' }),
    (err) => err.status === 409
  );
  // Only one booking exists for that slot.
  const count = db.prepare('SELECT COUNT(*) AS n FROM bookings WHERE date = ? AND start_time = ?').get(date, '11:00').n;
  assert.equal(count, 1);
});
