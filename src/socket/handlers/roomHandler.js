const { pool }         = require('../../config/database');
const { getRedis }     = require('../../config/redis');
const { createRouter, deleteRouter } = require('../../config/mediasoup');

/**
 * 이벤트 목록
 *   room:join    { joinCode }          → 방 입장
 *   room:leave                         → 방 퇴장
 *
 * 브로드캐스트
 *   room:user_joined  { userId, nickname, role }
 *   room:user_left    { userId, nickname }
 *   room:state        { roomId, status, participants[] }  ← 입장 시 현재 상태 전달
 */
module.exports = function roomHandler(io, socket) {
  const redis = getRedis();

  socket.on('room:join', async ({ joinCode } = {}, ack) => {
    try {
      // 방 조회
      const { rows } = await pool.query(
        `SELECT * FROM rooms WHERE join_code = $1 AND status != 'closed'`,
        [joinCode],
      );
      if (!rows.length) {
        return ack?.({ error: 'Room not found' });
      }
      const room = rows[0];

      // Socket.IO room 참여
      socket.join(room.id);
      socket.roomId = room.id;

      // Redis에 참여자 등록
      const participantKey = `room:${room.id}:participants`;
      await redis.sadd(participantKey, socket.user.id);
      await redis.expire(participantKey, 60 * 60 * 24); // 24h TTL

      // mediasoup Router가 없으면 생성 (방당 1개)
      const { getRouter } = require('../../config/mediasoup');
      if (!getRouter(room.id)) {
        await createRouter(room.id);
      }

      // 현재 참여자 목록
      const memberIds   = await redis.smembers(participantKey);
      const participants = memberIds.map((id) => ({ id }));

      // 입장한 본인에게 방 상태 전달
      socket.emit('room:state', {
        roomId:       room.id,
        joinCode:     room.join_code,
        status:       room.status,
        participants,
      });

      // 같은 방 다른 사람들에게 알림
      socket.to(room.id).emit('room:user_joined', {
        userId:   socket.user.id,
        nickname: socket.user.nickname,
        role:     socket.user.role,
      });

      ack?.({ roomId: room.id });
    } catch (err) {
      console.error('[roomHandler] room:join error', err);
      ack?.({ error: 'Server error' });
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
  await redis.srem(participantKey, socket.user.id);

  socket.to(roomId).emit('room:user_left', {
    userId:   socket.user.id,
    nickname: socket.user.nickname,
  });

  // 마지막 사람이 나가면 Router 정리
  const remaining = await redis.scard(participantKey);
  if (remaining === 0) {
    deleteRouter(roomId);
  }

  socket.leave(roomId);
  socket.roomId = null;
}
