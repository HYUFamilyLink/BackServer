const express = require('express');
const { RtcTokenBuilder, RtcRole } = require('agora-token');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

const APP_ID          = process.env.AGORA_APP_ID;
const APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE;
const TOKEN_EXPIRE_SEC = 3600; // 1시간

// GET /api/agora/token?roomId=xxx
router.get('/token', authMiddleware, (req, res) => {
  const { roomId } = req.query;
  if (!roomId) return res.status(400).json({ error: 'roomId required' });

  const uid       = req.user.id;
  const expireAt  = Math.floor(Date.now() / 1000) + TOKEN_EXPIRE_SEC;

  const token = RtcTokenBuilder.buildTokenWithUid(
    APP_ID,
    APP_CERTIFICATE,
    String(roomId),
    uid,
    RtcRole.PUBLISHER,
    expireAt,
    expireAt,
  );

  res.json({ token, uid, appId: APP_ID });
});

module.exports = router;
