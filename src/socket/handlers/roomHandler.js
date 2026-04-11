const { pool }     = require('../../config/database');
const { getRedis } = require('../../config/redis');
const { findAvailableRoom, internalCreateRoom } = require('../../controllers/roomController');

module.exports = function roomHandler(io, socket) {
  const redis = getRedis();

  // 1. 유저 접속 시 본인의 ID로 된 소켓 룸에 입장 (친구 요청/수락 알림 수신용)
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

    // [중요] 전체 유저에게 방 정보 전송 (프론트엔드가 이 신호를 받고 화면을 넘김)
    io.to(roomId).emit('room:state', {
      roomId,
      joinCode,
      status: 'waiting',
      participants,
    });
  };

  // 기존: 랜덤 매칭 기능
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

  // [핵심 추가] 누락되었던 새 방 만들기 전용 리스너
  // 방 만들기 + 초대 로직
  socket.on('room:create', async (payload = {}) => {
    try {
      const { invitedFriends = [] } = payload; // 프론트엔드에서 보낸 초대 명단 받기

    // 방 생성 및 입장
      const room = await internalCreateRoom(socket.user.id);
      await joinRoomAction(room.id, room.join_code);

    // 선택된 친구들에게 소켓 알림 
      if (invitedFriends.length > 0) {
        const inviteData = {
          id: room.id, // 프론트에서 렌더링에 사용할 임시 아이디
          roomId: room.id,
          joinCode: room.join_code,
          hostName: socket.user.nickname,
          currentSong: '대기 중',
          participantCount: 1 // 방금 호스트가 들어갔으므로 1
        };

      invitedFriends.forEach(friendId => {
        // 개인 소켓 룸으로 'room:invite' 이벤트 발송
          io.to(String(friendId)).emit('room:invite', inviteData);
        });
      }
    } catch (err) {
      console.error('[Socket] Create Room Error:', err);
      socket.emit('error', { message: '새 방 생성 중 오류 발생' });
    }
  });

  // 기존: 코드 입력으로 입장
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

  // 기존: 방 나가기
  socket.on('room:leave', async () => {
    await _leaveRoom(io, socket, redis);
  });

  socket.on('disconnect', async () => {
    await _leaveRoom(io, socket, redis);
  });
};

// 방 퇴장 처리 서브 함수
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
      // 2. DB에서 현재 방의 코드를 다시 가져옴 (유실 방지)
      const { rows } = await pool.query("SELECT join_code FROM rooms WHERE id = $1", [roomId]);
      const currentJoinCode = rows[0]?.join_code;

      // 3. 남은 인원에게 'joinCode'를 포함하여 상태 전송
      socket.to(roomId).emit('room:state', { 
        roomId,
        joinCode: currentJoinCode,
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
  socket.on('room:send_invites', async (payload) => {
    try {
      const { invitedFriends = [], roomId, joinCode, currentSong, participantCount } = payload;
      
      if (!invitedFriends.length) return;

      const inviteData = {
        id: roomId, // 홈 화면 렌더링에 사용될 고유 키
        roomId: roomId,
        joinCode: joinCode,
        hostName: socket.user.nickname, // 나(초대자)의 이름
        currentSong: currentSong,
        participantCount: participantCount
      };

      invitedFriends.forEach(friendId => {
        // 상대방 소켓(및 향후 연동될 VR 소켓)으로 초대 이벤트 발송
        io.to(String(friendId)).emit('room:invite', inviteData);
      });
    } catch (err) {
      console.error('[Socket] Send Invites Error:', err);
    }
  });
};
