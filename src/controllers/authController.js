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

async function updateProfile(req, res) {
  const { profileImage } = req.body; 
  const userId = req.user.id;

  // 1. 요청 데이터 확인 로그
  console.log(`[Profile Update Attempt] UserID: ${userId}, ChosenIndex: ${profileImage}`);

  // 유효성 검사 (0은 미선택이므로 1~12만 허용)
  if (!profileImage || profileImage < 1 || profileImage > 12) {
    console.log(`[Profile Update Refused] Invalid profile index: ${profileImage}`);
    return res.status(400).json({ error: '유효하지 않은 프로필 번호입니다.' });
  }

  try {
    // 2. DB 업데이트 실행
    const result = await pool.query(
      'UPDATE users SET profile_image = $1 WHERE id = $2::uuid RETURNING id, name, role, profile_image',
      [profileImage, userId]
    );

    // 3. 업데이트 결과 확인
    if (result.rows.length === 0) {
      console.log(`[Profile Update Failed] No user found with ID: ${userId}`);
      return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
    }

    const updatedUser = result.rows[0];
    console.log(`[Profile Update Success] User: ${updatedUser.name}, NewImage: ${updatedUser.profile_image}`);

    // 4. 새 정보를 담은 토큰 발행 (새로고침 시 유지용)
    const newToken = jwt.sign(
      { 
        id: updatedUser.id, 
        nickname: updatedUser.name, 
        role: updatedUser.role, 
        profile_image: updatedUser.profile_image 
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    // 5. 프론트엔드 응답 (변수명을 AuthStore와 일치시킴: profileImage)
    res.json({ 
      success: true, 
      user: { 
        id: updatedUser.id, 
        nickname: updatedUser.name, 
        role: updatedUser.role, 
        profileImage: updatedUser.profile_image 
      },
      token: newToken 
    });

  } catch (err) {
    console.error('[Profile Update Critical Error]', err);
    res.status(500).json({ error: '서버 오류로 프로필 업데이트 실패' });
  }
}

module.exports = { register, login, updateProfile }; 