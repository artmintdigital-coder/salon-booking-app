// Salon Appointment Booking app — entry point.
//   npm run seed   (once, for demo data)
//   npm start      (serves API + booking page + dashboard on PORT, default 3000)
const path = require('path');
const express = require('express');
const { getDb } = require('./db');

const app = express();
app.use(express.json({ limit: '100kb' }));

// Initialise the database (creates tables on first run).
const db = getDb();

// Auto-seed on first boot (deploy-friendly): if the database has no salons
// yet, create the demo salon so the deployed app works immediately with no
// shell step. Disable with AUTO_SEED=false. Never overwrites existing data.
if (process.env.AUTO_SEED !== 'false') {
  try {
    const salonCount = db.prepare('SELECT COUNT(*) AS n FROM salons').get().n;
    if (salonCount === 0) require('./seedData').seedDatabase(db);
  } catch (e) {
    console.error('Auto-seed failed (app will still start):', e.message);
  }
}

app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api', require('./routes/public'));

// Static frontend (plain HTML/CSS/JS, mobile-first).
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));
app.get('/book/:slug', (req, res) => res.sendFile(path.join(publicDir, 'book.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(publicDir, 'admin.html')));
app.get('/', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));

// JSON 404 for unknown API routes (keeps frontend error handling simple).
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// Central error handler: our fail(status, message) errors + a safe fallback.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong. Please try again.' });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Salon booking app running at http://localhost:${PORT}`);
    console.log(`Demo booking page: http://localhost:${PORT}/book/glow-studio`);
    console.log(`Owner dashboard:   http://localhost:${PORT}/admin`);
  });
}

module.exports = app;
