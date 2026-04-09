'use strict';

const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const xss = require('xss');
const config = require('../api/config');

let io = null;
let pool = null;

/**
 * Initialize Socket.IO server on an existing HTTP server.
 */
function initSocketServer(httpServer, pgPool) {
  pool = pgPool;

  io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // Authentication middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (token) {
      try {
        socket.user = jwt.verify(token, config.jwtSecret);
      } catch {
        // Allow unauthenticated connections (view-only)
      }
    }
    next();
  });

  io.on('connection', (socket) => {
    console.log(`[ws] Client connected: ${socket.id} (user: ${socket.user?.username || 'anon'})`);

    // Join user's private room if authenticated
    if (socket.user) {
      socket.join(`user:${socket.user.id}`);
    }

    // ─── Join feed room ───────────────────────────────────
    socket.on('join:feed', ({ feed_id }) => {
      if (!feed_id) return;
      socket.join(`feed:${feed_id}`);
      socket.join(`feed:${feed_id}:chat`);

      // Update viewer count
      const room = io.sockets.adapter.rooms.get(`feed:${feed_id}`);
      const viewerCount = room ? room.size : 0;
      io.to(`feed:${feed_id}`).emit('feed:viewers', { feed_id, count: viewerCount });
    });

    // ─── Leave feed room ──────────────────────────────────
    socket.on('leave:feed', ({ feed_id }) => {
      if (!feed_id) return;
      socket.leave(`feed:${feed_id}`);
      socket.leave(`feed:${feed_id}:chat`);

      const room = io.sockets.adapter.rooms.get(`feed:${feed_id}`);
      const viewerCount = room ? room.size : 0;
      io.to(`feed:${feed_id}`).emit('feed:viewers', { feed_id, count: viewerCount });
    });

    // ─── Chat messages ────────────────────────────────────
    socket.on('chat:send', async ({ feed_id, message }) => {
      if (!socket.user) return;
      if (!feed_id || !message) return;

      const sanitized = xss(message.trim().slice(0, 500));
      if (!sanitized) return;

      try {
        // Store in DB
        await pool.query(
          `INSERT INTO chat_messages (feed_id, user_id, message)
           VALUES ($1, $2, $3)`,
          [feed_id, socket.user.id, sanitized]
        );

        // Broadcast to feed room
        io.to(`feed:${feed_id}:chat`).emit('chat:message', {
          feed_id,
          username: socket.user.username,
          message: sanitized,
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        console.error('[ws] Chat save error:', err.message);
      }
    });

    socket.on('disconnect', () => {
      // Viewer counts auto-update when rooms shrink
    });
  });

  return io;
}

function getIO() {
  return io;
}

module.exports = { initSocketServer, getIO };
