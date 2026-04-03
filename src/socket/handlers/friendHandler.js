const { pool } = require('../../config/database');

module.exports = function friendHandler(io, socket) {
  
  // 친구 요청 보내기
  socket.on('friend:request', async ({ targetId }) => {
    try {
      await pool.query(
        `INSERT INTO friends (requester_id, receiver_id, status) 
         VALUES ($1, $2, 'pending') ON CONFLICT DO NOTHING`,
        [socket.user.id, targetId]
      );

      // 상대방에게 실시간 알림 (방 전체 브로드캐스트 중 상대방 ID 필터링)
      // 상대방이 어느 방에 있든 상관없이 개인 소켓 채널이 있다면 전달됨
      io.to(targetId).emit('friend:update', { 
        fromId: socket.user.id, 
        status: 'received' 
      });
    } catch (err) {
      console.error('Friend request error', err);
    }
  });

  // 친구 요청 수락
  socket.on('friend:accept', async ({ targetId }) => {
    try {
      await pool.query(
        `UPDATE friends SET status = 'accepted' 
         WHERE (requester_id = $1 AND receiver_id = $2) 
            OR (requester_id = $2 AND receiver_id = $1)`,
        [socket.user.id, targetId]
      );

      // 양쪽 모두에게 친구 완료 상태 전송
      io.to(targetId).emit('friend:update', { fromId: socket.user.id, status: 'friend' });
      socket.emit('friend:update', { fromId: targetId, status: 'friend' });
    } catch (err) {
      console.error('Friend accept error', err);
    }
  });
};