const express = require('express');
const { RtcTokenBuilder, RtcRole } = require('agora-token');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

const APP_ID          = process.env.AGORA_APP_ID;
const APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE;
const TOKEN_EXPIRE_SEC = 3600; // 1시간

//해시화 알고리즘
//uid를 string 으로 하면 유니티에서 많이 힘듭니다...
//socket id 문자열을 해시화한 값을 그대로 agora의 uid로 사용
function getAgoraUid(strId) {
  let hash = 5381;
  for (let i = 0; i < strId.length; i++) {
    hash = ((hash << 5) + hash) + strId.charCodeAt(i);
  }
  return hash >>> 0;
}


// GET /api/agora/token?roomId=xxx
router.get('/token', authMiddleware, (req, res) => {
  const { roomId } = req.query;
  if (!roomId) return res.status(400).json({ error: 'roomId required' });

  // req.user.id는 uint
  const uid       = getAgoraUid(String(req.user.id)); 
  const expireAt  = Math.floor(Date.now() / 1000) + TOKEN_EXPIRE_SEC;

  const token = RtcTokenBuilder.buildTokenWithUserAccount(
    APP_ID,
    APP_CERTIFICATE,
    String(roomId),
    uid, // uint 계정 ID
    RtcRole.PUBLISHER,
    expireAt,
    expireAt
  );

  res.json({ token, uid, appId: APP_ID });
});

module.exports = router;
