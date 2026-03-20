const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const { pool } = require('../config/database');

async function register(req, res) {
  const { nickname, email, password, role } = req.body;
  if (!nickname || !email || !password) {
    return res.status(400).json({ error: 'nickname, email, password required' });
  }

  try {
    const validRole = ['vr', 'phone'].includes(role) ? role : 'phone';
    const hashed = await bcrypt.hash(password, 10);

    const { rows } = await pool.query(
      `INSERT INTO users (nickname, email, password, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, nickname, email, role`,
      [nickname, email, hashed, validRole],
    );

    const user  = rows[0];
    const token = jwt.sign(
      { id: user.id, nickname: user.nickname, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN },
    );

    res.status(201).json({ user, token });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Email already in use' });
    }
    console.error('[authController] register error', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password required' });
  }

  try {
    const { rows } = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email],
    );
    const user = rows[0];

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, nickname: user.nickname, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN },
    );

    res.json({
      user: { id: user.id, nickname: user.nickname, email: user.email, role: user.role },
      token,
    });
  } catch (err) {
    console.error('[authController] login error', err);
    res.status(500).json({ error: 'Server error' });
  }
}

module.exports = { register, login };
