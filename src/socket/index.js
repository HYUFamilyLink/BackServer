const { Server } = require('socket.io');
const jwt        = require('jsonwebtoken');
const roomHandler   = require('./handlers/roomHandler');
const queueHandler  = require('./handlers/queueHandler');
const lyricsHandler = require('./handlers/lyricsHandler');
const friendHandler = require('./handlers/friendHandler'); // 추가

function initSocket(httpServer) {
  const io = new Server(httpServer, { cors: { origin: '*' } });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('No token'));
    try {
      socket.user = jwt.verify(token, process.env.JWT_SECRET);
      // 개인 알림을 받기 위해 유저 고유 ID로 룸을 미리 조인시킴
      socket.join(socket.user.id); 
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    roomHandler(io, socket);
    queueHandler(io, socket);
    lyricsHandler(io, socket);
    friendHandler(io, socket); // 추가
  });
}

module.exports = { initSocket };