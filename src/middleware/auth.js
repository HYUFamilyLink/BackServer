// middleware/auth.js
const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  
  // 로그 추가: 요청이 들어오는지 확인
  console.log('--- [Auth Middleware] Request Header:', header);

  if (!header || !header.startsWith('Bearer ')) {
    console.log('--- [Auth Middleware] Error: No Token Provided');
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = header.slice(7);
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    console.log('--- [Auth Middleware] Success: User ID', decoded.id);
    next();
  } catch (err) {
    console.log('--- [Auth Middleware] Error: Invalid Token');
    res.status(401).json({ error: 'Invalid token' });
  }
}

module.exports = authMiddleware;