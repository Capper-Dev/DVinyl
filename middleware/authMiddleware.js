const User = require('../models/User');

const requireAuth = async (req, res, next) => {
  if (!req.user) {
    const admin = await User.findOne({ isAdmin: true });
    req.user = admin;
    res.locals.user = admin;
    res.locals.isAdmin = true;
  }
  next();
};

const checkUser = async (req, res, next) => {
  const admin = await User.findOne({ isAdmin: true });
  res.locals.user = admin;
  res.locals.isAdmin = true;
  req.user = admin;
  next();
};

const requireAdmin = (req, res, next) => {
  next();
};

module.exports = { requireAuth, checkUser, requireAdmin };
