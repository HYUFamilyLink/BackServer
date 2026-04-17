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
    // DB 컬럼명은 name을 사용
    // 동일 name + role 조합은 중복 가입 차단 (PIN 무관)
    const { rows: existingUsers } = await pool.query(
      'SELECT name FROM users WHERE name = $1 AND role = $2',
      [name, validRole]
    );
    if (existingUsers.length > 0) {
      return res.status(409).json({ error: '이미 등록된 계정입니다.' });
    }

    const finalName = name;

    const hashed = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (name, pin, role) VALUES ($1, $2, $3) RETURNING id, name, role`,
      [finalName, hashed, validRole]
    );

    const user = rows[0];
    const token = jwt.sign(
      { id: user.id, nickname: user.name, role: user.role }, // 토큰 안에서도 nickname으로 통일
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    // 프론트엔드 호환을 위해 nickname으로 반환
    res.status(201).json({ 
      user: { id: user.id, nickname: user.name, role: user.role }, 
      token 
    });
  } catch (err) {
    res.status(500).json({ error: '서버 오류' });
  }
}

async function login(req, res) {
  //로그인 시점에서 role을 구분하기 위한 수정
  const { name, password, role } = req.body;
  try {
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

    // 수정: 입력을 안하더라도 기본값 phone 지정 (프론트/유니티 버그 방지)
    const finalRole = role || 'phone';

    // 수정: 입력에 따라 결정된 role로 토큰 생성
    const token = jwt.sign(
      { id: matchedUser.id, nickname: matchedUser.name, role: finalRole },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );
    // 수정: 입력에 따라 결정된 role로 응답 반환
    res.json({ 
      user: { id: matchedUser.id, nickname: matchedUser.name, role: finalRole }, 
      token 
    });
  } catch (err) {
    res.status(500).json({ error: '서버 오류' });
  }
}

module.exports = { register, login };