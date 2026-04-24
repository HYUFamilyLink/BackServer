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

  if (socket.user && socket.user.id) {
    socket.join(String(socket.user.id).trim());
  }

  const emitRoomState = async (roomId, joinCode) => {
    const participantKey = `room:${roomId}:participants`;
    const turnKey = `room:${roomId}:turn_queue`;

    const members = await redis.smembers(participantKey);
    const participants = members.map(m => JSON.parse(m));
    
    const turnOrder = await redis.lrange(turnKey, 0, -1);
    
    const sortedParticipants = turnOrder.map(id => 
      participants.find(p => String(p.id).trim() === String(id).trim())
    ).filter(Boolean);

    participants.forEach(p => {
      if (!sortedParticipants.find(sp => String(sp.id).trim() === String(p.id).trim())) {
        sortedParticipants.push(p);
      }
    });

    // ✨ 난입 유저를 위한 현재 곡 상태 조회
    const playingVideoStr = await redis.get(`room:${roomId}:playing_video`);
    const playingVideo = playingVideoStr ? JSON.parse(playingVideoStr) : null;

    // DB에서 정확한 방 상태 가져오기
    const { rows } = await pool.query("SELECT status FROM rooms WHERE id = $1", [roomId]);
    const currentStatus = rows.length > 0 ? rows[0].status : 'waiting';

    io.to(roomId).emit('room:state', {
      roomId,
      joinCode,
      status: currentStatus, 
      participants: sortedParticipants,
      currentTurnId: turnOrder.length > 0 ? turnOrder[0] : null,
      playingVideo // 현재 재생 중인 노래 정보 동기화
    });
  };

  const rotateTurn = async (roomId) => {
    const turnKey = `room:${roomId}:turn_queue`;
    
    // ✨ 차례가 넘어가면 곡 정보 폐기 및 방 상태 업데이트
    await redis.del(`room:${roomId}:playing_video`);
    await pool.query("UPDATE rooms SET status = 'waiting' WHERE id = $1", [roomId]);

    const currentSingerId = await redis.lpop(turnKey);
    if (currentSingerId) {
      await redis.rpush(turnKey, currentSingerId);
    }
    
    const { rows } = await pool.query("SELECT join_code FROM rooms WHERE id = $1", [roomId]);
    if (rows.length > 0) {
      await emitRoomState(roomId, rows[0].join_code);
    }
  };

  const joinRoomAction = async (roomId, joinCode) => {
    socket.join(roomId);
    socket.roomId = roomId;

    const myIdStr = String(socket.user.id).trim();
    const participantKey = `room:${roomId}:participants`;
    const turnKey = `room:${roomId}:turn_queue`;

    const existingMembers = await redis.smembers(participantKey);
    for (const m of existingMembers) {
      if (String(JSON.parse(m).id).trim() === myIdStr) await redis.srem(participantKey, m);
    }
    
    const userData = JSON.stringify({ 
      id: myIdStr, 
      nickname: socket.user.nickname, 
      role: socket.user.role,
      profileImage: socket.user.profile_image || 0
    });
    
    await redis.sadd(participantKey, userData);
    await redis.expire(participantKey, 86400);

    const turnOrder = await redis.lrange(turnKey, 0, -1);
    if (!turnOrder.includes(myIdStr)) {
      await redis.rpush(turnKey, myIdStr);
      await redis.expire(turnKey, 86400);
    }

    await emitRoomState(roomId, joinCode);

    socket.to(roomId).emit('room:user_joined', {
      id: myIdStr, 
      nickname: socket.user.nickname, 
      role: socket.user.role,
      profileImage: socket.user.profile_image || 0
    });
    socket.on('room:request_state', async ({ roomId }) => {
    if (!roomId) return;
    const { rows } = await pool.query("SELECT join_code FROM rooms WHERE id = $1", [roomId]);
    if (rows.length > 0) {
      await emitRoomState(roomId, rows[0].join_code);
    }
    });
  };

  // ✨ 곡 선택 시 즉시 재생 명령 및 정보 저장
  socket.on('song:select', async ({ videoId, title, artist }) => {
    const roomId = socket.roomId;
    if (!roomId) return;

    const turnKey = `room:${roomId}:turn_queue`;
    const currentSingerId = await redis.lindex(turnKey, 0);
    
    if (String(currentSingerId).trim() !== String(socket.user.id).trim()) {
      return socket.emit('error', { message: '본인의 차례가 아닙니다.' });
    }

    const videoData = { videoId, title, artist, singerId: socket.user.id, startAt: Date.now() };

    // 재생 정보 등록 및 상태를 바로 singing으로 변경
    await redis.set(`room:${roomId}:playing_video`, JSON.stringify(videoData));
    await pool.query("UPDATE rooms SET status = 'singing' WHERE id = $1", [roomId]);

    io.to(roomId).emit('song:play', videoData);
    await broadcastRoomList(io);
  });

  socket.on('turn:skip', async () => {
    if (socket.roomId) {
      io.to(socket.roomId).emit('song:stop');
      await rotateTurn(socket.roomId); 
    }
  });

  socket.on('song:end', async () => {
    if (socket.roomId) {
      io.to(socket.roomId).emit('song:stop');
      await rotateTurn(socket.roomId);
    }
  });

  socket.on('song:request_sync', () => {
    if (socket.roomId) {
      socket.to(socket.roomId).emit('song:request_sync');
    }
  });

  socket.on('song:send_sync', ({ time }) => {
    if (socket.roomId) {
      socket.to(socket.roomId).emit('song:receive_sync', { time });
    }
  });

  socket.on('room:match', async () => {
    try {
      let room = await findAvailableRoom();
      if (!room) room = await internalCreateRoom(socket.user.id);
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
          id: room.id, roomId: room.id, joinCode: room.join_code,
          hostName: socket.user.nickname,
          hostProfileImage: socket.user.profile_image || 0,
          currentSong: '대기 중', participantCount: 1
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
        id: roomId, roomId, joinCode, 
        hostName: socket.user.nickname,
        hostProfileImage: socket.user.profile_image || 0,
        currentSong, participantCount
      };
      
      invitedFriends.forEach(friendId => {
        io.to(String(friendId).trim()).emit('room:invite', inviteData);
      });
    } catch (err) {
      console.error('[Socket] Send Invites Error:', err);
    }
  });

  socket.on('user:update_profile', async () => {
    try {
      const userId = socket.user.id;
      const { rows } = await pool.query('SELECT profile_image FROM users WHERE id = $1', [userId]);
      
      if (rows.length > 0) {
        socket.user.profile_image = rows[0].profile_image;
        io.emit('friend:update'); 
        await broadcastRoomList(io);
      }
    } catch (err) {
      console.error('[Socket] Update Profile Sync Error:', err);
    }
  });
};

async function _leaveRoom(io, socket, redis) {
  const roomId = socket.roomId;
  if (!roomId) return;

  const participantKey = `room:${roomId}:participants`;
  const turnKey = `room:${roomId}:turn_queue`;
  const myIdStr = String(socket.user.id).trim();
  
  try {
    const members = await redis.smembers(participantKey);
    for (const m of members) {
      if (String(JSON.parse(m).id).trim() === myIdStr) {
        await redis.srem(participantKey, m);
      }
    }

    const turnOrderBefore = await redis.lrange(turnKey, 0, -1);
    const wasCurrentTurn = turnOrderBefore.length > 0 && String(turnOrderBefore[0]).trim() === myIdStr;

    await redis.lrem(turnKey, 0, myIdStr);

    const remainingMembers = await redis.smembers(participantKey);
    
    if (remainingMembers.length === 0) {
      // 룸 초기화 및 클리어
      await pool.query("UPDATE rooms SET status = 'closed', closed_at = NOW() WHERE id = $1", [roomId]);
      await redis.del(participantKey);
      await redis.del(turnKey);
      await redis.del(`room:${roomId}:playing_video`);
      await broadcastRoomList(io);
    } else {
      if (wasCurrentTurn) {
        io.to(roomId).emit('song:stop');
        await redis.del(`room:${roomId}:playing_video`);
        await pool.query("UPDATE rooms SET status = 'waiting' WHERE id = $1", [roomId]);
        
        const currentSingerId = await redis.lpop(turnKey);
        if (currentSingerId) {
          await redis.rpush(turnKey, currentSingerId);
        }
      }

      const { rows } = await pool.query("SELECT join_code FROM rooms WHERE id = $1", [roomId]);
      
      const turnOrder = await redis.lrange(turnKey, 0, -1);
      const participants = remainingMembers.map(m => JSON.parse(m));
      
      const sortedParticipants = turnOrder.map(id => 
        participants.find(p => String(p.id).trim() === String(id).trim())
      ).filter(Boolean);

      participants.forEach(p => {
        if (!sortedParticipants.find(sp => String(sp.id).trim() === String(p.id).trim())) {
          sortedParticipants.push(p);
        }
      });

      const playingVideoStr = await redis.get(`room:${roomId}:playing_video`);
      const playingVideo = playingVideoStr ? JSON.parse(playingVideoStr) : null;
      
      const statusRow = await pool.query("SELECT status FROM rooms WHERE id = $1", [roomId]);
      const currentStatus = statusRow.rows.length > 0 ? statusRow.rows[0].status : 'waiting';

      io.to(roomId).emit('room:state', { 
        roomId,
        joinCode: rows[0]?.join_code,
        status: currentStatus,
        participants: sortedParticipants,
        currentTurnId: turnOrder.length > 0 ? turnOrder[0] : null,
        playingVideo
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