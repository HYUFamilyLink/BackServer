const { pool }     = require('../../config/database');
const { getRedis } = require('../../config/redis');
const { findAvailableRoom, internalCreateRoom } = require('../../controllers/roomController');

module.exports = function roomHandler(io, socket) {
  const redis = getRedis();

  // [수정] 1. 유저 접속 시 본인의 ID로 된 소켓 룸에 입장 (친구 요청/수락 알림 수신용)
  if (socket.user && socket.user.id) {
    socket.join(socket.user.id);
  }

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

    // [중요] 전체 유저에게 방 정보 전송
    io.to(roomId).emit('room:state', {
      roomId,
      joinCode, // [보강] 방 코드 포함
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

  socket.on('room:leave', async () => {
    await _leaveRoom(io, socket, redis);
  });

  socket.on('disconnect', async () => {
    await _leaveRoom(io, socket, redis);
  });
};

async function _leaveRoom(io, socket, redis) {
  const roomId = socket.roomId;
  if (!roomId) return;

  const participantKey = `room:${roomId}:participants`;
  
  try {
    const members = await redis.smembers(participantKey);
    
    // 1. Redis에서 본인 제거
    for (const m of members) {
      const u = JSON.parse(m);
      if (u.id === socket.user.id) {
        await redis.srem(participantKey, m);
        break;
      }
    }

    const remainingMembers = await redis.smembers(participantKey);
    const participants = remainingMembers.map(m => JSON.parse(m));
    
    if (participants.length === 0) {
      // 0명이면 방 폐쇄
      await pool.query(
        "UPDATE rooms SET status = 'closed', closed_at = NOW() WHERE id = $1",
        [roomId]
      );
      await redis.del(participantKey);
    } else {
      // [수정] 2. DB에서 현재 방의 코드를 다시 가져옴 (유실 방지)
      const { rows } = await pool.query("SELECT join_code FROM rooms WHERE id = $1", [roomId]);
      const currentJoinCode = rows[0]?.join_code;

      // [수정] 3. 남은 인원에게 'joinCode'를 포함하여 상태 전송
      // 프런트엔드 Store가 null을 받지 않도록 반드시 joinCode를 포함해야 함
      io.to(roomId).emit('room:state', { 
        roomId,
        joinCode: currentJoinCode, // [핵심 해결책]
        participants 
      });
      
      io.to(roomId).emit('room:user_left', { userId: socket.user.id });
    }
  } catch (err) {
    console.error('[Socket] Leave Error:', err);
  } finally {
    socket.leave(roomId);
    socket.roomId = null;
  }
}