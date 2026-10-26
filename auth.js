// Owner login. Passwords are verified with bcrypt against the stored hash;
// the plaintext password is never stored and never returned.
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { getDb } = require('../db');
const { signOwnerToken } = require('../auth');
const { fail } = require('../validation');

const router = express.Router();
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true,
  message: { error: 'Too many login attempts. Please try again later.' } });

router.post('/login', loginLimiter, (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) throw fail(400, 'Email and password are required.');
    const db = getDb();
    const owner = db.prepare('SELECT * FROM owners WHERE email = ?').get(String(email).trim().toLowerCase());
    if (!owner || !bcrypt.compareSync(password, owner.password_hash)) {
      throw fail(401, 'Invalid email or password.');
    }
    const salon = db.prepare('SELECT * FROM salons WHERE id = ?').get(owner.salon_id);
    res.json({
      token: signOwnerToken(owner),
      owner: { name: owner.name, email: owner.email },
      salon: { name: salon.name, slug: salon.slug },
    });
  } catch (e) { next(e); }
});

module.exports = router;
