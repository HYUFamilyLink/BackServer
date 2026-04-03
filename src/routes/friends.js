const router = require('express').Router();
const auth = require('../middleware/auth');
const { getFriendStatuses } = require('../controllers/friendController');

router.get('/statuses', auth, getFriendStatuses);

module.exports = router;