const Settings = require('../models/Settings');
const themesConfig = require('../config/themes');
const { BASE_URL } = require('../config/constants');

module.exports = async (req, res, next) => {
    try {
        res.locals.allThemes = themesConfig;

        let settings = await Settings.findOne().lean();
        if (!settings) {
            settings = {
                siteName: 'DVinyl',
                modules: { dvd: true, games: true },
                navbarShortcuts: ['global_home', 'dvd', 'games', 'global_wishlist'],
                statsWidgets: ['total', 'dvd_total', 'game_total', 'director'],
                theme: {
                    home: { preset: 'default' },
                    dvd: { preset: 'default' },
                    games: { preset: 'default' }
                }
            };
        } else {
            if (!settings.navbarShortcuts) {
                settings.navbarShortcuts = ['global_home', 'dvd', 'games', 'global_wishlist'];
            }
            if (!settings.statsWidgets) {
                settings.statsWidgets = ['total', 'dvd_total', 'game_total', 'director'];
            }
        }

        settings.navbarShortcuts = settings.navbarShortcuts || ['global_home', 'dvd', 'games', 'global_wishlist'];
        settings.statsWidgets = settings.statsWidgets || ['total', 'dvd_total', 'game_total', 'director'];

        res.locals.settings = settings;

        res.locals.isDark = res.locals.user ? (res.locals.user.theme === 'dark') : true;

        const fullPath = req.path.toLowerCase();
        const path = fullPath.startsWith(BASE_URL.toLowerCase())
            ? fullPath.slice(BASE_URL.length)
            : fullPath;

        const queryType = req.query.type;

        let detectedType = 'home';

        if (path.includes('game') || path.includes('games')) {
            detectedType = 'games';
        } else if (path.includes('dvd')) {
            detectedType = 'dvd';
        }

        res.locals.detectedType = detectedType;
        const activeType = queryType || detectedType;

        res.locals.currentType = activeType;

        const isAllowedAction = req.method === 'DELETE' || path.startsWith(BASE_URL + '/api/') ||
            path.includes('/dvd/') || path.includes('/game/') ||
            path.includes('/save-');

        if (activeType === 'dvd' && !settings.modules.dvd && path !== '/' && !isAllowedAction) {
            return res.status(404).render('404');
        }
        if (activeType === 'games' && !settings.modules.games && path !== '/' && !isAllowedAction) {
            return res.status(404).render('404');
        }

        next();
    } catch (err) {
        console.error("[ERR] SettingsMiddleware:", err);
        res.locals.isDark = true;
        res.locals.settings = { theme: { home: { preset: 'default' } } };
        next();
    }
};
