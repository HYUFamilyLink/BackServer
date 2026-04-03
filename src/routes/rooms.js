const router = require('express').Router();
const auth   = require('../middleware/auth');
const { 
  createRoom, 
  getRoom, 
  closeRoom, 
  getActiveRooms 
} = require('../controllers/roomController');

router.get('/',                auth, getActiveRooms); // 방 목록 조회 추가
router.post('/',               auth, createRoom);
router.get('/:joinCode',       auth, getRoom);
router.delete('/:roomId/close', auth, closeRoom);

module.exports = router;