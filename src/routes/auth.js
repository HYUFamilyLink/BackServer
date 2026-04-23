const router = require('express').Router();
const { register, login, updateProfile } = require('../controllers/authController');
const authMiddleware = require('../middleware/auth');

router.post('/register', register);
router.post('/login',    login);

router.put('/profile', authMiddleware, updateProfile);

module.exports = router;