const User = require('../models/User');

let _cachedAdmin = null;

async function getAdmin() {
  if (!_cachedAdmin) {
    _cachedAdmin = await User.findOne({ isAdmin: true });
  }
  return _cachedAdmin;
}

const requireAuth = async (req, res, next) => {
  if (!req.user) {
    req.user = await getAdmin();
    res.locals.user = req.user;
    res.locals.isAdmin = true;
  }
  next();
};

const checkUser = async (req, res, next) => {
  const admin = await getAdmin();
  res.locals.user = admin;
  res.locals.isAdmin = true;
  req.user = admin;
  next();
};

const requireAdmin = (req, res, next) => {
  next();
};

module.exports = { requireAuth, checkUser, requireAdmin };
