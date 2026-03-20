const router = require('express').Router();
const auth   = require('../middleware/auth');
const { createRoom, getRoom, closeRoom } = require('../controllers/roomController');

router.post('/',               auth, createRoom);
router.get('/:joinCode',       auth, getRoom);
router.delete('/:roomId/close', auth, closeRoom);

module.exports = router;
