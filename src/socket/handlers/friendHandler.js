const { pool } = require('../../config/database');

module.exports = function friendHandler(io, socket) {
  // 1. 친구 요청
  socket.on('friend:request', async ({ targetId }) => {
    try {
      // DB 저장 (이미 있다면 무시)
      await pool.query(
        `INSERT INTO friends (requester_id, receiver_id, status) 
         VALUES ($1, $2, 'pending') ON CONFLICT DO NOTHING`,
        [socket.user.id, targetId]
      );

      // 상대방에게 '나에게 친구 요청이 왔다'는 신호 전송
      io.to(targetId).emit('friend:update', { 
        fromId: socket.user.id, 
        status: 'received' 
      });
    } catch (err) { console.error('Friend request error', err); }
  });

  // 2. 친구 수락
  socket.on('friend:accept', async ({ targetId }) => {
    try {
      // DB 상태를 'accepted'로 변경
      await pool.query(
        `UPDATE friends SET status = 'accepted' 
         WHERE (requester_id = $1 AND receiver_id = $2) 
            OR (requester_id = $2 AND receiver_id = $1)`,
        [socket.user.id, targetId]
      );

      // [핵심] 양쪽 모두에게 '이제 친구다'라는 신호를 보냄
      // 1. 수락한 상대방(요청자)에게 전송
      io.to(targetId).emit('friend:update', { fromId: socket.user.id, status: 'friend' });
      // 2. 수락한 본인에게도 전송 (확인용)
      socket.emit('friend:update', { fromId: targetId, status: 'friend' });
    } catch (err) { console.error('Friend accept error', err); }
  });
};