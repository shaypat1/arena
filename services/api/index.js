'use strict';

const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { Pool } = require('pg');
const { createClient } = require('redis');

const config = require('./config');
const { authRequired, authOptional } = require('./middleware/auth');
const { generalLimiter, betLimiter, withdrawalLimiter } = require('./middleware/rate-limit');

// Route modules
const { router: authRoutes, init: initAuth } = require('./routes/auth');
const { router: feedRoutes, init: initFeeds } = require('./routes/feeds');
const { router: settlementRoutes, init: initSettlement } = require('./routes/settlement');
const { router: disputeRoutes, init: initDisputes } = require('./routes/disputes');
const { router: leaderboardRoutes, init: initLeaderboard } = require('./routes/leaderboard');
const { router: userRoutes, init: initUsers } = require('./routes/users');

// Service modules
const { router: walletRoutes, init: initWallet } = require('../wallet/index');
const { router: bettingRoutes, init: initBetting } = require('../betting/routes');
const RoundScheduler = require('../betting/round-scheduler');
const { initSocketServer } = require('../realtime/socket-server');
const { startBridge } = require('../realtime/redis-bridge');
const { startSettlementListener } = require('./settlement-listener');

const app = express();
const server = http.createServer(app);

// ─── Global middleware ──────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.set('trust proxy', 1);

// ─── Health check ───────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

async function start() {
  // ─── Database ───────────────────────────────────────────
  const pool = new Pool({ connectionString: config.databaseUrl });
  await pool.query('SELECT 1');
  console.log('[api] PostgreSQL connected');

  // ─── Redis (publisher) ──────────────────────────────────
  const redis = createClient({ url: config.redisUrl });
  await redis.connect();
  console.log('[api] Redis connected');

  // ─── Initialize route modules ───────────────────────────
  initAuth(pool);
  initFeeds(pool);
  initSettlement(pool);
  initDisputes(pool);
  initLeaderboard(pool);
  initUsers(pool);
  initBetting(pool, redis);

  // ─── Initialize wallet service ──────────────────────────
  await initWallet(pool, redis);

  // ─── Rate limiting ──────────────────────────────────────
  const rateLimiter = generalLimiter(redis);

  // ─── Mount routes ───────────────────────────────────────
  // Auth routes — register/login are public, /me requires auth
  app.post('/api/auth/register', rateLimiter, (req, res, next) => { req.url = '/register'; authRoutes.handle(req, res, next); });
  app.post('/api/auth/login', rateLimiter, (req, res, next) => { req.url = '/login'; authRoutes.handle(req, res, next); });
  app.get('/api/auth/me', rateLimiter, authRequired, (req, res, next) => { req.url = '/me'; authRoutes.handle(req, res, next); });

  // Public routes (no auth required)
  app.use('/api/feeds', rateLimiter, feedRoutes);
  app.use('/api/settlement-log', rateLimiter, settlementRoutes);
  app.use('/api/leaderboard', rateLimiter, leaderboardRoutes);
  app.use('/api/users', rateLimiter, userRoutes);

  // Disputes — list is public, create requires auth
  app.get('/api/disputes', rateLimiter, disputeRoutes);
  app.post('/api/disputes/create', rateLimiter, authRequired, (req, res, next) => { req.url = '/create'; disputeRoutes.handle(req, res, next); });

  // Protected routes
  app.use('/api/wallet', rateLimiter, authRequired, walletRoutes);
  app.use('/api/bets', authRequired, betLimiter(redis), bettingRoutes);
  app.use('/api/rounds', rateLimiter, authOptional, bettingRoutes);

  // ─── Camera proxy (avoids CORS for external camera feeds) ──
  const axios = require('axios');
  app.get('/api/proxy/camera', async (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: 'url required' });
    try {
      const response = await axios.get(url, {
        responseType: 'stream',
        maxRedirects: 5,
        timeout: 15000,
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      const ct = response.headers['content-type'] || 'application/octet-stream';
      res.set('Content-Type', ct);
      res.set('Cache-Control', ct.includes('m3u8') ? 'no-cache' : 'max-age=5');
      res.set('Access-Control-Allow-Origin', '*');
      // Rewrite m3u8 segment URLs to go through proxy too
      if (ct.includes('mpegurl') || ct.includes('m3u8') || url.endsWith('.m3u8')) {
        let body = '';
        response.data.on('data', (chunk) => body += chunk);
        response.data.on('end', () => {
          // Resolve relative URLs to absolute via proxy
          const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);
          const rewritten = body.replace(/^(?!#)(.*\.(?:m3u8|ts|mp4|m4s).*)$/gm, (match) => {
            const absolute = match.startsWith('http') ? match : baseUrl + match;
            return `/api/proxy/camera?url=${encodeURIComponent(absolute)}`;
          });
          res.set('Content-Type', 'application/vnd.apple.mpegurl');
          res.send(rewritten);
        });
      } else {
        response.data.pipe(res);
      }
    } catch (err) {
      res.status(502).json({ error: 'Failed to fetch camera feed' });
    }
  });

  // ─── WebSocket ──────────────────────────────────────────
  initSocketServer(server, pool);
  await startBridge(config.redisUrl);
  console.log('[api] WebSocket server initialized');

  // ─── Settlement listener ────────────────────────────────
  await startSettlementListener(pool, redis, config.redisUrl);

  // ─── Round scheduler ────────────────────────────────────
  const scheduler = new RoundScheduler(pool, redis);
  await scheduler.start();

  // ─── Start server ───────────────────────────────────────
  server.listen(config.port, () => {
    console.log(`[api] Arena API server running on port ${config.port}`);
  });

  // ─── Graceful shutdown ──────────────────────────────────
  const shutdown = async () => {
    console.log('[api] Shutting down...');
    scheduler.stop();
    server.close();
    await redis.quit();
    await pool.end();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start().catch((err) => {
  console.error('[api] Fatal startup error:', err);
  process.exit(1);
});
