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
        `SELECT id, status, receiver_id FROM friends 
         WHERE (requester_id = $1::uuid AND receiver_id = $2::uuid) 
            OR (requester_id = $2::uuid AND receiver_id = $1::uuid)`,
        [myId, tId]
      );

      if (existing.length > 0) {
        const rel = existing[0];
        // 상대가 보낸 대기 중인 요청을 내가 클릭한 경우 -> 수락
        if (rel.status === 'pending' && String(rel.receiver_id) === myId) {
          await pool.query(`UPDATE friends SET status = 'accepted' WHERE id = $1::uuid`, [rel.id]);
        }
        // 상태 변경 후 양쪽에 새로고침 신호
        io.to(tId).emit('friend:update');
        socket.emit('friend:update');
      } else {
        // 새로운 요청 생성
        await pool.query(
          `INSERT INTO friends (requester_id, receiver_id, status) VALUES ($1::uuid, $2::uuid, 'pending')`,
          [myId, tId]
        );
        io.to(tId).emit('friend:update');
        socket.emit('friend:update');
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
      
      io.to(tId).emit('friend:update');
      socket.emit('friend:update');
    } catch (err) { 
      console.error('[Socket Error] Friend Accept:', err); 
    }
  });

  // 3. 친구 삭제 / 거절 처리 (투스텝 방식 적용)
  socket.on('friend:remove', async ({ targetId }) => {
    try {
      const tId = String(targetId).trim();
      console.log(`\n[Socket] 🗑️ 친구 삭제/거절 요청 수신: ${myId} -> ${tId}`);

      // [핵심 해결] 1단계: 삭제할 관계의 고유 ID(PK)를 먼저 찾습니다.
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
        
        // 3단계: 양측 프론트엔드 실시간 동기화 신호 전송
        io.to(tId).emit('friend:update');
        socket.emit('friend:update');
      } else {
        console.log(`[Socket] ⚠️ DB에서 두 유저 간의 관계를 찾지 못했습니다.`);
        // 프론트엔드와 백엔드의 데이터 불일치를 해소하기 위해 UI 강제 갱신
        socket.emit('friend:update');
      }
    } catch (err) { 
      console.error('[Socket Error] Friend Remove:', err); 
    }
  });
};