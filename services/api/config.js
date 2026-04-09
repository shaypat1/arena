'use strict';

module.exports = {
  port: parseInt(process.env.PORT) || 3001,
  databaseUrl: process.env.DATABASE_URL || 'postgresql://arena:arena_dev@localhost:5432/arena',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  jwtSecret: process.env.JWT_SECRET || 'dev_secret_change_in_prod',
  jwtExpiry: '24h',
  nodeEnv: process.env.NODE_ENV || 'development',
  geoBlockEnabled: process.env.GEO_BLOCK_ENABLED === 'true',
  s3: {
    endpoint: process.env.S3_ENDPOINT || 'http://localhost:9000',
    accessKey: process.env.S3_ACCESS_KEY || 'arena',
    secretKey: process.env.S3_SECRET_KEY || 'arena_dev_key',
    bucket: process.env.S3_BUCKET || 'arena-frames',
  },
};
