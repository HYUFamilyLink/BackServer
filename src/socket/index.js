const { Server } = require('socket.io');
const jwt        = require('jsonwebtoken');
const roomHandler   = require('./handlers/roomHandler');
const queueHandler  = require('./handlers/queueHandler');
const lyricsHandler = require('./handlers/lyricsHandler');

function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: '*' },
  });

  // JWT 인증 미들웨어
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('No token'));
    try {
      socket.user = jwt.verify(token, process.env.JWT_SECRET);
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`[Socket] Connected: ${socket.user.nickname} (${socket.id})`);

    roomHandler(io, socket);
    queueHandler(io, socket);
    lyricsHandler(io, socket);

    socket.on('disconnect', () => {
      console.log(`[Socket] Disconnected: ${socket.user.nickname}`);
    });
  });
}

module.exports = { initSocket };
