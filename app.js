// Licensed under MIT

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const cookieParser = require('cookie-parser');
const http = require('http');
const { Server } = require('socket.io');

const { checkUser, requireAuth } = require('./middleware/authMiddleware.js');
const settingsMiddleware = require('./middleware/settingsMiddleware');
const themesConfig = require('./config/themes');
const { BASE_URL } = require('./config/constants');

const authRoutes = require('./routes/authRoutes.js');
const albumRoutes = require('./routes/albumRoutes.js');
const adminRoutes = require('./routes/adminRoutes.js');
const settingsRoutes = require('./routes/settingsRoutes.js');
const backupRoutes = require('./routes/backupRoutes.js');
const dvdRoutes = require('./routes/dvdRoutes.js');
const gameRoutes = require('./routes/gameRoutes.js');
const collectionRoutes = require('./routes/collectionRoutes.js');
const barcodeRoutes = require('./routes/barcodeRoutes.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { path: BASE_URL + '/socket.io' });

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('io', io);

app.use(BASE_URL, express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cookieParser());

app.use(session({
    secret: process.env.SESSION_SECRET || 'change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.PROD === 'true',
        httpOnly: true,
        maxAge: 30 * 24 * 60 * 60 * 1000
    }
}));

if (process.env.PROD === 'true') {
    app.set('trust proxy', 1);
}

const pkg = require('./package.json');

// Prefix BASE_URL to res.redirect
app.use((req, res, next) => {
    const redirect = res.redirect;
    res.redirect = function (url) {
        if (typeof url === 'string' && url.startsWith('/') && !url.startsWith(BASE_URL)) {
            return redirect.call(this, `${BASE_URL}${url}`);
        }
        return redirect.call(this, url);
    };
    next();
});

app.use((req, res, next) => {
    res.locals.appVersion = pkg.version;
    res.locals.baseUrl = BASE_URL;
    req.io = io;
    next();
});

app.use(checkUser);

// Auth gate — everything requires login except the login page itself and static assets.
app.use((req, res, next) => {
    const p = req.path;
    const open = (
        p === '/login' ||
        p.startsWith(BASE_URL + '/login') ||
        p.startsWith('/ressources') ||
        p.startsWith('/styles') ||
        p.startsWith('/manifest.json') ||
        p === '/sw.js' ||
        p.startsWith('/favicon')
    );
    if (open) return next();
    return requireAuth(req, res, next);
});

app.use(settingsMiddleware);

app.use((req, res, next) => {
    res.locals.allThemes = themesConfig;
    next();
});

app.get(BASE_URL + '/manifest.json', (req, res) => {
    res.set('Content-Type', 'application/json');
    res.render(path.join(__dirname, 'public-tpl', 'manifest.json.ejs'));
});

app.get(BASE_URL + '/sw.js', (req, res) => {
    res.set('Content-Type', 'application/javascript');
    res.set('Service-Worker-Allowed', BASE_URL || '/');
    res.render(path.join(__dirname, 'public-tpl', 'sw.js.ejs'));
});

app.use(BASE_URL, authRoutes);
app.use(BASE_URL, albumRoutes);
app.use(BASE_URL + '/admin', adminRoutes);
app.use(BASE_URL + '/settings', settingsRoutes);
app.use(BASE_URL + '/backup', backupRoutes);
app.use(BASE_URL, dvdRoutes);
app.use(BASE_URL, gameRoutes);
app.use(BASE_URL + '/api/collections', collectionRoutes);
app.use(BASE_URL + '/api/barcodes', barcodeRoutes);

app.use((req, res) => res.status(404).render('404'));

const connectDB = require('./config/db.js');
const migrateDatabase = require('./utils/migrate.js');

connectDB()
    .then(async () => {
        await migrateDatabase();
        server.listen(process.env.VINYL_PORT, () => {
            console.log(`🚀 Server started on port ${process.env.VINYL_PORT}`);
        });
    })
    .catch((err) => console.log('❌DB Error:', err));
