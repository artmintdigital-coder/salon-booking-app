// Seed data as a reusable function, so both `npm run seed` and the server
// itself (auto-seed on first boot, for one-click deploys) can use it.
// Seeds: 1 demo salon, 5 services, 2 staff members, sample bookings.
const bcrypt = require('bcryptjs');
const { addDays, getKolkataNow } = require('./utils/time');

/**
 * Seed the demo salon into an already-initialised database.
 * @param {object} db - better-sqlite3 database (schema already created)
 * @param {object} opts - { force: true } wipes the demo salon first
 * @returns {boolean} true if seeding ran, false if data already existed
 */
function seedDatabase(db, opts = {}) {
  const force = !!opts.force;
  const existing = db.prepare('SELECT id FROM salons WHERE slug = ?').get('glow-studio');
  if (existing && !force) {
    console.log('Seed data already exists. Use `npm run seed:force` to re-seed.');
    return false;
  }
  if (existing && force) {
    db.prepare('DELETE FROM salons WHERE id = ?').run(existing.id);
    console.log('Cleared existing demo salon.');
  }

  const now = getKolkataNow();
  const today = now.date;

  const salonId = db.prepare(`
    INSERT INTO salons (name, slug, address, phone, buffer_minutes)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    'Glow & Grace Salon',
    'glow-studio',
    'Shop 12, MG Road, Camp, Pune, Maharashtra 411001',
    '9876543210',
    10, // 10-minute buffer between appointments
  ).lastInsertRowid;

  // Demo owner login: demo@glowstudio.in / demo1234  (change this in production!)
  const hash = bcrypt.hashSync('demo1234', 10);
  db.prepare('INSERT INTO owners (salon_id, name, email, password_hash) VALUES (?, ?, ?, ?)')
    .run(salonId, 'Salon Owner', 'demo@glowstudio.in', hash);

  // Working hours: Mon–Sat 10:00–20:00 with a 14:00–15:00 lunch break, Sunday closed.
  const insertHours = db.prepare(`
    INSERT INTO working_hours (salon_id, weekday, is_closed, open_time, close_time, lunch_start, lunch_end)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (let weekday = 0; weekday <= 6; weekday++) {
    if (weekday === 0) insertHours.run(salonId, weekday, 1, null, null, null, null);
    else insertHours.run(salonId, weekday, 0, '10:00', '20:00', '14:00', '15:00');
  }

  const services = [
    ['Haircut', 30, 299],
    ['Hair Spa', 45, 599],
    ['Facial', 60, 799],
    ['Beard Trim', 15, 149],
    ['Hair Colour', 90, 1499],
  ];
  const serviceIds = {};
  const insertService = db.prepare(
    'INSERT INTO services (salon_id, name, duration_minutes, price) VALUES (?, ?, ?, ?)'
  );
  for (const [name, duration, price] of services) {
    serviceIds[name] = insertService.run(salonId, name, duration, price).lastInsertRowid;
  }

  const insertStaff = db.prepare('INSERT INTO staff (salon_id, name, phone) VALUES (?, ?, ?)');
  const insertDay = db.prepare('INSERT INTO staff_days (staff_id, weekday) VALUES (?, ?)');
  const priya = insertStaff.run(salonId, 'Priya Sharma', '9876500001').lastInsertRowid;
  const rahul = insertStaff.run(salonId, 'Rahul Verma', '9876500002').lastInsertRowid;
  for (let d = 1; d <= 6; d++) insertDay.run(priya, d); // Priya: Mon–Sat
  for (const d of [1, 2, 4, 5, 6]) insertDay.run(rahul, d); // Rahul: Mon, Tue, Thu, Fri, Sat

  // One blocked range (demo of the block feature) 5 days out, 16:00–18:00.
  db.prepare('INSERT INTO blocked_slots (salon_id, date, start_time, end_time, reason) VALUES (?, ?, ?, ?, ?)')
    .run(salonId, addDays(today, 5), '16:00', '18:00', 'Staff training');

  const insertCustomer = db.prepare('INSERT INTO customers (salon_id, name, phone) VALUES (?, ?, ?)');
  const insertBooking = db.prepare(`
    INSERT INTO bookings (salon_id, customer_id, staff_id, booking_code, date, start_time, end_time,
      total_duration, total_price, status, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertBookingService = db.prepare(
    'INSERT INTO booking_services (booking_id, service_id, price, duration_minutes) VALUES (?, ?, ?, ?)'
  );
  const book = (customerName, phone, staffId, code, date, start, end, duration, price, status, serviceNames) => {
    // Same customer may appear in several sample bookings: reuse their row.
    const existingCustomer = db.prepare('SELECT id FROM customers WHERE salon_id = ? AND phone = ?').get(salonId, phone);
    const customerId = existingCustomer
      ? existingCustomer.id
      : insertCustomer.run(salonId, customerName, phone).lastInsertRowid;
    const id = insertBooking.run(salonId, customerId, staffId, code, date, start, end, duration, price, status, '').lastInsertRowid;
    for (const name of serviceNames) {
      const svc = db.prepare('SELECT * FROM services WHERE id = ?').get(serviceIds[name]);
      insertBookingService.run(id, serviceIds[name], svc.price, svc.duration_minutes);
    }
  };

  book('Amit Kumar', '9876543210', priya, 'SB-DEMO01', today, '11:00', '11:30', 30, 299, 'Confirmed', ['Haircut']);
  book('Sneha Patel', '9876543211', priya, 'SB-DEMO02', today, '12:00', '13:00', 60, 799, 'Confirmed', ['Facial']);
  book('Vikram Singh', '9876543212', rahul, 'SB-DEMO03', addDays(today, 1), '10:30', '11:15', 45, 599, 'Confirmed', ['Hair Spa']);
  book('Amit Kumar', '9876543210', priya, 'SB-DEMO04', addDays(today, -2), '11:00', '11:30', 30, 299, 'Completed', ['Haircut']);
  book('Neha Gupta', '9876543213', rahul, 'SB-DEMO05', addDays(today, -3), '16:00', '16:30', 30, 299, 'No-show', ['Haircut']);
  book('Sneha Patel', '9876543211', priya, 'SB-DEMO06', addDays(today, -5), '17:00', '18:30', 90, 1499, 'Completed', ['Hair Colour']);

  console.log('Seeded Glow & Grace Salon (slug: glow-studio).');
  console.log('Owner login: demo@glowstudio.in / demo1234');
  console.log('Booking page: /book/glow-studio   |   Dashboard: /admin');
  return true;
}

module.exports = { seedDatabase };
