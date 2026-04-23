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
      `SELECT u.id::text, u.name as nickname, u.profile_image 
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
    // profile_image를 낙타표기법(profileImage)으로 변환해서 보내주면 프론트에서 편합니다.
    const formattedRows = rows.map(r => ({ ...r, profileImage: r.profile_image }));
    res.json(formattedRows);
  } catch (err) {
    console.error('[명단 API 에러]', err);
    res.status(500).json({ error: '목록 로드 실패' });
  }
}


async function getFriendStatuses(req, res) {
  const userId = String(req.user.id);
  console.log(`\n[상태 API 호출됨] 로그인 유저: ${userId}`);

  try {
    const { rows } = await pool.query(
      `SELECT f.requester_id::text, f.receiver_id::text, f.status,
              u_req.name as req_name, u_req.profile_image as req_profile,
              u_rec.name as rec_name, u_rec.profile_image as rec_profile
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
      const targetProfile = isIRequested ? row.rec_profile : row.req_profile; // ✨ 프로필 이미지 할당
      
      let statusVal = '';
      if (rowStatus === 'accepted') statusVal = 'friend';
      else if (rowStatus === 'pending') statusVal = isIRequested ? 'sent' : 'received';

      statuses[targetId] = { status: statusVal, nickname: targetName, profileImage: targetProfile };
    });

    console.log(`[상태 API 결과] 상태 맵:`, statuses);
    res.json(statuses);
  } catch (err) {
    console.error('[상태 API 에러]', err);
    res.status(500).json({ error: '상태 로드 실패' });
  }
}
module.exports = { getAcceptedFriends, getFriendStatuses };