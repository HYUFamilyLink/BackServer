const { pool }      = require('../../config/database');
const { getRedis }  = require('../../config/redis');
const { findAvailableRoom, internalCreateRoom, buildRoomList } = require('../../controllers/roomController');
const googleTTS     = require('google-tts-api'); // ✨ TTS 패키지 추가

async function broadcastRoomList(io) {
  try {
    const rooms = await buildRoomList();
    io.emit('rooms:updated', rooms);
  } catch (err) {
    console.error('[Socket] broadcastRoomList error:', err);
  }
}

async function broadcastAnnounce(io, roomId, text) {
  try {
    const results = await googleTTS.getAllAudioBase64(text, {
      lang: 'ko',
      slow: false,
      host: 'https://translate.google.com',
      splitPunct: ',.?'
    });
    const audioData = results[0]?.base64 || null;
    
    if (audioData) {
      io.to(roomId).emit('room:announce', { message: text, audioData });
    }
  } catch (err) {
    console.error('[TTS Error]', err);
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

    const playingVideoStr = await redis.get(`room:${roomId}:playing_video`);
    const playingVideo = playingVideoStr ? JSON.parse(playingVideoStr) : null;

    const { rows } = await pool.query("SELECT status FROM rooms WHERE id = $1", [roomId]);
    const currentStatus = rows.length > 0 ? rows[0].status : 'waiting';

    io.to(roomId).emit('room:state', {
      roomId,
      joinCode,
      status: currentStatus, 
      participants: sortedParticipants,
      currentTurnId: turnOrder.length > 0 ? turnOrder[0] : null,
      playingVideo
    });
  };

  const rotateTurn = async (roomId) => {
    const turnKey = `room:${roomId}:turn_queue`;
    
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

    // 턴이 넘어갔을 때 다음 차례 사용자에게 TTS 안내 방송
    const nextSingerId = await redis.lindex(turnKey, 0);
    if (nextSingerId) {
      const participantKey = `room:${roomId}:participants`;
      const members = await redis.smembers(participantKey);
      const nextSinger = members.map(m => JSON.parse(m)).find(p => String(p.id).trim() === String(nextSingerId).trim());
      
      if (nextSinger) {
        const text = `${nextSinger.nickname}님의 차례입니다. 노래 고르기 버튼을 눌러 부를 노래를 선택해 주세요.`;
        await broadcastAnnounce(io, roomId, text);
      }
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
      profileImage: socket.user.profile_image || 0,
      isMicOn: true
    });
    
    await redis.sadd(participantKey, userData);
    await redis.expire(participantKey, 86400);

    const turnOrderBefore = await redis.lrange(turnKey, 0, -1);
    let isFirstUser = false;
    
    if (!turnOrderBefore.includes(myIdStr)) {
      if (turnOrderBefore.length === 0) isFirstUser = true; // 방에 아무도 없었던 상태
      await redis.rpush(turnKey, myIdStr);
      await redis.expire(turnKey, 86400);
    }

    await emitRoomState(roomId, joinCode);

    // 유저 입장 안내방송 통합 처리 (음성 겹침 방지)
    let announceText = `${socket.user.nickname}님이 입장하셨습니다.`;
    
    // 만약 이 유저가 방에 처음 들어온 사람이라면, 입장 멘트 뒤에 바로 턴 안내를 붙여서 자연스럽게 읽도록 처리
    if (isFirstUser) {
      announceText += ` 현재 ${socket.user.nickname}님의 차례입니다. 노래 고르기 버튼을 눌러 노래를 선택해 주세요.`;
    }
    await broadcastAnnounce(io, roomId, announceText);

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

  socket.on('song:select', async ({ videoId, title, artist }) => {
    const roomId = socket.roomId;
    if (!roomId) return;

    const turnKey = `room:${roomId}:turn_queue`;
    const currentSingerId = await redis.lindex(turnKey, 0);
    
    if (String(currentSingerId).trim() !== String(socket.user.id).trim()) {
      return socket.emit('error', { message: '본인의 차례가 아닙니다.' });
    }

    const videoData = { videoId, title, artist, singerId: socket.user.id, startAt: Date.now() };

    await redis.set(`room:${roomId}:playing_video`, JSON.stringify(videoData));
    await pool.query("UPDATE rooms SET status = 'singing' WHERE id = $1", [roomId]);

    io.to(roomId).emit('song:play', videoData);
    await broadcastRoomList(io);

    //노래 선택(시작) 시 노래 제목 TTS 방송
    await broadcastAnnounce(io, roomId, `${artist.replace(/\[.*?\]|\(.*?\)/g, '').trim()}의 ${title.replace(/\[.*?\]|\(.*?\)/g, '').trim()} 노래 시작`);
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

  socket.on('voice:mute_toggle', async ({ isMicOn }) => {
    if (socket.roomId) {
      const myIdStr = String(socket.user.id).trim();

      socket.to(socket.roomId).emit('voice:mute_status', {
        userId: myIdStr,
        isMicOn
      });
      try {
        const participantKey = `room:${socket.roomId}:participants`;
        const members = await redis.smembers(participantKey);
        
        for (const m of members) {
          const parsedData = JSON.parse(m);
          if (String(parsedData.id).trim() === myIdStr) {
            await redis.srem(participantKey, m);
            
            parsedData.isMicOn = isMicOn;
            await redis.sadd(participantKey, JSON.stringify(parsedData));
            break;
          }
        }
      } catch (err) {
        console.error('[Socket] voice:mute_toggle Redis Update Error:', err);
      }
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
      await pool.query("UPDATE rooms SET status = 'closed', closed_at = NOW() WHERE id = $1", [roomId]);
      await redis.del(participantKey);
      await redis.del(turnKey);
      await redis.del(`room:${roomId}:playing_video`);
      await broadcastRoomList(io);
    } else {
      let announceText = `${socket.user.nickname}님이 퇴장하셨습니다.`;
      await broadcastAnnounce(io, socket.roomId, announceText);
      if (wasCurrentTurn) {
        io.to(roomId).emit('song:stop');
        await redis.del(`room:${roomId}:playing_video`);
        await pool.query("UPDATE rooms SET status = 'waiting' WHERE id = $1", [roomId]);
        
        const currentSingerId = await redis.lpop(turnKey);
        if (currentSingerId) {
          await redis.rpush(turnKey, currentSingerId);
        }

        const nextSingerId = await redis.lindex(turnKey, 0);
        if (nextSingerId) {
          const nextSinger = remainingMembers.map(m => JSON.parse(m)).find(p => String(p.id).trim() === String(nextSingerId).trim());
          if (nextSinger) {
            const text = `${nextSinger.nickname}님의 차례입니다. 노래 고르기 버튼을 눌러 부를 노래를 선택해 주세요.`;
            await broadcastAnnounce(io, roomId, text); 
          }
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