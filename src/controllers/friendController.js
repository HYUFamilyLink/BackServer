const { pool } = require('../config/database');

// 유저의 모든 친구 관계(요청중, 수락됨)를 가져옴
async function getFriendStatuses(req, res) {
  try {
    const userId = req.user.id;
    const { rows } = await pool.query(
      `SELECT * FROM friends WHERE requester_id = $1 OR receiver_id = $1`,
      [userId]
    );

    const statuses = {};
    rows.forEach(row => {
      // 상대방 ID 결정
      const targetId = row.requester_id === userId ? row.receiver_id : row.requester_id;
      
      if (row.status === 'accepted') {
        statuses[targetId] = 'friend';
      } else {
        // 내가 보냈으면 'sent', 받았으면 'received'
        statuses[targetId] = (row.requester_id === userId) ? 'sent' : 'received';
      }
    });

    res.json(statuses); // 예: { "uuid-123": "friend", "uuid-456": "sent" }
  } catch (err) {
    console.error('[friendController] Error:', err);
    res.status(500).json({ error: '친구 내역 로드 실패' });
  }
}

module.exports = { getFriendStatuses };