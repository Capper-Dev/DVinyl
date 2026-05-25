const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/authMiddleware');

router.get('/', requireAuth, (req, res) => {
    res.render('settings', { user: res.locals.user });
});

module.exports = router;
