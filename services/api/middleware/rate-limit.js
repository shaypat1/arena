'use strict';

/**
 * Redis-backed rate limiter using sliding window counters.
 */
function createRateLimiter(redisClient, { prefix, maxRequests, windowSeconds }) {
  return async (req, res, next) => {
    if (!redisClient) return next(); // skip if Redis unavailable

    const key = `ratelimit:${prefix}:${req.user?.id || req.ip}`;
    try {
      const current = await redisClient.incr(key);
      if (current === 1) {
        await redisClient.expire(key, windowSeconds);
      }
      if (current > maxRequests) {
        return res.status(429).json({
          error: 'Too many requests',
          retry_after: windowSeconds,
        });
      }
      next();
    } catch {
      next(); // fail open
    }
  };
}

// Pre-configured limiters
function generalLimiter(redis) {
  return createRateLimiter(redis, { prefix: 'general', maxRequests: 100, windowSeconds: 60 });
}

function betLimiter(redis) {
  return createRateLimiter(redis, { prefix: 'bet', maxRequests: 10, windowSeconds: 60 });
}

function chatLimiter(redis) {
  return createRateLimiter(redis, { prefix: 'chat', maxRequests: 30, windowSeconds: 60 });
}

function withdrawalLimiter(redis) {
  return createRateLimiter(redis, { prefix: 'withdraw', maxRequests: 5, windowSeconds: 3600 });
}

module.exports = { createRateLimiter, generalLimiter, betLimiter, chatLimiter, withdrawalLimiter };
