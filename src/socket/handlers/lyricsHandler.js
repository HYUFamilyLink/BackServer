/**
 * VR 기기가 재생 타이밍을 주기적으로 발행 → 서버가 폰으로 릴레이
 *
 * 이벤트 목록
 *   lyrics:tick  { currentMs }        → VR 기기 → 서버 → 폰 (100ms 간격 권장)
 *   user:reaction { emoji }           → 폰 → 서버 → VR + 폰 전체
 *   score:submit  { score }           → VR → 서버 → 폰 전체
 */
module.exports = function lyricsHandler(io, socket) {

  // VR 기기에서 재생 위치 브로드캐스트
  socket.on('lyrics:tick', ({ currentMs } = {}) => {
    const roomId = socket.roomId;
    if (!roomId) return;

    // VR 본인 제외하고 같은 방 전체에 릴레이
    socket.to(roomId).emit('lyrics:tick', { currentMs });
  });

  socket.on('user:reaction', ({ emoji } = {}) => {
    const roomId = socket.roomId;
    if (!roomId) return;

    io.to(roomId).emit('user:reaction', {
      userId:   socket.user.id,
      nickname: socket.user.nickname, 
      emoji,
    });
  });

  // VR 기기가 점수 발행
  socket.on('score:submit', async ({ score } = {}) => {
    const roomId = socket.roomId;
    if (!roomId) return;

    const { pool } = require('../../config/database');

    // 현재 재생 중인 곡 조회
    const { rows } = await pool.query(
      `SELECT qi.song_id FROM queue_items qi
       JOIN rooms r ON r.id = qi.room_id
       WHERE qi.room_id = $1 AND r.status = 'result'
       ORDER BY qi.created_at DESC LIMIT 1`,
      [roomId],
    );
    if (!rows.length) return;

    await pool.query(
      `INSERT INTO scores (room_id, user_id, song_id, score)
       VALUES ($1, $2, $3, $4)`,
      [roomId, socket.user.id, rows[0].song_id, score],
    );

    io.to(roomId).emit('score:result', {
      userId:   socket.user.id,
      nickname: socket.user.nickname,
      score,
    });
  });
};
