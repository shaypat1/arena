'use strict';

const geoip = require('geoip-lite');
const config = require('../config');

const BLOCKED_COUNTRIES = [
  'US', 'GB', 'AU', 'FR', 'NL', 'BE', 'ES', 'IT', 'DE', 'AT',
  'PT', 'SE', 'CH', 'IL', 'KR', 'SG', 'HK', 'CU', 'IR', 'KP',
];

function geoBlock(req, res, next) {
  if (!config.geoBlockEnabled) return next();

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip;

  // Skip for local/private IPs
  if (ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
    return next();
  }

  const geo = geoip.lookup(ip);
  if (geo && BLOCKED_COUNTRIES.includes(geo.country)) {
    return res.status(451).json({
      error: 'Service not available in your region',
      country: geo.country,
    });
  }

  next();
}

module.exports = { geoBlock, BLOCKED_COUNTRIES };
