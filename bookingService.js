// ---------------------------------------------------------------------------
// Booking rules shared by the public booking page AND the owner's walk-in
// form, so both go through exactly the same checks.
//
// THE DOUBLE-BOOKING GUARANTEE: createBooking() and rescheduleBooking()
// run inside a better-sqlite3 transaction (BEGIN IMMEDIATE under the hood).
// Inside the transaction we re-read existing bookings and re-check the slot
// BEFORE inserting, so two requests arriving at the same moment cannot
// both succeed — the second one sees the first one's booking and fails.
// The frontend slot list is only a preview; this check is the real one.
// ---------------------------------------------------------------------------
const crypto = require('crypto');
const { computeAvailableSlots, isSlotFree } = require('./slots');
const { toMinutes, fromMinutes, weekdayFromDate, getKolkataNow, addDays } = require('./utils/time');
const { isValidPhone, isValidDate, isValidTime, isNonEmptyString, fail } = require('./validation');
const { sendReminder } = require('./reminders');

const MAX_DAYS_AHEAD = 30; // bookings only up to 30 days ahead
const CANCEL_CUTOFF_MINUTES = 120; // no cancel/reschedule within 2 hours of start

function bookingCode() {
  // e.g. SB-K7Q2XA — short, readable, no confusing 0/O or 1/I characters.
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[crypto.randomInt(chars.length)];
  return `SB-${code}`;
}

/** Working-hours row + busy intervals (lunch + blocked ranges) for one date. */
function dayContext(db, salonId, date) {
  const weekday = weekdayFromDate(date);
  const hours = db.prepare(
    'SELECT * FROM working_hours WHERE salon_id = ? AND weekday = ?'
  ).get(salonId, weekday);
  const blocked = db.prepare(
    'SELECT * FROM blocked_slots WHERE salon_id = ? AND date = ?'
  ).all(salonId, date);
  const busy = [];
  if (hours && hours.lunch_start && hours.lunch_end) {
    busy.push({ start: hours.lunch_start, end: hours.lunch_end });
  }
  for (const b of blocked) {
    if (b.start_time && b.end_time) busy.push({ start: b.start_time, end: b.end_time });
    else busy.push({ start: '00:00', end: '23:59' }); // whole-day block
  }
  return { weekday, hours, busy };
}

/** Staff members who are active and scheduled to work on this weekday. */
function workingStaff(db, salonId, weekday) {
  return db.prepare(`
    SELECT s.* FROM staff s
    JOIN staff_days d ON d.staff_id = s.id AND d.weekday = ?
    WHERE s.salon_id = ? AND s.is_active = 1 ORDER BY s.id
  `).all(weekday, salonId);
}

/** Confirmed bookings on a date, optionally for one staff member only. */
function confirmedBookings(db, salonId, date, staffId) {
  if (staffId) {
    return db.prepare(`
      SELECT * FROM bookings WHERE salon_id = ? AND date = ? AND staff_id = ? AND status = 'Confirmed'
    `).all(salonId, date, staffId);
  }
  return db.prepare(`
    SELECT * FROM bookings WHERE salon_id = ? AND date = ? AND status = 'Confirmed'
  `).all(salonId, date);
}

/**
 * Free slots for a date, given a total duration. staffId = 'any' (default)
 * means "at least one working staff member is free at that time".
 * Used by the availability endpoint AND, inside a transaction, by booking.
 */
function availableSlotsFor(db, salon, date, durationMinutes, staffId = 'any') {
  const { weekday, hours, busy } = dayContext(db, salon.id, date);
  if (!hours || hours.is_closed || !hours.open_time || !hours.close_time) return [];
  const staffList = workingStaff(db, salon.id, weekday);
  if (staffList.length === 0) return [];
  const base = {
    openTime: hours.open_time, closeTime: hours.close_time,
    durationMinutes, bufferMinutes: salon.buffer_minutes || 0,
  };
  if (staffId && staffId !== 'any') {
    const staff = staffList.find((s) => s.id === Number(staffId));
    if (!staff) return [];
    const staffBusy = [...busy, ...confirmedBookings(db, salon.id, date, staff.id)
      .map((b) => ({ start: b.start_time, end: b.end_time }))];
    return computeAvailableSlots({ ...base, busy: staffBusy });
  }
  // "Any available": union of every working staff member's free slots.
  const all = new Set();
  for (const staff of staffList) {
    const staffBusy = [...busy, ...confirmedBookings(db, salon.id, date, staff.id)
      .map((b) => ({ start: b.start_time, end: b.end_time }))];
    for (const slot of computeAvailableSlots({ ...base, busy: staffBusy })) all.add(slot);
  }
  return [...all].sort();
}

/** Validate a date: today .. 30 days ahead, in Kolkata time. */
function validateBookingDate(date) {
  if (!isValidDate(date)) throw fail(400, 'Please choose a valid date.');
  const now = getKolkataNow();
  if (date < now.date) throw fail(400, 'Please choose a future date.');
  if (date > addDays(now.date, MAX_DAYS_AHEAD)) {
    throw fail(400, 'Bookings are only open up to 30 days ahead.');
  }
}

/** Load + validate the chosen services; returns { list, duration, price }. */
function loadServices(db, salonId, serviceIds) {
  const uniqueIds = [...new Set((serviceIds || []).map(Number).filter(Number.isInteger))];
  if (uniqueIds.length === 0) throw fail(400, 'Please select at least one service.');
  const placeholders = uniqueIds.map(() => '?').join(',');
  const list = db.prepare(`
    SELECT * FROM services WHERE salon_id = ? AND id IN (${placeholders}) AND is_active = 1
  `).all(salonId, ...uniqueIds);
  if (list.length !== uniqueIds.length) {
    throw fail(400, 'One of the selected services is not available.');
  }
  // Keep the customer's chosen order.
  const byId = new Map(list.map((s) => [s.id, s]));
  const ordered = uniqueIds.map((id) => byId.get(id));
  return {
    list: ordered,
    duration: ordered.reduce((sum, s) => sum + s.duration_minutes, 0),
    price: ordered.reduce((sum, s) => sum + s.price, 0),
  };
}

/** Find or create the customer row for (salon, phone). */
function upsertCustomer(db, salonId, name, phone) {
  const existing = db.prepare(
    'SELECT * FROM customers WHERE salon_id = ? AND phone = ?'
  ).get(salonId, phone);
  if (existing) {
    if (existing.name !== name) {
      db.prepare('UPDATE customers SET name = ? WHERE id = ?').run(name, existing.id);
    }
    return existing.id;
  }
  return db.prepare(
    'INSERT INTO customers (salon_id, name, phone) VALUES (?, ?, ?)'
  ).run(salonId, name, phone).lastInsertRowid;
}

/**
 * Create a booking. Runs inside ONE transaction: re-check the slot, then
 * insert customer + booking + booking_services, or roll everything back.
 * Throws an error with .status (400/409) on any rule violation.
 */
function createBooking(db, salon, input) {
  const { customerName, phone, notes = '', serviceIds, staffId = 'any', date, startTime } = input;
  if (!isNonEmptyString(customerName, 100)) throw fail(400, 'Please enter your name.');
  if (!isValidPhone(phone)) throw fail(400, 'Please enter a valid 10-digit phone number.');
  if (!isValidTime(startTime)) throw fail(400, 'Please choose a valid time slot.');
  validateBookingDate(date);

  const createTx = db.transaction(() => {
    const { list, duration, price } = loadServices(db, salon.id, serviceIds);
    const { weekday, hours, busy } = dayContext(db, salon.id, date);
    if (!hours || hours.is_closed) throw fail(409, 'The salon is closed on this day.');
    if (!hours.open_time || !hours.close_time) throw fail(409, 'The salon is closed on this day.');

    // Same-day bookings must start in the future (Kolkata time).
    const now = getKolkataNow();
    if (date === now.date && toMinutes(startTime) <= toMinutes(now.time)) {
      throw fail(409, 'That time has already passed. Please choose a later slot.');
    }

    // THE availability re-check inside the transaction (see header comment).
    const slots = availableSlotsFor(db, salon, date, duration, staffId);
    if (!slots.includes(startTime)) {
      throw fail(409, 'Sorry, that slot is no longer available. Please choose another time.');
    }

    // Resolve "Any available" to the first staff member who is actually free.
    let resolvedStaffId = null;
    if (staffId && staffId !== 'any') {
      resolvedStaffId = Number(staffId);
    } else {
      for (const staff of workingStaff(db, salon.id, weekday)) {
        const staffBusy = [...busy, ...confirmedBookings(db, salon.id, date, staff.id)
          .map((b) => ({ start: b.start_time, end: b.end_time }))];
        if (isSlotFree({ startTime, durationMinutes: duration, bufferMinutes: salon.buffer_minutes || 0, busy: staffBusy })) {
          resolvedStaffId = staff.id;
          break;
        }
      }
      if (!resolvedStaffId) throw fail(409, 'No staff member is available at that time.');
    }

    const endTime = fromMinutes(toMinutes(startTime) + duration);
    const code = bookingCode();
    const customerId = upsertCustomer(db, salon.id, customerName.trim(), phone.trim());
    const bookingId = db.prepare(`
      INSERT INTO bookings (salon_id, customer_id, staff_id, booking_code, date, start_time, end_time,
        total_duration, total_price, status, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Confirmed', ?)
    `).run(salon.id, customerId, resolvedStaffId, code, date, startTime, endTime, duration, price, notes.trim()).lastInsertRowid;

    const insertService = db.prepare(`
      INSERT INTO booking_services (booking_id, service_id, price, duration_minutes) VALUES (?, ?, ?, ?)
    `);
    for (const s of list) insertService.run(bookingId, s.id, s.price, s.duration_minutes);

    return getBookingDetail(db, bookingId);
  });

  const booking = createTx();
  // Reminder hook (currently just logs — see reminders.js).
  try { sendReminder({ ...booking, customer_phone: phone }, salon); } catch (e) { console.error('Reminder failed:', e); }
  return booking;
}

/** Full booking detail for confirmations, lookups and the dashboard. */
function getBookingDetail(db, bookingId) {
  const booking = db.prepare(`
    SELECT b.*, c.name AS customer_name, c.phone AS customer_phone,
           s.name AS staff_name, sal.name AS salon_name, sal.phone AS salon_phone
    FROM bookings b
    JOIN customers c ON c.id = b.customer_id
    JOIN salons sal ON sal.id = b.salon_id
    LEFT JOIN staff s ON s.id = b.staff_id
    WHERE b.id = ?
  `).get(bookingId);
  if (!booking) return null;
  booking.services = db.prepare(`
    SELECT sv.id, sv.name, bs.price, bs.duration_minutes
    FROM booking_services bs JOIN services sv ON sv.id = bs.service_id
    WHERE bs.booking_id = ? ORDER BY bs.id
  `).all(bookingId);
  return booking;
}

/** Find a booking by code + phone. Returns null unless BOTH match (privacy). */
function findBookingByCodeAndPhone(db, code, phone) {
  const row = db.prepare(`
    SELECT b.id FROM bookings b JOIN customers c ON c.id = b.customer_id
    WHERE b.booking_code = ? AND c.phone = ?
  `).get(String(code || '').trim().toUpperCase(), String(phone || '').trim());
  return row ? getBookingDetail(db, row.id) : null;
}

/** Guard shared by cancel + reschedule: booking must be Confirmed and > 2h away. */
function assertCancellable(booking) {
  if (!booking) throw fail(404, 'Booking not found. Please check the booking ID and phone number.');
  if (booking.status !== 'Confirmed') {
    throw fail(409, `This booking is already ${booking.status.toLowerCase()} and cannot be changed.`);
  }
  const now = getKolkataNow();
  const minutesAway = require('./utils/time').minutesBetween(now.date, now.time, booking.date, booking.start_time);
  if (minutesAway < CANCEL_CUTOFF_MINUTES) {
    throw fail(409, 'Changes are not allowed within 2 hours of the start time. Please call the salon.');
  }
}

function cancelBooking(db, code, phone) {
  const booking = findBookingByCodeAndPhone(db, code, phone);
  assertCancellable(booking);
  db.prepare("UPDATE bookings SET status = 'Cancelled' WHERE id = ?").run(booking.id);
  return getBookingDetail(db, booking.id);
}

function rescheduleBooking(db, salon, code, phone, newDate, newStartTime, newStaffId) {
  if (!isValidDate(newDate) || !isValidTime(newStartTime)) {
    throw fail(400, 'Please choose a valid new date and time.');
  }
  validateBookingDate(newDate);
  const rescheduleTx = db.transaction(() => {
    const booking = findBookingByCodeAndPhone(db, code, phone);
    assertCancellable(booking);
    // Temporarily ignore this booking itself when checking the new slot:
    // easiest correct way is to check availability, then re-verify excluding self.
    const { hours } = dayContext(db, salon.id, newDate);
    if (!hours || hours.is_closed) throw fail(409, 'The salon is closed on the new date.');
    const staffId = newStaffId || booking.staff_id || 'any';
    const slots = availableSlotsFor(db, salon, newDate, booking.total_duration, staffId);
    const isSameSlot = newDate === booking.date && newStartTime === booking.start_time;
    if (!slots.includes(newStartTime) && !isSameSlot) {
      // Slot may look busy only because of this very booking (same staff,
      // overlapping times). Re-check excluding it before giving up.
      const { weekday, busy } = dayContext(db, salon.id, newDate);
      const others = confirmedBookings(db, salon.id, newDate, staffId === 'any' ? null : Number(staffId))
        .filter((b) => b.id !== booking.id);
      const staffList = staffId === 'any'
        ? workingStaff(db, salon.id, weekday)
        : workingStaff(db, salon.id, weekday).filter((s) => s.id === Number(staffId));
      const free = staffList.some((staff) => {
        const staffBusy = [...busy, ...others.filter((b) => b.staff_id === staff.id)
          .map((b) => ({ start: b.start_time, end: b.end_time }))];
        return isSlotFree({ startTime: newStartTime, durationMinutes: booking.total_duration, bufferMinutes: salon.buffer_minutes || 0, busy: staffBusy });
      });
      if (!free) throw fail(409, 'Sorry, that slot is not available. Please choose another time.');
    }
    const newEnd = fromMinutes(toMinutes(newStartTime) + booking.total_duration);
    // Resolve staff for the new slot (same rules as creation).
    let resolvedStaffId = staffId === 'any' ? null : Number(staffId);
    if (!resolvedStaffId) {
      const { weekday, busy } = dayContext(db, salon.id, newDate);
      for (const staff of workingStaff(db, salon.id, weekday)) {
        const staffBusy = [...busy, ...confirmedBookings(db, salon.id, newDate, staff.id)
          .filter((b) => b.id !== booking.id).map((b) => ({ start: b.start_time, end: b.end_time }))];
        if (isSlotFree({ startTime: newStartTime, durationMinutes: booking.total_duration, bufferMinutes: salon.buffer_minutes || 0, busy: staffBusy })) {
          resolvedStaffId = staff.id;
          break;
        }
      }
      if (!resolvedStaffId) throw fail(409, 'No staff member is available at that time.');
    }
    db.prepare('UPDATE bookings SET date = ?, start_time = ?, end_time = ?, staff_id = ? WHERE id = ?')
      .run(newDate, newStartTime, newEnd, resolvedStaffId, booking.id);
    return getBookingDetail(db, booking.id);
  });
  return rescheduleTx();
}

module.exports = {
  MAX_DAYS_AHEAD, CANCEL_CUTOFF_MINUTES,
  availableSlotsFor, createBooking, getBookingDetail, findBookingByCodeAndPhone,
  cancelBooking, rescheduleBooking, loadServices, validateBookingDate,
};
