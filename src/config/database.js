const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     process.env.DB_PORT,
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function connectDB() {
  const client = await pool.connect();
  await client.query('SELECT 1');
  client.release();
  console.log('[DB] PostgreSQL connected');
}

module.exports = { pool, connectDB };
