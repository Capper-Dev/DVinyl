function parseAuthUsers() {
    const raw = process.env.AUTH_USERS || '';
    return raw.split(',').map(pair => {
        const [name, password] = pair.split(':').map(s => (s || '').trim());
        if (!name || !password) return null;
        return { name, password };
    }).filter(Boolean);
}

let _cached = null;
function getUsers() {
    if (!_cached) _cached = parseAuthUsers();
    return _cached;
}

function findUser(name) {
    const lower = (name || '').trim().toLowerCase();
    return getUsers().find(u => u.name.toLowerCase() === lower) || null;
}

function verifyCredentials(name, password) {
    const u = findUser(name);
    if (!u) return null;
    if ((password || '').trim().toLowerCase() !== u.password.toLowerCase()) return null;
    return { name: u.name };
}

const checkUser = (req, res, next) => {
    const session = req.session || {};
    if (session.userName) {
        const u = findUser(session.userName);
        if (u) {
            req.user = { name: u.name };
            res.locals.user = req.user;
            res.locals.isAdmin = true;
            return next();
        }
    }
    req.user = null;
    res.locals.user = null;
    res.locals.isAdmin = false;
    next();
};

const requireAuth = (req, res, next) => {
    if (!req.user) {
        if (req.xhr || req.headers.accept?.includes('application/json')) {
            return res.status(401).json({ error: 'Login required' });
        }
        return res.redirect((process.env.BASE_URL || '') + '/login');
    }
    next();
};

const requireAdmin = (req, res, next) => next();

module.exports = {
    checkUser,
    requireAuth,
    requireAdmin,
    getUsers,
    verifyCredentials
};
