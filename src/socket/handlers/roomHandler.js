const { pool }     = require('../../config/database');
const { getRedis } = require('../../config/redis');
const { findAvailableRoom, internalCreateRoom, buildRoomList } = require('../../controllers/roomController');

async function broadcastRoomList(io) {
  try {
    const rooms = await buildRoomList();
    io.emit('rooms:updated', rooms);
  } catch (err) {
    console.error('[Socket] broadcastRoomList error:', err);
  }
}

module.exports = function roomHandler(io, socket) {
  const redis = getRedis();

  // 1. 유저 접속 시 본인의 ID로 된 소켓 룸에 입장
  if (socket.user && socket.user.id) {
    socket.join(String(socket.user.id).trim());
  }

  // 방 입장 공통 로직
  const joinRoomAction = async (roomId, joinCode) => {
    socket.join(roomId);
    socket.roomId = roomId;

    const participantKey = `room:${roomId}:participants`;
    const myIdStr = String(socket.user.id).trim();

    // [중복 방어] 기존 배열에 내 ID가 존재하면 삭제 후 재삽입
    const existingMembers = await redis.smembers(participantKey);
    for (const m of existingMembers) {
      const parsed = JSON.parse(m);
      if (String(parsed.id).trim() === myIdStr) {
        await redis.srem(participantKey, m);
      }
    }

    const userData = JSON.stringify({
      id: myIdStr,
      nickname: socket.user.nickname,
      role: socket.user.role
    });

    await redis.sadd(participantKey, userData);
    await redis.expire(participantKey, 86400);

    const updatedMembers = await redis.smembers(participantKey);
    const participants = updatedMembers.map(m => JSON.parse(m));

    // 전체 인원에게 현재 방의 완성된 명단 전송 (나 포함)
    io.to(roomId).emit('room:state', {
      roomId,
      joinCode,
      status: 'waiting',
      participants,
    });

    // ✨ [수정] socket.to 를 사용하여 나를 제외한 나머지 인원에게만 '새 유저 입장' 알림 전송
    // 이렇게 해야 프론트엔드에서 내 정보가 중복으로 추가되지 않습니다.
    socket.to(roomId).emit('room:user_joined',{
      id: myIdStr,
      nickname: socket.user.nickname,
      role: socket.user.role,
    });
  };

  socket.on('room:match', async () => {
    try {
      let room = await findAvailableRoom();
      if (!room) {
        room = await internalCreateRoom(socket.user.id);
      }
      await joinRoomAction(room.id, room.join_code);
      await broadcastRoomList(io);
    } catch (err) {
      console.error('[Socket] Match Error:', err);
      socket.emit('error', { message: '매칭 처리 중 오류 발생' });
    }
  });

  socket.on('room:create', async (payload = {}) => {
    try {
      const { invitedFriends = [] } = payload;
      const room = await internalCreateRoom(socket.user.id);
      await joinRoomAction(room.id, room.join_code);
      await broadcastRoomList(io);

      if (invitedFriends.length > 0) {
        const inviteData = {
          id: room.id,
          roomId: room.id,
          joinCode: room.join_code,
          hostName: socket.user.nickname,
          currentSong: '대기 중',
          participantCount: 1
        };
        invitedFriends.forEach(friendId => {
          io.to(String(friendId).trim()).emit('room:invite', inviteData);
        });
      }
    } catch (err) {
      console.error('[Socket] Create Room Error:', err);
      socket.emit('error', { message: '새 방 생성 중 오류 발생' });
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

  socket.on('room:send_invites', async (payload) => {
    try {
      const { invitedFriends = [], roomId, joinCode, currentSong, participantCount } = payload;
      if (!invitedFriends.length) return;
      const inviteData = {
        id: roomId, roomId, joinCode, hostName: socket.user.nickname,
        currentSong, participantCount
      };
      invitedFriends.forEach(friendId => {
        io.to(String(friendId).trim()).emit('room:invite', inviteData);
      });
    } catch (err) {
      console.error('[Socket] Send Invites Error:', err);
    }
  });
};

async function _leaveRoom(io, socket, redis) {
  const roomId = socket.roomId;
  if (!roomId) return;

  const participantKey = `room:${roomId}:participants`;
  const myIdStr = String(socket.user.id).trim();
  
  try {
    const members = await redis.smembers(participantKey);
    for (const m of members) {
      const u = JSON.parse(m);
      if (String(u.id).trim() === myIdStr) {
        await redis.srem(participantKey, m);
      }
    }

    const remainingMembers = await redis.smembers(participantKey);
    const participants = remainingMembers.map(m => JSON.parse(m));
    
    if (participants.length === 0) {
      await pool.query("UPDATE rooms SET status = 'closed', closed_at = NOW() WHERE id = $1", [roomId]);
      await redis.del(participantKey);
      await broadcastRoomList(io);
    } else {
      const { rows } = await pool.query("SELECT join_code FROM rooms WHERE id = $1", [roomId]);
      socket.to(roomId).emit('room:state', { 
        roomId,
        joinCode: rows[0]?.join_code,
        participants 
      });
      io.to(roomId).emit('room:user_left', { userId: myIdStr });
    }
  } catch (err) {
    console.error('[Socket] Leave Error:', err);
  } finally {
    socket.leave(roomId);
    socket.roomId = null;
  }
}