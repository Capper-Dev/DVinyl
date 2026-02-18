const Settings = require('../models/Settings');
const themesConfig = require('../config/themes');

module.exports = async (req, res, next) => {
    try {
        res.locals.allThemes = themesConfig;

        let settings = await Settings.findOne().lean();
        if (!settings) {
            settings = {
                siteName: 'DVinyl',
                modules: { music: true, books: false, dvd: false },
                theme: {
                    home: { preset: 'default' },
                    music: { preset: 'emerald' },
                    books: { preset: 'amber' },
                    dvd: { preset: 'blue' }
                }
            };
        }
        res.locals.settings = settings;

        res.locals.currentLng = res.locals.user?.language || req.language || 'fr';
        res.locals.isDark = res.locals.user ? (res.locals.user.theme === 'dark') : true;

        const path = req.path.toLowerCase();
        const queryType = req.query.type; // ex: ?type=books
        
        let detectedType = 'home';

        if (path.includes('vinyl') || path.includes('cd') || path.includes('cassette') || path.includes('cd') || path.includes('album') || path.includes('music') || path.includes('collection') || path.includes('wishlist')) {
            detectedType = 'music';
        } else if (path.includes('book')) {
            detectedType = 'books';
        } else if (path.includes('dvd')) {
            detectedType = 'dvd';
        }

        res.locals.detectedType = detectedType;
        const activeType = queryType || detectedType;

        if (activeType === 'books' && !settings.modules.books && path !== '/') {
            return res.status(404).render('404');
        }
        if (activeType === 'dvd' && !settings.modules.dvd && path !== '/') {
            return res.status(404).render('404');
        }

        next();
    } catch (err) {
        console.error("[ERR] SettingsMiddleware:", err);
        res.locals.isDark = true;
        res.locals.currentLng = 'fr';
        res.locals.settings = { theme: { home: { preset: 'default' } } };
        next();
    }
};