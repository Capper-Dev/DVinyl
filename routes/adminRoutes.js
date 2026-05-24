const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const User = require('../models/User');
const BlockedIP = require('../models/blockedIP');
const LoginLog = require('../models/LoginLog');
const Settings = require('../models/Settings');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');
const PRESETS = require('../config/themes');
const axios = require('axios');
const https = require('https');
const Item = require('../models/Item');
const Dvd = require('../models/Dvd');
const Game = require('../models/Game');
const { igdbRequest } = require('../utils/igdbHelper');

/**
 * routes/adminRoutes.js
 *
 * Administration routes: user management, IP blocking and login logs.
 */

/**
 * Generate a random password.
 * @param {number} [length=12]
 * @returns {string}
 */
const createPassword = (length = 12) => {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+";
    let password = "";
    for (let i = 0; i < length; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
};

/**
 * Helper to load the common admin data used by the dashboard view.
 * Centralizing this avoids duplicating queries across handlers.
 */
async function loadAdminData() {
    const users = await User.find().sort({ lastChange: -1 });
    const blockedIps = await BlockedIP.find().sort({ createdAt: -1 });
    const logs = await LoginLog.find().sort({ timestamp: -1 }).limit(20);

    // Get distinct genres grouped by kind
    const admin = await User.findOne({ isAdmin: true }).select('_id');
    const adminId = admin ? admin._id : null;

    const pipeline = [
        { $match: { owner: adminId } },
        {
            $project: {
                kind: 1,
                allGenres: {
                    $concatArrays: [
                        { $cond: [{ $in: ["$genre", ["", null]] }, [], ["$genre"]] },
                        { $ifNull: ["$genres", []] },
                        { $ifNull: ["$styles", []] }
                    ]
                }
            }
        },
        { $unwind: "$allGenres" },
        {
            $group: {
                _id: "$kind",
                genres: { $addToSet: "$allGenres" }
            }
        }
    ];

    const genreGroupsRaw = await Item.aggregate(pipeline);

    const allGenres = {};
    genreGroupsRaw.forEach(group => {
        if (group._id && group.genres && group.genres.length > 0) {
            allGenres[group._id] = group.genres.filter(Boolean).sort();
        }
    });

    const visibilitySettings = await Settings.findOne().populate('visibility.hiddenItems').lean() || {};

    return { users, blockedIps, logs, allGenres, visibilitySettings };
}

// DASHBOARD (GET)
router.get('/', requireAuth, requireAdmin, async (req, res) => {
    try {
        const data = await loadAdminData();

        // Read optional message key from query and translate in the view.
        const msgKey = req.query.msg;
        const messageMap = {
            user_created: 'Bruger oprettet!',
            user_deleted: 'Bruger slettet.',
            ip_blocked: 'IP-adresse blokeret.',
            ip_unblocked: 'IP-adresse afblokeret.',
            password_updated: 'Adgangskode opdateret.',
            avatar_updated: 'Profilbillede opdateret!'
        };

        res.render('admin', {
            ...data,
            user: res.locals.user,
            successMessage: msgKey ? (messageMap[msgKey] || null) : null,
            newPassword: null,
            hasTmdbKey: !!process.env.TMDB_API_KEY,
            hasIgdbKey: !!(process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET)
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Intern serverfejl.');
    }
});

// Add user (POST)
router.post('/add-user', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { username, email } = req.body;
        const password = createPassword();
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create user then force-update the stored password hash.
        const newUser = await User.create({
            username,
            email,
            password: password,
            lastChange: new Date()
        });

        await User.updateOne(
            { _id: newUser._id },
            { $set: { password: hashedPassword } }
        );

        // Reload admin data (including logs) for the rendered view.
        const data = await loadAdminData();

        res.render('admin', {
            ...data,
            user: res.locals.user,
            successMessage: `Utilisateur ${username} créé !`,
            newPassword: password
        });

    } catch (err) {
        console.error("Creation error:", err);
        res.redirect('/admin?msg=user_created');
    }
});

// Reset password (POST)
router.post('/reset-password', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { userId } = req.body;
        const userToUpdate = await User.findById(userId);

        if (userToUpdate) {
            const password = createPassword();
            const hashedPassword = await bcrypt.hash(password, 10);

            await User.updateOne(
                { _id: userId },
                { $set: { password: hashedPassword, lastChange: new Date() } }
            );

            // Reload data for the view after change.
            const data = await loadAdminData();

            res.render('admin', {
                ...data,
                user: res.locals.user,
                successMessage: `Adgangskode nulstillet for ${userToUpdate.username}.`,
                newPassword: password
            });
        } else {
            res.redirect('/admin');
        }
    } catch (err) {
        console.error(err);
        res.redirect('/admin');
    }
});

// 4. Simple actions (redirects)
// These handlers redirect back to the admin root and therefore do not
// need to reload the logs.
router.post('/delete-user', requireAuth, requireAdmin, async (req, res) => {
    try {
        if (req.body.userId === res.locals.user._id.toString()) return res.redirect('/admin?msg=delete_self_error');
        await User.findByIdAndDelete(req.body.userId);
        res.redirect('/admin?msg=user_deleted');
    } catch (err) { res.redirect('/admin'); }
});

router.post('/block-ip', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { ipAddress } = req.body;
        const exists = await BlockedIP.findOne({ ip: ipAddress });
        if (!exists) await BlockedIP.create({ ip: ipAddress });
        res.redirect('/admin?msg=ip_blocked');
    } catch (err) { res.redirect('/admin'); }
});

router.post('/unblock-ip', requireAuth, requireAdmin, async (req, res) => {
    try {
        await BlockedIP.findByIdAndDelete(req.body.ipId);
        res.redirect('/admin?msg=ip_unblocked');
    } catch (err) { res.redirect('/admin'); }
});


router.get('/personnalisation', requireAuth, requireAdmin, async (req, res) => {
    try {
        res.render('personnalisation', {
            presets: PRESETS
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("ERR");
    }
});

router.post('/personnalisation/save', requireAuth, requireAdmin, async (req, res) => {
    try {
        const {
            homePreset, dvdPreset, gamesPreset,
            navbarShortcuts, statsWidgets
        } = req.body;

        const shortcuts = Array.isArray(navbarShortcuts) ? navbarShortcuts : (navbarShortcuts ? [navbarShortcuts] : []);
        const stats = Array.isArray(statsWidgets) ? statsWidgets : (statsWidgets ? [statsWidgets] : []);

        const validFastAdd = ['', 'dvd', 'game'];
        const fastAdd = validFastAdd.includes(req.body.fastAdd) ? req.body.fastAdd : '';

        const update = {
            'theme.home.preset': homePreset,
            'theme.dvd.preset': dvdPreset,
            'theme.games.preset': gamesPreset,
            'navbarShortcuts': shortcuts,
            'statsWidgets': stats,
            'fastAdd': fastAdd
        };

        await Settings.findOneAndUpdate({}, { $set: update }, { upsert: true });

        res.redirect('/admin/personnalisation?msg=saved');
    } catch (err) {
        console.error("[ERR] perso save", err);
        res.status(500).send("[ERR] perso save failed.");
    }
});


router.post('/modules/save', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { dvdActive, gamesActive } = req.body;

        if (!dvdActive && !gamesActive) {
            return res.redirect('/admin?msg=error_no_module');
        }

        const update = {
            'modules.dvd': dvdActive === 'on',
            'modules.games': gamesActive === 'on'
        };

        await Settings.findOneAndUpdate({}, { $set: update }, { upsert: true });

        res.redirect('/admin?msg=saved');
    } catch (err) {
        console.error("[ERR] modules save", err);
        res.status(500).send("[ERR] modules save failed.");
    }
});

router.post('/visibility/save', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { applyToAdmin, hiddenItems, hiddenGenres, hiddenTypes } = req.body;

        let parsedItems = [];
        if (hiddenItems) {
            try {
                parsedItems = JSON.parse(hiddenItems);
            } catch (e) {
                parsedItems = [];
            }
        }

        const applyToAdminVal = applyToAdmin === 'on' || applyToAdmin === 'true' || applyToAdmin === true;
        const update = {
            'visibility.applyToAdmin': applyToAdminVal,
            'visibility.hiddenItems': parsedItems,
            'visibility.hiddenGenres': Array.isArray(hiddenGenres) ? hiddenGenres : (hiddenGenres ? [hiddenGenres] : []),
            'visibility.hiddenTypes': Array.isArray(hiddenTypes) ? hiddenTypes : (hiddenTypes ? [hiddenTypes] : [])
        };

        await Settings.findOneAndUpdate({}, { $set: update }, { upsert: true });

        res.redirect('/admin?msg=saved');
    } catch (err) {
        console.error("[ERR] visibility save", err);
        res.status(500).send("[ERR] visibility save failed.");
    }
});

router.get('/api/search-collection', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { q } = req.query;
        if (!q) return res.json([]);

        const admin = await User.findOne({ isAdmin: true }).select('_id');
        const adminId = admin ? admin._id : null;

        const regex = new RegExp(q, 'i');
        const items = await Item.find({
            owner: adminId,
            $and: [
                { $or: [{ kind: 'Dvd' }, { kind: 'Game' }] },
                { $or: [{ title: regex }, { director: regex }] }
            ]
        }).limit(10).select('_id title director kind cover_image format format_type platform media_type').lean();

        res.json(items);
    } catch (err) {
        console.error("[ERR] search collection", err);
        res.status(500).json({ error: "Search failed" });
    }
});

router.get('/api/search-image-universal', requireAuth, requireAdmin, async (req, res) => {
    const { q, type } = req.query;
    console.log(`[SEARCH] Query: "${q}" | Type: ${type}`);

    const axiosConfig = {
        headers: { 'User-Agent': 'DVinylApp/2.0' },
        timeout: 10000,
        httpsAgent: new https.Agent({ family: 4, keepAlive: true })
    };

    try {
        if (type === 'game') {
            try {
                // 1. Get IGDB assets (Covers + Artworks + Screenshots)
                const igdbResults = await igdbRequest('games',
                    `search "${q.replace(/"/g, '\\"')}";
                    fields cover.url, artworks.url, screenshots.url;
                    limit 5;`
                );

                let urls = [];
                igdbResults.forEach(g => {
                    if (g.cover && g.cover.url) urls.push(g.cover.url);
                    if (g.artworks) g.artworks.forEach(a => urls.push(a.url));
                    if (g.screenshots) g.screenshots.forEach(s => urls.push(s.url));
                });

                urls = urls.map(u => {
                    let res = u.replace('t_thumb', 't_cover_big');
                    if (res.startsWith('//')) res = 'https:' + res;
                    return res;
                });

                // TMDB fallback
                const tmdbApiKey = process.env.TMDB_API_KEY;
                if (tmdbApiKey) {
                    const tmdbUrl = `https://api.themoviedb.org/3/search/multi?api_key=${tmdbApiKey}&query=${encodeURIComponent(q)}&language=en-US`;
                    const tmdbRes = await axios.get(tmdbUrl, axiosConfig);
                    const tmdbUrls = (tmdbRes.data.results || [])
                        .filter(item => item.poster_path)
                        .map(item => `https://image.tmdb.org/t/p/w500${item.poster_path}`);
                    urls = [...urls, ...tmdbUrls];
                }

                // iTunes software fallback
                const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=software&limit=5`;
                const itunesRes = await axios.get(itunesUrl, axiosConfig);
                const itunesUrls = (itunesRes.data.results || [])
                    .filter(item => item.artworkUrl100)
                    .map(item => item.artworkUrl100.replace('100x100bb', '512x512bb'));
                urls = [...urls, ...itunesUrls];

                return res.json([...new Set(urls)]);
            } catch (err) {
                console.error("[ERR] Game image search failed:", err.message);
                return res.json([]);
            }
        }

        if (type === 'movie') {
            const tmdbApiKey = process.env.TMDB_API_KEY;
            if (!tmdbApiKey) {
                console.error("[ERR] TMDB_API_KEY missing");
                return res.status(500).json({ error: "Missing TMDB API Key" });
            }

            const tmdbUrl = `https://api.themoviedb.org/3/search/multi?api_key=${tmdbApiKey}&query=${encodeURIComponent(q)}&language=en-US`;
            const response = await axios.get(tmdbUrl, axiosConfig);

            const results = (response.data.results || [])
                .filter(item => item.poster_path)
                .map(item => `https://image.tmdb.org/t/p/w500${item.poster_path}`);

            console.log(`[SEARCH] TMDB found: ${results.length} posters`);
            return res.json(results);
        }

        return res.json([]);

    } catch (err) {
        console.error("[ERR] search image universal:", err.message);
        res.status(500).json({ error: "[ERR] connexion error" });
    }
});


router.post('/delete-last-items', requireAuth, requireAdmin, async (req, res) => {
    const { count, kind } = req.body;
    const n = parseInt(count);

    if (!n || n < 1) return res.status(400).json({ error: 'Invalid count' });
    if (!['Dvd', 'Game'].includes(kind)) return res.status(400).json({ error: 'Invalid kind' });

    try {
        const items = await Item.find({ owner: req.user._id, kind })
            .sort({ added_at: -1, _id: -1 })
            .limit(n)
            .select('_id');

        const ids = items.map(i => i._id);
        const result = await Item.deleteMany({ _id: { $in: ids } });

        res.json({ deleted: result.deletedCount });
    } catch (err) {
        console.error("[ERR] delete-last-items:", err.message);
        res.status(500).json({ error: err.message });
    }
});

router.post('/refresh-all-dvds-metadata', requireAuth, requireAdmin, async (req, res) => {
    const { mode = 'all' } = req.body;
    const tmdbKey = process.env.TMDB_API_KEY;
    if (!tmdbKey) return res.status(500).json({ error: 'TMDB API key not configured' });

    try {
        let query = { tmdb_id: { $exists: true, $ne: null } };
        if (mode === 'missing') {
            query.$or = [
                { genre: { $exists: false } },
                { genre: '' },
                { genre: null },
                { genres: { $exists: false } },
                { genres: { $size: 0 } },
                { styles: { $exists: false } },
                { styles: { $size: 0 } }
            ];
        }

        const dvds = await Dvd.find(query).select('_id tmdb_id title director media_type genre genres');
        if (dvds.length === 0) return res.json({ success: true, count: 0 });

        res.status(202).json({ success: true, total: dvds.length });

        (async () => {
            const io = req.app.get('io');
            let current = 0;
            for (const dvd of dvds) {
                current++;
                try {
                    if (io) {
                        io.emit('refresh_all_progress', {
                            current,
                            total: dvds.length,
                            title: dvd.title
                        });
                    }

                    const type = dvd.media_type === 'tv' ? 'tv' : 'movie';
                    const response = await axios.get(`https://api.themoviedb.org/3/${type}/${dvd.tmdb_id}?api_key=${tmdbKey}&language=en-US`);

                    if (response.data) {
                        const genres = (response.data.genres || []).map(g => g.name);

                        const updateObj = {};
                        if (mode === 'all' || !dvd.genres || dvd.genres.length === 0) updateObj.genres = genres;
                        if (!dvd.genre || dvd.genre.trim() === '') {
                            updateObj.genre = genres[0] || '';
                        }

                        await Dvd.updateOne(
                            { _id: dvd._id },
                            { $set: updateObj }
                        );
                    }

                    await new Promise(r => setTimeout(r, 500));
                } catch (err) {
                    console.error(`[ERR] Refresh bulk dvd ${dvd.tmdb_id}:`, err.message);
                    await new Promise(r => setTimeout(r, 1000));
                }
            }
            if (io) io.emit('refresh_all_finished', { count: current });
        })();
    } catch (err) {
        console.error("[ERR] Bulk refresh dvds:", err.message);
        if (!res.headersSent) res.status(500).json({ error: err.message });
    }
});

router.post('/refresh-all-games-metadata', requireAuth, requireAdmin, async (req, res) => {
    const { mode = 'all' } = req.body;
    const clientId = process.env.TWITCH_CLIENT_ID;
    const clientSecret = process.env.TWITCH_CLIENT_SECRET;
    if (!clientId || !clientSecret) return res.status(500).json({ error: 'IGDB/Twitch credentials not configured' });

    try {
        let query = { igdb_id: { $exists: true, $ne: null } };
        if (mode === 'missing') {
            query.$or = [
                { genre: { $exists: false } },
                { genre: '' },
                { genre: null },
                { genres: { $exists: false } },
                { genres: { $size: 0 } }
            ];
        }

        const games = await Game.find(query).select('_id igdb_id title developer genre genres');
        if (games.length === 0) return res.json({ success: true, count: 0 });

        res.status(202).json({ success: true, total: games.length });

        (async () => {
            const io = req.app.get('io');
            let current = 0;
            for (const game of games) {
                current++;
                try {
                    if (io) {
                        io.emit('refresh_all_progress', {
                            current,
                            total: games.length,
                            title: game.title
                        });
                    }

                    const results = await igdbRequest('games',
                        `where id = ${game.igdb_id};
                        fields genres.name, cover.url, first_release_date;
                        limit 1;`
                    );

                    if (results && results.length > 0) {
                        const data = results[0];
                        const genres = (data.genres || []).map(g => g.name);

                        const updateObj = {};
                        if (mode === 'all' || !game.genres || game.genres.length === 0) updateObj.genres = genres;
                        if (!game.genre || game.genre.trim() === '') {
                            updateObj.genre = genres[0] || '';
                        }

                        let cover = '';
                        if (data.cover && data.cover.url) {
                            cover = data.cover.url.replace('t_thumb', 't_cover_big');
                            if (cover.startsWith('//')) cover = 'https:' + cover;
                            updateObj.cover_image = cover;
                        }

                        await Game.updateOne(
                            { _id: game._id },
                            { $set: updateObj }
                        );
                    }

                    // IGDB rate limit: 4 requests/second
                    await new Promise(r => setTimeout(r, 300));
                } catch (err) {
                    console.error(`[ERR] Refresh bulk game ${game.igdb_id}:`, err.message);
                    await new Promise(r => setTimeout(r, 1000));
                }
            }
            if (io) io.emit('refresh_all_finished', { count: current });
        })();
    } catch (err) {
        console.error("[ERR] Bulk refresh games:", err.message);
        if (!res.headersSent) res.status(500).json({ error: err.message });
    }
});

module.exports = router;
