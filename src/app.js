const express = require('express');
const cors    = require('cors');

const authRoutes  = require('./routes/auth');
const roomRoutes  = require('./routes/rooms');
const songRoutes  = require('./routes/songs');
const agoraRoutes = require('./routes/agora');
const friendsRouter = require('./routes/friends');
const app = express();

app.use(cors({
  origin: '*',
  allowedHeaders: ['Authorization', 'Content-Type', 'ngrok-skip-browser-warning'],
}));
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth',  authRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/songs', songRoutes);
app.use('/api/agora', agoraRoutes);
app.use('/api/friends', friendsRouter);
module.exports = app;
