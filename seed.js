// Seed data: 1 demo salon, 5 services, 2 staff members, sample bookings.
// Run:  npm run seed          (does nothing if data already exists)
//       npm run seed:force    (wipes the demo salon's data and re-seeds)
// The actual seeding logic lives in seedData.js (also used for auto-seed
// on first boot when the app is deployed).
const { getDb } = require('./db');
const { seedDatabase } = require('./seedData');

seedDatabase(getDb(), { force: process.argv.includes('--force') });
