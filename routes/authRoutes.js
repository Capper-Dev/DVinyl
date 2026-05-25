const { Router } = require('express');
const { getUsers, verifyCredentials } = require('../middleware/authMiddleware');
const { BASE_URL } = require('../config/constants');

const router = Router();

router.get('/login', (req, res) => {
    if (req.user) return res.redirect(BASE_URL + '/');
    res.render('login', {
        error: null,
        users: getUsers(),
        prefill: req.query.user || ''
    });
});

router.post('/login', (req, res) => {
    const { name, password } = req.body;
    const user = verifyCredentials(name, password);
    if (!user) {
        return res.render('login', {
            error: 'Forkert navn eller adgangskode',
            users: getUsers(),
            prefill: name || ''
        });
    }
    req.session.userName = user.name;
    res.redirect(BASE_URL + '/');
});

router.post('/logout', (req, res) => {
    req.session.destroy(() => res.redirect(BASE_URL + '/login'));
});

router.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect(BASE_URL + '/login'));
});

module.exports = router;
