const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const { pool } = require('../config/database');

async function register(req, res) {
  const { name, password, role } = req.body;
  if (!name || !password || password.length !== 4) {
    return res.status(400).json({ error: '성함과 4자리 생년월일이 필요합니다.' });
  }

  try {
    const validRole = ['vr', 'phone'].includes(role) ? role : 'phone';
    
    const { rows: existingUsers } = await pool.query(
      'SELECT name FROM users WHERE name = $1 AND role = $2',
      [name, validRole]
    );
    if (existingUsers.length > 0) {
      return res.status(409).json({ error: '이미 등록된 계정입니다.' });
    }

    const finalName = name;
    const hashed = await bcrypt.hash(password, 10);
    
    // ✨ [수정] RETURNING에 profile_image 추가 (기본값 0)
    const { rows } = await pool.query(
      `INSERT INTO users (name, pin, role) VALUES ($1, $2, $3) RETURNING id, name, role, profile_image`,
      [finalName, hashed, validRole]
    );

    const user = rows[0];
    const token = jwt.sign(
      { id: user.id, nickname: user.name, role: user.role, profile_image: user.profile_image }, 
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    res.status(201).json({ 
      user: { id: user.id, nickname: user.name, role: user.role, profileImage: user.profile_image }, 
      token 
    });
  } catch (err) {
    res.status(500).json({ error: '서버 오류' });
  }
}

async function login(req, res) {
  const { name, password, role } = req.body;
  try {
    // ✨ [수정] DB에서 profile_image도 함께 가져옴
    const { rows } = await pool.query('SELECT * FROM users WHERE name LIKE $1', [`${name}%`]);
    if (rows.length === 0) return res.status(401).json({ error: '정보 불일치' });

    let matchedUser = null;
    const nameRegex = new RegExp(`^${name}[A-Z]?$`);
    for (let user of rows) {
      if (nameRegex.test(user.name)) {
        const isValid = await bcrypt.compare(password, user.pin);
        if (isValid) { matchedUser = user; break; }
      }
    }
    if (!matchedUser) return res.status(401).json({ error: '정보 불일치' });

    const finalRole = role || 'phone';

    // ✨ [수정] 토큰 및 응답 객체에 profile_image 추가
    const token = jwt.sign(
      { id: matchedUser.id, nickname: matchedUser.name, role: finalRole, profile_image: matchedUser.profile_image },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );
    
    res.json({ 
      user: { id: matchedUser.id, nickname: matchedUser.name, role: finalRole, profileImage: matchedUser.profile_image }, 
      token 
    });
  } catch (err) {
    res.status(500).json({ error: '서버 오류' });
  }
}

// ✨ [신규 추가] 프로필 사진 변경 API
async function updateProfile(req, res) {
  const { profileImage } = req.body; // 1~12 사이의 숫자
  const userId = req.user.id;

  if (profileImage < 1 || profileImage > 12) {
    return res.status(400).json({ error: '유효하지 않은 프로필 번호입니다.' });
  }

  try {
    await pool.query(
      'UPDATE users SET profile_image = $1 WHERE id = $2',
      [profileImage, userId]
    );
    res.json({ success: true, profileImage });
  } catch (err) {
    console.error('[Profile Update Error]', err);
    res.status(500).json({ error: '프로필 업데이트 실패' });
  }
}

module.exports = { register, login, updateProfile }; 