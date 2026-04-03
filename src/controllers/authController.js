const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const { pool } = require('../config/database');

async function register(req, res) {
  const { name, password, role } = req.body; // password는 4자리 생년월일
  
  if (!name || !password || password.length !== 4) {
    return res.status(400).json({ error: '성함과 4자리 생년월일이 필요합니다.' });
  }

  try {
    const validRole = ['vr', 'phone'].includes(role) ? role : 'phone';

    // 1. 중복 이름 검색 (DB 컬럼명 'name' 사용)
    const { rows: existingUsers } = await pool.query(
      'SELECT name FROM users WHERE name LIKE $1 ORDER BY name DESC',
      [`${name}%`]
    );

    let finalName = name;

    // 2. 동명이인 A, B, C 부여 로직
    if (existingUsers.length > 0) {
      const exactMatch = existingUsers.find(u => u.name === name);
      if (exactMatch) {
        const alphabets = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        let nextChar = 'A';
        for (let row of existingUsers) {
          const suffix = row.name.replace(name, '');
          if (suffix.length === 1 && alphabets.includes(suffix)) {
            const nextIndex = alphabets.indexOf(suffix) + 1;
            nextChar = alphabets[nextIndex] || 'A';
            break;
          }
        }
        finalName = name + nextChar;
      }
    }

    const hashed = await bcrypt.hash(password, 10);

    // 3. DB 저장 (schema.sql의 name, pin 컬럼에 맞춤)
    const { rows } = await pool.query(
      `INSERT INTO users (name, pin, role)
       VALUES ($1, $2, $3)
       RETURNING id, name, role`,
      [finalName, hashed, validRole],
    );

    const user = rows[0];
    const token = jwt.sign(
      { id: user.id, nickname: user.name, role: user.role }, // 프론트 호환성을 위해 nickname으로 토큰 생성
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN },
    );

    res.status(201).json({ user: { ...user, nickname: user.name }, token });
  } catch (err) {
    console.error('[authController] register error', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
}

async function login(req, res) {
  const { name, password } = req.body;
  if (!name || !password) {
    return res.status(400).json({ error: '성함과 생년월일이 필요합니다.' });
  }

  try {
    // 1. 이름으로 시작하는 유저들 검색
    const { rows } = await pool.query('SELECT * FROM users WHERE name LIKE $1', [`${name}%`]);

    if (rows.length === 0) {
      return res.status(401).json({ error: '정보가 맞지 않습니다.' });
    }

    let matchedUser = null;
    const nameRegex = new RegExp(`^${name}[A-Z]?$`);

    // 2. 비밀번호(pin) 대조
    for (let user of rows) {
      if (nameRegex.test(user.name)) {
        const isValid = await bcrypt.compare(password, user.pin);
        if (isValid) { matchedUser = user; break; }
      }
    }

    if (!matchedUser) return res.status(401).json({ error: '정보가 맞지 않습니다.' });

    const token = jwt.sign(
      { id: matchedUser.id, nickname: matchedUser.name, role: matchedUser.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN },
    );

    res.json({ user: { id: matchedUser.id, nickname: matchedUser.name, role: matchedUser.role }, token });
  } catch (err) {
    console.error('[authController] login error', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
}

module.exports = { register, login };