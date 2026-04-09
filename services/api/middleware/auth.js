'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');

/**
 * JWT authentication middleware.
 * Extracts and verifies token from Authorization: Bearer <token> header.
 * Sets req.user = { id, username, email, is_house }.
 */
function authRequired(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Optional auth — sets req.user if token present, otherwise continues.
 */
function authOptional(req, res, next) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    try {
      req.user = jwt.verify(header.slice(7), config.jwtSecret);
    } catch {
      // ignore invalid token for optional auth
    }
  }
  next();
}

/**
 * Generate a JWT for a user.
 */
function generateToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, email: user.email, is_house: user.is_house },
    config.jwtSecret,
    { expiresIn: config.jwtExpiry }
  );
}

module.exports = { authRequired, authOptional, generateToken };
