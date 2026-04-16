const axios = require('axios');
const { pool } = require('../config/database');

async function getSongs(req, res) {
  const { q } = req.query;
  
  if (!q) {
    return res.json([]);
  }

  try {
    // 1. 유튜브 API 검색
    const searchQuery = `${q} 노래방`;
    const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY; // .env 파일에 설정
    
    const response = await axios.get('https://www.googleapis.com/youtube/v3/search', {
      params: {
        part: 'snippet',
        q: searchQuery,
        type: 'video',
        videoEmbeddable: 'true',
        maxResults: 10,
        key: YOUTUBE_API_KEY
      }
    });

    // 2. 검색 결과 가공
    const songs = response.data.items.map(item => {
      const videoId = item.id.videoId;
      const rawTitle = item.snippet.title;
      const thumbnail = item.snippet.thumbnails.high.url;

      let title = rawTitle;
      let artist = '알 수 없음';

      // ' - ' 를 기준으로 나누고, 괄호 등 지저분한 텍스트 제거 (간단한 파싱 예시)
      const parts = rawTitle.split(' - ');
      if (parts.length >= 2) {
        title = parts[0].replace(/\[.*?\]|\(.*?\)/g, '').trim(); // [TJ노래방] 제거
        artist = parts[1].replace(/(\/|금영|Karaoke).*$/i, '').trim(); // 뒤쪽 텍스트 제거
      }

      return {
        id: videoId, // DB id 대신 유튜브 videoId를 고유값으로 사용
        video_id: videoId,
        title: title || rawTitle,
        artist: artist,
        thumbnail: thumbnail,
        duration: 0 // 실시간 API는 길이를 주지 않으므로 0 (필요시 별도 API 호출 필요)
      };
    });

    res.json(songs);
  } catch (err) {
    console.error('YouTube API Search Error:', err.message);
    res.status(500).json({ error: '유튜브 검색 중 오류가 발생했습니다.' });
  }
}

// 노래 등록
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