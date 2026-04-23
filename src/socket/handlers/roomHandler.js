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

  // [도우미] 현재 방의 상태(인원, 턴)를 전체 알림
  const emitRoomState = async (roomId, joinCode) => {
    const participantKey = `room:${roomId}:participants`;
    const turnKey = `room:${roomId}:turn_queue`;

    const members = await redis.smembers(participantKey);
    const participants = members.map(m => JSON.parse(m));
    
    // Redis List의 순서대로 정렬하기 위해 turn_queue를 가져옴
    const turnOrder = await redis.lrange(turnKey, 0, -1);
    
    // participants 배열을 turnOrder 순서에 맞게 재정렬
    const sortedParticipants = turnOrder.map(id => 
      participants.find(p => String(p.id).trim() === String(id).trim())
    ).filter(Boolean);

    // [보안 로직] 혹시라도 turn_queue와 participants 사이에 싱크가 어긋나서
    // 명단에서 누락되는 인원이 있다면 맨 뒤에 강제로 복구해줌
    participants.forEach(p => {
      if (!sortedParticipants.find(sp => String(sp.id).trim() === String(p.id).trim())) {
        sortedParticipants.push(p);
      }
    });

    io.to(roomId).emit('room:state', {
      roomId,
      joinCode,
      status: 'waiting',
      participants: sortedParticipants,
      currentTurnId: turnOrder.length > 0 ? turnOrder[0] : null
    });
  };

  // [도우미] 다음 사람으로 턴 넘기기
  const rotateTurn = async (roomId) => {
    const turnKey = `room:${roomId}:turn_queue`;
    // 1. 맨 앞 사람(현재 가수)을 꺼내서
    const currentSingerId = await redis.lpop(turnKey);
    if (currentSingerId) {
      // 2. 맨 뒤로 다시 넣음
      await redis.rpush(turnKey, currentSingerId);
    }
    
    // 3. 변경된 상태 알림
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

    // 1. 참여자 정보 저장 (중복 제거 후 삽입)
    const existingMembers = await redis.smembers(participantKey);
    for (const m of existingMembers) {
      if (String(JSON.parse(m).id).trim() === myIdStr) await redis.srem(participantKey, m);
    }
    
    //방 참가자 객체에 profileImage 저장
    const userData = JSON.stringify({ 
      id: myIdStr, 
      nickname: socket.user.nickname, 
      role: socket.user.role,
      profileImage: socket.user.profile_image || 0
    });
    
    await redis.sadd(participantKey, userData);
    await redis.expire(participantKey, 86400);

    // 2. [턴 관리] 순서 리스트에 내 ID가 없으면 맨 뒤에 추가
    const turnOrder = await redis.lrange(turnKey, 0, -1);
    if (!turnOrder.includes(myIdStr)) {
      await redis.rpush(turnKey, myIdStr);
      await redis.expire(turnKey, 86400);
    }

    // 3. 상태 알림
    await emitRoomState(roomId, joinCode);

    // 입장 알림에도 profileImage
    socket.to(roomId).emit('room:user_joined', {
      id: myIdStr, 
      nickname: socket.user.nickname, 
      role: socket.user.role,
      profileImage: socket.user.profile_image || 0
    });
  };

  // [이벤트] 노래 선택 완료
  socket.on('song:select', async ({ videoId, title, artist }) => {
    const roomId = socket.roomId;
    if (!roomId) return;

    const turnKey = `room:${roomId}:turn_queue`;
    const currentSingerId = await redis.lindex(turnKey, 0);
    
    if (String(currentSingerId).trim() !== String(socket.user.id).trim()) {
      return socket.emit('error', { message: '본인의 차례가 아닙니다.' });
    }

    io.to(roomId).emit('song:play', {
      videoId,
      title,
      artist,
      singerId: socket.user.id
    });
    
    await pool.query("UPDATE rooms SET status = 'singing' WHERE id = $1", [roomId]);
    await broadcastRoomList(io);
  });

  // [이벤트] 수동 스킵
  socket.on('turn:skip', async () => {
    if (socket.roomId) {
      io.to(socket.roomId).emit('song:stop');
      await rotateTurn(socket.roomId); 
    }
  });

  // [이벤트] 자동 종료
  socket.on('song:end', async () => {
    if (socket.roomId) {
      io.to(socket.roomId).emit('song:stop');
      await rotateTurn(socket.roomId);
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
        // 초대장에 방장의 profileImage 포함
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
        console.log(`[Socket] User ${socket.user.nickname} updated profile to: ${socket.user.profile_image}`);
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
    // 1. 참여자 목록에서 제거
    const members = await redis.smembers(participantKey);
    for (const m of members) {
      if (String(JSON.parse(m).id).trim() === myIdStr) {
        await redis.srem(participantKey, m);
      }
    }

    const turnOrderBefore = await redis.lrange(turnKey, 0, -1);
    const wasCurrentTurn = turnOrderBefore.length > 0 && String(turnOrderBefore[0]).trim() === myIdStr;

    // 2. 턴 큐(순서 리스트)에서 제거
    await redis.lrem(turnKey, 0, myIdStr);

    const remainingMembers = await redis.smembers(participantKey);
    
    if (remainingMembers.length === 0) {
      await pool.query("UPDATE rooms SET status = 'closed', closed_at = NOW() WHERE id = $1", [roomId]);
      await redis.del(participantKey);
      await redis.del(turnKey);
      await broadcastRoomList(io);
    } else {
      if (wasCurrentTurn) {
        io.to(roomId).emit('song:stop');
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

      io.to(roomId).emit('room:state', { 
        roomId,
        joinCode: rows[0]?.join_code,
        participants: sortedParticipants,
        currentTurnId: turnOrder.length > 0 ? turnOrder[0] : null
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