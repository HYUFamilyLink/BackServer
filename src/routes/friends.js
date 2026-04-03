const router = require('express').Router();
const auth = require('../middleware/auth');
const { getFriendStatuses, getAcceptedFriends } = require('../controllers/friendController');

router.get('/statuses', auth, getFriendStatuses);
router.get('/list', auth, getAcceptedFriends); // 친구 목록 API 추가

module.exports = router;