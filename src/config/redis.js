const Redis = require('ioredis');

let redis;

async function connectRedis() {
  redis = new Redis({
    host:     process.env.REDIS_HOST,
    port:     process.env.REDIS_PORT,
    password: process.env.REDIS_PASSWORD || undefined,
  });

  await redis.ping();
  console.log('[Redis] Connected');
}

function getRedis() {
  return redis;
}

module.exports = { connectRedis, getRedis };
