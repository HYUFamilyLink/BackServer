const router = require('express').Router();
const auth   = require('../middleware/auth');
const { getSongs, addSong } = require('../controllers/songController');

router.get('/',  auth, getSongs);
router.post('/', auth, addSong);

module.exports = router;
