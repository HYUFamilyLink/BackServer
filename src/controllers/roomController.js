const { pool }     = require('../config/database');
const { getRedis } = require('../config/redis');

// 6자리 랜덤 참여 코드 생성
function generateJoinCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

async function createRoom(req, res) {
  const hostId = req.user.id;

  // 중복 없는 joinCode 생성
  let joinCode;
  for (let i = 0; i < 10; i++) {
    joinCode = generateJoinCode();
    const { rows } = await pool.query(
      'SELECT id FROM rooms WHERE join_code = $1',
      [joinCode],
    );
    if (!rows.length) break;
  }

  const { rows } = await pool.query(
    `INSERT INTO rooms (host_id, join_code)
     VALUES ($1, $2)
     RETURNING id, join_code, status, created_at`,
    [hostId, joinCode],
  );

  res.status(201).json(rows[0]);
}

async function getRoom(req, res) {
  const { joinCode } = req.params;

  const { rows } = await pool.query(
    `SELECT r.*, u.nickname AS host_nickname
     FROM rooms r
     JOIN users u ON r.host_id = u.id
     WHERE r.join_code = $1 AND r.status != 'closed'`,
    [joinCode],
  );

  if (!rows.length) {
    return res.status(404).json({ error: 'Room not found' });
  }

  // Redis에 현재 접속자 수 조회
  const redis       = getRedis();
  const participants = await redis.smembers(`room:${rows[0].id}:participants`);

  res.json({ ...rows[0], participantCount: participants.length });
}

async function closeRoom(req, res) {
  const { roomId } = req.params;
  const userId     = req.user.id;

  const { rows } = await pool.query(
    `UPDATE rooms SET status = 'closed', closed_at = NOW()
     WHERE id = $1 AND host_id = $2
     RETURNING id`,
    [roomId, userId],
  );

  if (!rows.length) {
    return res.status(403).json({ error: 'Not authorized or room not found' });
  }

  res.json({ message: 'Room closed' });
}

module.exports = { createRoom, getRoom, closeRoom };
