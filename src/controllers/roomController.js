const { pool } = require('../config/database');
const { getRedis } = require('../config/redis');

function generateJoinCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

async function internalCreateRoom(hostId) {
  let joinCode;
  for (let i = 0; i < 10; i++) {
    joinCode = generateJoinCode();
    const { rows } = await pool.query('SELECT id FROM rooms WHERE join_code = $1', [joinCode]);
    if (!rows.length) break;
  }

  const { rows } = await pool.query(
    `INSERT INTO rooms (host_id, join_code, status)
     VALUES ($1, $2, 'waiting')
     RETURNING id, join_code, status, host_id`,
    [hostId, joinCode]
  );
  return rows[0];
}

async function findAvailableRoom() {
  const redis = getRedis();
  const { rows: rooms } = await pool.query(
    "SELECT id, join_code, status FROM rooms WHERE status != 'closed' ORDER BY created_at DESC"
  );

  for (const room of rooms) {
    const participantKey = `room:${room.id}:participants`;
    const members = await redis.smembers(participantKey);
    if (members.length < 4) {
      return room;
    }
  }
  return null;
}

async function buildRoomList() {
  const { rows: rooms } = await pool.query(
    `SELECT r.id, r.join_code, r.status, r.created_at, u.name as host_name, u.profile_image as host_profile_image
     FROM rooms r
     JOIN users u ON r.host_id = u.id
     WHERE r.status != 'closed'
     ORDER BY r.created_at DESC`
  );
  const redis = getRedis();
  
  return Promise.all(rooms.map(async (room) => {
    const participants = await redis.smembers(`room:${room.id}:participants`);
    const currentTurnId = await redis.lindex(`room:${room.id}:turn_queue`, 0);
    
    let currentSongTitle = '대기 중';
    
    if (room.status === 'singing') {
      const playingVideoStr = await redis.get(`room:${room.id}:playing_video`);
      if (playingVideoStr) {
        const playingVideo = JSON.parse(playingVideoStr);
        currentSongTitle = `${playingVideo.title}`;
      }
    }

    return {
      id: room.id, 
      joinCode: room.join_code, 
      status: room.status,
      hostName: room.host_name, 
      hostProfileImage: room.host_profile_image, 
      participantCount: participants.length,
      currentSong: currentSongTitle,
      currentTurnId: currentTurnId
    };
  }));
}

async function getActiveRooms(req, res) {
  try {
    res.json(await buildRoomList());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '방 목록을 불러오지 못했습니다.' });
  }
}

async function createRoom(req, res) {
  try {
    const room = await internalCreateRoom(req.user.id);
    res.status(201).json(room);
  } catch (err) {
    res.status(500).json({ error: '방 생성 실패' });
  }
}

async function getRoom(req, res) {
  const { joinCode } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT r.*, u.name AS host_name, u.profile_image AS host_profile_image
       FROM rooms r
       JOIN users u ON r.host_id = u.id
       WHERE r.join_code = $1 AND r.status != 'closed'`,
      [joinCode.toUpperCase()]
    );
    if (!rows.length) return res.status(404).json({ error: '방을 찾을 수 없습니다.' });
    
    const roomData = {
      ...rows[0],
      hostProfileImage: rows[0].host_profile_image
    };
    res.json(roomData);
  } catch (err) {
    res.status(500).json({ error: '서버 오류' });
  }
}

async function closeRoom(req, res) {
  const { roomId } = req.params;
  try {
    const { rows } = await pool.query(
      "UPDATE rooms SET status = 'closed', closed_at = NOW() WHERE id = $1 AND host_id = $2 RETURNING id",
      [roomId, req.user.id]
    );
    if (!rows.length) return res.status(403).json({ error: '권한이 없습니다.' });
    res.json({ message: '방이 닫혔습니다.' });
  } catch (err) {
    res.status(500).json({ error: '서버 오류' });
  }
}

module.exports = {
  createRoom, getRoom, closeRoom, internalCreateRoom, findAvailableRoom, getActiveRooms, buildRoomList
};