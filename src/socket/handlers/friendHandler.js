const { pool } = require('../../config/database');

module.exports = function friendHandler(io, socket) {
  // 공백 및 이스케이프 문자 방어를 위해 trim() 추가
  const myId = String(socket.user.id).trim();

  // 1. 친구 요청 처리
  socket.on('friend:request', async ({ targetId }) => {
    try {
      const tId = String(targetId).trim();
      if (!tId || tId === 'undefined') return;
      console.log(`\n[Socket] 🤝 친구 요청: ${myId} -> ${tId}`);

      const { rows: existing } = await pool.query(
        `SELECT id, status, requester_id, receiver_id FROM friends 
         WHERE (requester_id = $1::uuid AND receiver_id = $2::uuid) 
            OR (requester_id = $2::uuid AND receiver_id = $1::uuid)`,
        [myId, tId]
      );

      if (existing.length > 0) {
        const rel = existing[0];
        // 상대가 보낸 대기 중인 요청을 내가 클릭한 경우 -> 수락
        if (rel.status === 'pending' && String(rel.receiver_id) === myId) {
          await pool.query(`UPDATE friends SET status = 'accepted' WHERE id = $1::uuid`, [rel.id]);
          
          // [핵심 복구] 프론트엔드가 즉각 반응하도록 상태값 전달
          io.to(tId).emit('friend:update', { fromId: myId, status: 'friend' });
          socket.emit('friend:update', { fromId: tId, status: 'friend' });
        } else {
          // 이미 요청을 보냈거나 친구인 경우 강제 동기화
          const currentStatus = rel.status === 'accepted' ? 'friend' : 
                               (String(rel.requester_id) === myId ? 'sent' : 'received');
          socket.emit('friend:update', { fromId: tId, status: currentStatus });
        }
      } else {
        // 새로운 요청 생성
        await pool.query(
          `INSERT INTO friends (requester_id, receiver_id, status) VALUES ($1::uuid, $2::uuid, 'pending')`,
          [myId, tId]
        );
        
        // [핵심 복구] 상대방에게 'received', 나에게 'sent' 상태 전달
        io.to(tId).emit('friend:update', { fromId: myId, status: 'received' });
        socket.emit('friend:update', { fromId: tId, status: 'sent' });
      }
    } catch (err) { 
      console.error('[Socket Error] Friend Request:', err); 
    }
  });

  // 2. 친구 수락 처리
  socket.on('friend:accept', async ({ targetId }) => {
    try {
      const tId = String(targetId).trim();
      console.log(`\n[Socket] ✅ 친구 수락: ${myId} -> ${tId}`);

      await pool.query(
        `UPDATE friends SET status = 'accepted' 
         WHERE ((requester_id = $1::uuid AND receiver_id = $2::uuid) OR (requester_id = $2::uuid AND receiver_id = $1::uuid))
           AND status = 'pending'`,
        [tId, myId]
      );
      
      io.to(tId).emit('friend:update', { fromId: myId, status: 'friend' });
      socket.emit('friend:update', { fromId: tId, status: 'friend' });
    } catch (err) { 
      console.error('[Socket Error] Friend Accept:', err); 
    }
  });

  // 3. 친구 삭제 / 거절 / 요청 취소 처리 (투스텝 방식)
  socket.on('friend:remove', async ({ targetId }) => {
    try {
      const tId = String(targetId).trim();
      console.log(`\n[Socket] 🗑️ 친구 삭제/거절/취소 요청 수신: ${myId} -> ${tId}`);

      // 1단계: 삭제할 관계의 고유 ID(PK)를 먼저 찾습니다. (요청이든 확정이든 상관없이 무조건 찾음)
      const findQuery = `
        SELECT id FROM friends 
        WHERE (requester_id = $1::uuid AND receiver_id = $2::uuid) 
           OR (requester_id = $2::uuid AND receiver_id = $1::uuid)
      `;
      const { rows } = await pool.query(findQuery, [myId, tId]);
      
      if (rows.length > 0) {
        const relationId = rows[0].id;
        console.log(`[Socket] 🔍 대상 관계 확인됨 (관계ID: ${relationId}). 삭제를 진행합니다.`);
        
        // 2단계: 찾아낸 고유 ID로 명확하게 삭제
        const deleteResult = await pool.query(`DELETE FROM friends WHERE id = $1::uuid RETURNING *`, [relationId]);
        console.log(`[Socket] ✅ DB 삭제 완료. 삭제된 행 수: ${deleteResult.rowCount}`);
        
        // [핵심 복구] UI 초기화를 위해 status를 null로 명시하여 전달
        io.to(tId).emit('friend:update', { fromId: myId, status: null });
        socket.emit('friend:update', { fromId: tId, status: null });
      } else {
        console.log(`[Socket] ⚠️ DB에서 두 유저 간의 관계를 찾지 못했습니다.`);
        // 동기화 실패 시에도 프론트엔드를 초기화시킴
        socket.emit('friend:update', { fromId: tId, status: null });
      }
    } catch (err) { 
      console.error('[Socket Error] Friend Remove:', err); 
    }
  });
};