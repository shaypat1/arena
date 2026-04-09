'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { generateToken } = require('../middleware/auth');
const { ensureBalance } = require('../../wallet/balance');

const router = express.Router();
let pool = null;

function init(pgPool) {
  pool = pgPool;
}

// ─── POST /register ─────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || username.length < 3 || username.length > 32) {
      return res.status(400).json({ error: 'Username must be 3-32 characters' });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Check uniqueness
    const { rows: existing } = await pool.query(
      `SELECT id FROM users WHERE username = $1 OR (email = $2 AND $2 IS NOT NULL)`,
      [username, email || null]
    );
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Username or email already taken' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const { rows } = await pool.query(
      `INSERT INTO users (username, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, username, email, created_at`,
      [username, email || null, passwordHash]
    );

    const user = rows[0];

    // Create initial balance record
    await ensureBalance(pool, user.id);

    const token = generateToken(user);

    res.status(201).json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        created_at: user.created_at,
      },
    });
  } catch (err) {
    console.error('[auth] Register error:', err.message);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ─── POST /login ────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const { rows } = await pool.query(
      `SELECT id, username, email, password_hash, is_banned, is_house
       FROM users WHERE email = $1`,
      [email]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = rows[0];

    if (user.is_banned) {
      return res.status(403).json({ error: 'Account is banned' });
    }
    if (user.is_house) {
      return res.status(403).json({ error: 'Cannot login to house account' });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken(user);

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
      },
    });
  } catch (err) {
    console.error('[auth] Login error:', err.message);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ─── GET /me ────────────────────────────────────────────────
router.get('/me', async (req, res) => {
  // req.user set by auth middleware in the parent router
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, username, email, created_at, total_wagered, total_won, total_profit,
              win_count, loss_count, current_streak, best_streak
       FROM users WHERE id = $1`,
      [req.user.id]
    );

    if (!rows.length) return res.status(404).json({ error: 'User not found' });

    res.json({ user: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

module.exports = { router, init };
