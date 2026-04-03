// controllers/friendController.js
const { pool } = require('../config/database');

/**
 * 1. 확정된 친구 명단 가져오기
 */
async function getAcceptedFriends(req, res) {
  const userId = String(req.user.id);
  console.log(`\n===========================================`);
  console.log(`[명단 API 호출됨] 로그인 유저: ${userId}`);
  console.log(`===========================================\n`);

  try {
    const { rows } = await pool.query(
      `SELECT u.id::text, u.name as nickname 
       FROM friends f
       JOIN users u ON (
         CASE 
           WHEN f.requester_id = $1::uuid THEN f.receiver_id 
           ELSE f.requester_id 
         END
       ) = u.id
       WHERE (f.requester_id = $1::uuid OR f.receiver_id = $1::uuid)
         AND LOWER(TRIM(f.status)) = 'accepted'`,
      [userId]
    );

    console.log(`[명단 API 결과] 조회된 친구 수: ${rows.length}명`);
    res.json(rows);
  } catch (err) {
    console.error('[명단 API 에러]', err);
    res.status(500).json({ error: '목록 로드 실패' });
  }
}

/**
 * 2. 모든 관계 상태(대기/수락 등) 및 닉네임 가져오기
 */
async function getFriendStatuses(req, res) {
  const userId = String(req.user.id);
  console.log(`\n[상태 API 호출됨] 로그인 유저: ${userId}`);

  try {
    // users 테이블을 조인하여 닉네임을 함께 가져옴
    const { rows } = await pool.query(
      `SELECT f.requester_id::text, f.receiver_id::text, f.status,
              u_req.name as req_name, u_rec.name as rec_name
       FROM friends f
       JOIN users u_req ON f.requester_id = u_req.id
       JOIN users u_rec ON f.receiver_id = u_rec.id
       WHERE (f.requester_id = $1::uuid OR f.receiver_id = $1::uuid)
         AND LOWER(TRIM(f.status)) IN ('accepted', 'pending')`,
      [userId]
    );

    const statuses = {};
    rows.forEach(row => {
      const rowStatus = row.status.toLowerCase().trim();
      const isIRequested = row.requester_id === userId;
      
      const targetId = isIRequested ? row.receiver_id : row.requester_id;
      const targetName = isIRequested ? row.rec_name : row.req_name;
      
      let statusVal = '';
      if (rowStatus === 'accepted') statusVal = 'friend';
      else if (rowStatus === 'pending') statusVal = isIRequested ? 'sent' : 'received';

      // 상태값과 닉네임을 객체로 묶어 프론트엔드로 전달
      statuses[targetId] = { status: statusVal, nickname: targetName };
    });

    console.log(`[상태 API 결과] 상태 맵:`, statuses);
    res.json(statuses);
  } catch (err) {
    console.error('[상태 API 에러]', err);
    res.status(500).json({ error: '상태 로드 실패' });
  }
}

// [핵심] 이 부분이 지워져서 라우터가 함수를 찾지 못하고 크래시가 났던 것입니다.
module.exports = { getAcceptedFriends, getFriendStatuses };