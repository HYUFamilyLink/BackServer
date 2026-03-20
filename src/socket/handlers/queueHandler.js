const { pool } = require('../../config/database');

/**
 * 이벤트 목록
 *   queue:add     { songId }           → 노래 신청
 *   queue:remove  { queueItemId }      → 신청 취소 (본인 or host)
 *   song:start    { queueItemId }      → 재생 시작 (VR host만)
 *   song:end      { queueItemId }      → 재생 종료 (VR host만)
 *
 * 브로드캐스트
 *   queue:updated  { queue[] }         → 방 전체
 *   song:playing   { song, startedAt } → 방 전체
 */
module.exports = function queueHandler(io, socket) {

  socket.on('queue:add', async ({ songId } = {}, ack) => {
    const roomId = socket.roomId;
    if (!roomId) return ack?.({ error: 'Not in a room' });

    try {
      // 현재 마지막 position 계산
      const { rows: pos } = await pool.query(
        `SELECT COALESCE(MAX(position), 0) + 1 AS next
         FROM queue_items WHERE room_id = $1 AND played = FALSE`,
        [roomId],
      );

      const { rows } = await pool.query(
        `INSERT INTO queue_items (room_id, song_id, requested_by, position)
         VALUES ($1, $2, $3, $4)
         RETURNING id, song_id, requested_by, position`,
        [roomId, songId, socket.user.id, pos[0].next],
      );

      await _broadcastQueue(io, roomId);
      ack?.({ item: rows[0] });
    } catch (err) {
      console.error('[queueHandler] queue:add error', err);
      ack?.({ error: 'Server error' });
    }
  });

  socket.on('queue:remove', async ({ queueItemId } = {}, ack) => {
    const roomId = socket.roomId;
    if (!roomId) return ack?.({ error: 'Not in a room' });

    try {
      // 본인 신청 or 방 host만 삭제 가능
      const { rows: item } = await pool.query(
        'SELECT * FROM queue_items WHERE id = $1',
        [queueItemId],
      );
      if (!item.length) return ack?.({ error: 'Item not found' });

      const { rows: room } = await pool.query(
        'SELECT host_id FROM rooms WHERE id = $1',
        [roomId],
      );

      const isOwner = item[0].requested_by === socket.user.id;
      const isHost  = room[0]?.host_id === socket.user.id;
      if (!isOwner && !isHost) return ack?.({ error: 'Not authorized' });

      await pool.query('DELETE FROM queue_items WHERE id = $1', [queueItemId]);
      await _broadcastQueue(io, roomId);
      ack?.({ ok: true });
    } catch (err) {
      console.error('[queueHandler] queue:remove error', err);
      ack?.({ error: 'Server error' });
    }
  });

  // VR 기기(host)가 재생 시작 알림
  socket.on('song:start', async ({ queueItemId } = {}) => {
    const roomId = socket.roomId;
    if (!roomId) return;

    const { rows } = await pool.query(
      `SELECT qi.*, s.video_id, s.title, s.artist, s.thumbnail
       FROM queue_items qi
       JOIN songs s ON qi.song_id = s.id
       WHERE qi.id = $1`,
      [queueItemId],
    );
    if (!rows.length) return;

    // 방 상태 → singing
    await pool.query(
      `UPDATE rooms SET status = 'singing' WHERE id = $1`,
      [roomId],
    );

    io.to(roomId).emit('song:playing', {
      song:      rows[0],
      startedAt: Date.now(),
    });
  });

  // VR 기기(host)가 재생 종료 알림
  socket.on('song:end', async ({ queueItemId } = {}) => {
    const roomId = socket.roomId;
    if (!roomId) return;

    await pool.query(
      'UPDATE queue_items SET played = TRUE WHERE id = $1',
      [queueItemId],
    );
    await pool.query(
      `UPDATE rooms SET status = 'result' WHERE id = $1`,
      [roomId],
    );

    await _broadcastQueue(io, roomId);
    io.to(roomId).emit('song:ended', { queueItemId });
  });
};

async function _broadcastQueue(io, roomId) {
  const { rows } = await pool.query(
    `SELECT qi.id, qi.position, qi.requested_by,
            s.video_id, s.title, s.artist, s.thumbnail,
            u.nickname AS requested_by_nickname
     FROM queue_items qi
     JOIN songs  s ON qi.song_id = s.id
     JOIN users  u ON qi.requested_by = u.id
     WHERE qi.room_id = $1 AND qi.played = FALSE
     ORDER BY qi.position`,
    [roomId],
  );
  io.to(roomId).emit('queue:updated', { queue: rows });
}
