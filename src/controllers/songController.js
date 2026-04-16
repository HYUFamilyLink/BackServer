const axios = require('axios');
const { pool } = require('../config/database');

async function getSongs(req, res) {
  const { q } = req.query;
  
  if (!q) {
    return res.json([]);
  }

  try {
    // 1. 유튜브 API 검색
    const searchQuery = `${q} 금영노래방 공식 유튜브 채널`;
    const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY; // .env 파일에 설정
    
    const response = await axios.get('https://www.googleapis.com/youtube/v3/search', {
      params: {
        part: 'snippet',
        q: searchQuery,
        type: 'video',
        videoEmbeddable: 'true',
        videoSyndicated: 'true',
        maxResults: 20,
        key: YOUTUBE_API_KEY
      }
    });

    // 2. 검색 결과 가공
    const songs = response.data.items.map(item => {
  const videoId = item.id.videoId;
  const rawTitle = item.snippet.title;
  const thumbnail = item.snippet.thumbnails.high.url;

  // 1. 곡 번호 추출 (괄호 안의 KY.0000 또는 TJ.0000 패턴 매칭)
  const numberMatch = rawTitle.match(/\((KY|TJ)\.?\s*(\d+)\)/i);
  const songNo = numberMatch ? numberMatch[0].replace(/[()]/g, '') : ''; // 예: "KY.7463"

  // 2. 불필요한 태그 및 곡 번호 부분 제거 ([TJ노래방], (KY.1234), [KY 등)
  let cleanTitle = rawTitle
    .replace(/\[.*?\]/g, '') // [ ]로 둘러싸인 부분 제거
    .replace(/\(.*?\)/g, '') // ( )로 둘러싸인 부분(곡 번호 포함) 제거
    .replace(/\//g, '-')      // 구분자 통일
    .trim();

  let title = cleanTitle;
  let artist = '알 수 없음';

  // 3. 제목과 가수 분리 로직
  if (cleanTitle.includes('-')) {
    // "제목 - 가수" 형태일 때
    const parts = cleanTitle.split('-');
    title = parts[0].trim();
    artist = parts[1].trim();
  } else {
    // 하이픈이 없는 "제목 가수" 형태일 때 (마지막 공백 기준 분리)
    const lastSpaceIndex = cleanTitle.lastIndexOf(' ');
    if (lastSpaceIndex !== -1) {
      title = cleanTitle.substring(0, lastSpaceIndex).trim();
      artist = cleanTitle.substring(lastSpaceIndex).trim();
    }
  }

  return {
    id: videoId,
    // 곡 번호가 있으면 제목 옆에 표시하도록 구성
    title: songNo ? `${title} [${songNo}]` : title,
    artist: artist,
    thumbnail: thumbnail,
    songNo: songNo // 추후 예약 리스트 관리를 위해 별도 저장
  };
}).filter(song => song.songNo.startsWith('KY'));

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