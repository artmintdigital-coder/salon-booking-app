// Public (no login) routes for the customer booking page.
// IMPORTANT PRIVACY RULE: these routes never return other customers'
// details. Lookups require the exact phone number + booking code pair.
const express = require('express');
const rateLimit = require('express-rate-limit');
const { getDb } = require('../db');
const { getKolkataNow, toMinutes, addDays } = require('../utils/time');
const { isValidPhone, fail } = require('../validation');
const svc = require('../bookingService');

const router = express.Router();

// Spam protection on the public booking endpoint (spec requirement).
const bookingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20, // 20 booking attempts per IP per 15 minutes
  standardHeaders: true,
  message: { error: 'Too many booking attempts. Please try again in a few minutes.' },
});
const lookupLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true,
  message: { error: 'Too many lookups. Please try again later.' } });

function getSalonOr404(db, slug) {
  const salon = db.prepare('SELECT * FROM salons WHERE slug = ?').get(slug);
  if (!salon) throw fail(404, 'Salon not found.');
  return salon;
}

/** Public salon info: name, address, phone, working hours. No owner data. */
router.get('/salons/:slug', (req, res, next) => {
  try {
    const db = getDb();
    const salon = getSalonOr404(db, req.params.slug);
    const hours = db.prepare(
      'SELECT weekday, is_closed, open_time, close_time, lunch_start, lunch_end FROM working_hours WHERE salon_id = ? ORDER BY weekday'
    ).all(salon.id);
    res.json({
      name: salon.name, slug: salon.slug, address: salon.address,
      phone: salon.phone, buffer_minutes: salon.buffer_minutes, working_hours: hours,
    });
  } catch (e) { next(e); }
});

router.get('/salons/:slug/services', (req, res, next) => {
  try {
    const db = getDb();
    const salon = getSalonOr404(db, req.params.slug);
    res.json(db.prepare(
      'SELECT id, name, duration_minutes, price FROM services WHERE salon_id = ? AND is_active = 1 ORDER BY id'
    ).all(salon.id));
  } catch (e) { next(e); }
});

router.get('/salons/:slug/staff', (req, res, next) => {
  try {
    const db = getDb();
    const salon = getSalonOr404(db, req.params.slug);
    const staff = db.prepare(
      'SELECT id, name FROM staff WHERE salon_id = ? AND is_active = 1 ORDER BY id'
    ).all(salon.id);
    for (const s of staff) {
      s.working_days = db.prepare('SELECT weekday FROM staff_days WHERE staff_id = ? ORDER BY weekday')
        .all(s.id).map((r) => r.weekday);
    }
    res.json(staff);
  } catch (e) { next(e); }
});

/** Free slots for a date. Query: ?date=YYYY-MM-DD&services=1,2&staffId=any|3 */
router.get('/salons/:slug/availability', (req, res, next) => {
  try {
    const db = getDb();
    const salon = getSalonOr404(db, req.params.slug);
    const { date, staffId = 'any' } = req.query;
    const serviceIds = String(req.query.services || '').split(',').filter(Boolean);
    svc.validateBookingDate(date);
    const { duration } = svc.loadServices(db, salon.id, serviceIds);
    let slots = svc.availableSlotsFor(db, salon, date, duration, staffId);
    // Today: drop slots that have already started (Kolkata time).
    const now = getKolkataNow();
    if (date === now.date) {
      slots = slots.filter((t) => toMinutes(t) > toMinutes(now.time));
    }
    res.json({ date, duration_minutes: duration, slots });
  } catch (e) { next(e); }
});

/** Create a booking. Body: { salonSlug, customerName, phone, notes, serviceIds, staffId, date, startTime } */
router.post('/bookings', bookingLimiter, (req, res, next) => {
  try {
    const db = getDb();
    const salon = getSalonOr404(db, req.body.salonSlug);
    const booking = svc.createBooking(db, salon, req.body);
    res.status(201).json(publicBooking(booking));
  } catch (e) { next(e); }
});

/** Look up MY booking only: requires matching phone + booking code. */
router.get('/bookings/lookup', lookupLimiter, (req, res, next) => {
  try {
    const db = getDb();
    const { phone, code } = req.query;
    if (!isValidPhone(phone)) throw fail(400, 'Please enter a valid 10-digit phone number.');
    const booking = svc.findBookingByCodeAndPhone(db, code, phone);
    if (!booking) throw fail(404, 'Booking not found. Please check the booking ID and phone number.');
    res.json(publicBooking(booking));
  } catch (e) { next(e); }
});

router.post('/bookings/cancel', bookingLimiter, (req, res, next) => {
  try {
    const db = getDb();
    res.json(publicBooking(svc.cancelBooking(db, req.body.code, req.body.phone)));
  } catch (e) { next(e); }
});

router.post('/bookings/reschedule', bookingLimiter, (req, res, next) => {
  try {
    const db = getDb();
    const salon = getSalonOr404(db, req.body.salonSlug);
    const booking = svc.rescheduleBooking(
      db, salon, req.body.code, req.body.phone, req.body.date, req.body.startTime, req.body.staffId
    );
    res.json(publicBooking(booking));
  } catch (e) { next(e); }
});

/** Strip internal ids before sending a booking to a customer. */
function publicBooking(b) {
  return {
    booking_code: b.booking_code, salon_name: b.salon_name, salon_phone: b.salon_phone,
    customer_name: b.customer_name, customer_phone: b.customer_phone, staff_name: b.staff_name,
    date: b.date, start_time: b.start_time, end_time: b.end_time,
    total_duration: b.total_duration, total_price: b.total_price,
    status: b.status, notes: b.notes, services: b.services,
  };
}

module.exports = router;
