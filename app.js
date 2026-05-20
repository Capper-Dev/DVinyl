// Licensed under MIT

/**
 * app.js
 *
 * Express application entrypoint. Sets up i18n, global middleware,
 * route mounting, database connection and sockets. Intended for local
 * development and small deployments; review security settings for
 * production use.
 */
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const { checkUser } = require('./middleware/authMiddleware.js');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');
const http = require('http');
const { Server } = require("socket.io");

const i18next = require('i18next');
const i18nMiddleware = require('i18next-http-middleware');

const settingsMiddleware = require('./middleware/settingsMiddleware');
const themesConfig = require('./config/themes');
const { BASE_URL } = require('./config/constants');

// Models
const User = require('./models/User.js');
const BlockedIP = require('./models/blockedIP.js');

// Routes imports
const setupRoutes = require('./routes/setupRoutes');
const authRoutes = require('./routes/authRoutes.js');
const albumRoutes = require('./routes/albumRoutes.js');
const adminRoutes = require('./routes/adminRoutes.js');
const settingsRoutes = require('./routes/settingsRoutes.js');
const backupRoutes = require('./routes/backupRoutes.js');
const bookRoutes = require('./routes/bookRoutes');
const dvdRoutes = require('./routes/dvdRoutes.js');
const gameRoutes = require('./routes/gameRoutes.js');
const collectionRoutes = require('./routes/collectionRoutes.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  path: BASE_URL + '/socket.io',
});


i18next
  .init({
    lng: 'en',
    fallbackLng: 'en',
    preload: ['en', 'fr', 'es', 'it', 'de'],
    resources: {
      en: { translation: require('./locales/en.json') },
      fr: { translation: require('./locales/fr.json') },
      es: { translation: require('./locales/es.json') },
      it: { translation: require('./locales/it.json') },
      de: { translation: require('./locales/de.json') }
    }
  });


// Basic configuration
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('io', io); // Expose io to routes

// Global middlewares
app.use(BASE_URL, express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cookieParser());


app.use(i18nMiddleware.handle(i18next));


app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
  cookie: { secure: process.env.PROD === 'true', httpOnly: true },
}));

if (process.env.PROD === 'true') {
  app.set('trust proxy', 1); // Trust first proxy
}

const pkg = require('./package.json');

// Incext BASE_URL in each res.redirect call
app.use((req, res, next) => {
  const redirect = res.redirect;

  res.redirect = function (url) {
    if (url.startsWith('/') && !url.startsWith(BASE_URL)) {
      return redirect.call(this, `${BASE_URL}${url}`);
    } else {
      return redirect.call(this, url);
    }
  };

  next();
});

app.use(async (req, res, next) => {
  // If the user is authenticated and has a language preference, enforce it
  if (req.user && req.user.language) {
    await req.i18n.changeLanguage(req.user.language);
  }

  // Make translation helper and current language available to all EJS views
  res.locals.t = req.t;
  res.locals.currentLng = req.language;
  res.locals.appVersion = pkg.version;
  res.locals.baseUrl = BASE_URL;
  req.io = io;
  next();
});


// Inject IO object into requests
app.use((req, res, next) => {
  req.io = io;
  next();
});

// Security: IP blocking middleware
app.use(async (req, res, next) => {
  const clientIP = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
  try {
    const blocked = await BlockedIP.findOne({ ip: clientIP });
    if (blocked) return res.status(403).send(req.t('common.forbidden'));
    next();
  } catch (err) {
    console.error('IP error:', err);
    next();
  }
});

// Check user middleware (populate res.locals.user for all views)
app.use(checkUser);
app.use(settingsMiddleware);

// Installation gatekeeper middleware
app.use(async (req, res, next) => {
    // Ignore paths that should not be redirected during setup
    if (req.path.startsWith(BASE_URL + '/setup') || 
      req.path.startsWith(BASE_URL + '/ressources') || 
      req.path.startsWith(BASE_URL + '/styles') ||
      req.path.startsWith(BASE_URL + '/login') ||
      req.path.startsWith(BASE_URL + '/backup') ) { // allow login and backup import while setting up
        return next();
    }

    try {
        const count = await User.countDocuments();
        if (count === 0) {
            return res.redirect(BASE_URL + '/setup');
        }
    } catch (e) {
        console.error("Check setup error:", e);
    }
    
    next();
});

app.use((req, res, next) => {
    res.locals.allThemes = themesConfig; 
    next();
});


// Dynamic manifest.json endpoint - injects BASE_URL
app.get(BASE_URL + '/manifest.json', (req, res) => {
    res.set('Content-Type', 'application/json');
    res.render(path.join(__dirname, 'public-tpl', 'manifest.json.ejs'));
});

// Dynamic service worker endpoint - injects BASE_URL
app.get(BASE_URL + '/sw.js', (req, res) => {
    res.set('Content-Type', 'application/javascript');
    res.set('Service-Worker-Allowed', BASE_URL || '/');
    res.render(path.join(__dirname, 'public-tpl', 'sw.js.ejs'));
});


// Route mounting
app.use(BASE_URL + '/setup', setupRoutes);
app.use(BASE_URL, authRoutes);
app.use(BASE_URL, albumRoutes);
app.use(BASE_URL + '/admin', adminRoutes);
app.use(BASE_URL + '/settings', settingsRoutes);
app.use(BASE_URL + '/backup', backupRoutes);
app.use(BASE_URL, bookRoutes);
app.use(BASE_URL, dvdRoutes);
app.use(BASE_URL, gameRoutes);
app.use(BASE_URL + '/api/collections', collectionRoutes);

app.use((req, res) => {
    res.status(404).render('404');
});

const connectDB = require('./config/db.js');
const migrateDatabase = require('./utils/migrate.js');
// Database connection and server start
connectDB()
  .then(async () => {
    await migrateDatabase();
    server.listen(process.env.VINYL_PORT, () => {
        console.log(`🚀 Server started on port ${process.env.VINYL_PORT}`);
    });
  })
  .catch((err) => console.log('❌DB Error:', err));


// Socket event
// io.on('connection', (socket) => {
//   console.log('Connected socket :', socket.id);
// });
