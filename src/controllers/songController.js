const { pool } = require('../config/database');

// 전체 노래 목록 (검색 포함)
async function getSongs(req, res) {
  const { q, limit = 50, offset = 0 } = req.query;

  let query  = 'SELECT id, video_id, title, artist, thumbnail, duration FROM songs';
  const params = [];

  if (q) {
    params.push(`%${q}%`);
    query += ` WHERE title ILIKE $1 OR artist ILIKE $1`;
  }

  query += ` ORDER BY title LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  const { rows } = await pool.query(query, params);
  res.json(rows);
}

// 노래 등록 (관리자용 — YouTube 메타데이터 직접 저장)
async function addSong(req, res) {
  const { video_id, title, artist, thumbnail, duration } = req.body;
  if (!video_id || !title || !artist) {
    return res.status(400).json({ error: 'video_id, title, artist required' });
  }

  const { rows } = await pool.query(
    `INSERT INTO songs (video_id, title, artist, thumbnail, duration)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (video_id) DO NOTHING
     RETURNING *`,
    [video_id, title, artist, thumbnail, duration],
  );

  if (!rows.length) {
    return res.status(409).json({ error: 'Song already exists' });
  }

  res.status(201).json(rows[0]);
}

module.exports = { getSongs, addSong };
