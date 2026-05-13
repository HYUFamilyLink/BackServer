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
const { RtcTokenBuilder, RtcRole } = require('agora-access-token');

app.get('/api/agora/token', (req, res) => {
  const appId = process.env.AGORA_APP_ID;
  const appCertificate = process.env.AGORA_APP_CERTIFICATE;
  const channelName = req.query.roomId; 
  
  if (!channelName) return res.status(400).json({ error: 'roomId is required' });

  const userAccount = req.user && req.user.id 
    ? String(req.user.id).trim() 
    : String(Math.floor(Math.random() * 1000000)); 

  const role = RtcRole.PUBLISHER; 
  const privilegeExpiredTs = Math.floor(Date.now() / 1000) + 7200; // 2시간

  try {

    const token = RtcTokenBuilder.buildTokenWithAccount(
      appId, 
      appCertificate, 
      String(channelName), 
      userAccount, 
      role, 
      privilegeExpiredTs
    );
    

    res.json({ token, uid: userAccount });
  } catch (err) {
    console.error('Agora Token Error:', err);
    res.status(500).json({ error: 'Failed to generate token' });
  }
});
const aiRouter = require('./routes/ai');
app.use('/api/ai', aiRouter);