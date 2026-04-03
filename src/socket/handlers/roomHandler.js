const { pool }     = require('../../config/database');
const { getRedis } = require('../../config/redis');
const { findAvailableRoom, internalCreateRoom } = require('../../controllers/roomController');

module.exports = function roomHandler(io, socket) {
  const redis = getRedis();

  // 방 입장 공통 로직
  const joinRoomAction = async (roomId, joinCode) => {
    socket.join(roomId);
    socket.roomId = roomId;

    const participantKey = `room:${roomId}:participants`;
    const userData = JSON.stringify({
      id: socket.user.id,
      nickname: socket.user.nickname,
      role: socket.user.role
    });

    await redis.sadd(participantKey, userData);
    await redis.expire(participantKey, 86400); // 24시간 유지

    const members = await redis.smembers(participantKey);
    const participants = members.map(m => JSON.parse(m));

    io.to(roomId).emit('room:state', {
      roomId,
      joinCode,
      status: 'waiting',
      participants,
    });
  };

  socket.on('room:match', async () => {
    try {
      let room = await findAvailableRoom();
      if (!room) {
        room = await internalCreateRoom(socket.user.id);
      }
      await joinRoomAction(room.id, room.join_code);
    } catch (err) {
      console.error('[Socket] Match Error:', err);
      socket.emit('error', { message: '매칭 처리 중 오류 발생' });
    }
  });

  socket.on('room:join', async ({ joinCode } = {}, ack) => {
    try {
      const { rows } = await pool.query(
        `SELECT * FROM rooms WHERE join_code = $1 AND status != 'closed'`,
        [joinCode.toUpperCase()]
      );
      if (!rows.length) return ack?.({ error: '방을 찾을 수 없습니다.' });
      
      await joinRoomAction(rows[0].id, rows[0].join_code);
      ack?.({ roomId: rows[0].id });
    } catch (err) {
      ack?.({ error: '입장 실패' });
    }
  });

  // 중요: _leaveRoom 호출 시 await가 필요한 경우를 대비해 async로 처리
  socket.on('room:leave', async () => {
    await _leaveRoom(io, socket, redis);
  });

  socket.on('disconnect', async () => {
    await _leaveRoom(io, socket, redis);
  });
};

// SYNTAX ERROR 해결: async 키워드 확인
async function _leaveRoom(io, socket, redis) {
  const roomId = socket.roomId;
  if (!roomId) return;

  const participantKey = `room:${roomId}:participants`;
  
  try {
    const members = await redis.smembers(participantKey);
    
    // Redis에서 해당 유저 제거
    for (const m of members) {
      const u = JSON.parse(m);
      if (u.id === socket.user.id) {
        await redis.srem(participantKey, m);
        break;
      }
    }

    // 남은 인원 확인
    const remaining = await redis.smembers(participantKey);
    
    if (remaining.length === 0) {
      // 0명이면 방 폐쇄
      await pool.query(
        "UPDATE rooms SET status = 'closed', closed_at = NOW() WHERE id = $1",
        [roomId]
      );
      await redis.del(participantKey);
    } else {
      // 인원이 남았다면 퇴장 알림
      io.to(roomId).emit('room:user_left', { userId: socket.user.id });
    }
  } catch (err) {
    console.error('[Socket] Leave Error:', err);
  } finally {
    socket.leave(roomId);
    socket.roomId = null;
  }
}