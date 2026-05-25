const express = require('express');
const router = express.Router();
const axios = require('axios');
const https = require('https');

const Settings = require('../models/Settings');
const Item = require('../models/Item');
const Dvd = require('../models/Dvd');
const Game = require('../models/Game');

const { requireAuth } = require('../middleware/authMiddleware');
const PRESETS = require('../config/themes');
const { igdbRequest } = require('../utils/igdbHelper');

async function loadAdminData() {
    const pipeline = [
        {
            $project: {
                kind: 1,
                allGenres: {
                    $concatArrays: [
                        { $cond: [{ $in: ['$genre', ['', null]] }, [], ['$genre']] },
                        { $ifNull: ['$genres', []] },
                        { $ifNull: ['$styles', []] }
                    ]
                }
            }
        },
        { $unwind: '$allGenres' },
        { $group: { _id: '$kind', genres: { $addToSet: '$allGenres' } } }
    ];

    const genreGroupsRaw = await Item.aggregate(pipeline);
    const allGenres = {};
    genreGroupsRaw.forEach(g => {
        if (g._id && g.genres?.length > 0) allGenres[g._id] = g.genres.filter(Boolean).sort();
    });

    const visibilitySettings = await Settings.findOne().populate('visibility.hiddenItems').lean() || {};
    return { allGenres, visibilitySettings };
}

// Dashboard
router.get('/', requireAuth, async (req, res) => {
    try {
        const data = await loadAdminData();
        const msgKey = req.query.msg;
        const messageMap = {
            saved: 'Indstillinger gemt.',
            error_no_module: 'Aktivér mindst ét modul.'
        };
        res.render('admin', {
            ...data,
            user: res.locals.user,
            successMessage: msgKey ? (messageMap[msgKey] || null) : null,
            hasTmdbKey: !!process.env.TMDB_API_KEY,
            hasIgdbKey: !!(process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET)
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Intern serverfejl.');
    }
});

router.get('/personnalisation', requireAuth, async (req, res) => {
    res.render('personnalisation', { presets: PRESETS });
});

router.post('/personnalisation/save', requireAuth, async (req, res) => {
    try {
        const { homePreset, dvdPreset, gamesPreset, navbarShortcuts, statsWidgets } = req.body;

        const shortcuts = Array.isArray(navbarShortcuts) ? navbarShortcuts : (navbarShortcuts ? [navbarShortcuts] : []);
        const stats = Array.isArray(statsWidgets) ? statsWidgets : (statsWidgets ? [statsWidgets] : []);

        const validFastAdd = ['', 'dvd', 'game'];
        const fastAdd = validFastAdd.includes(req.body.fastAdd) ? req.body.fastAdd : '';

        await Settings.findOneAndUpdate({}, {
            $set: {
                'theme.home.preset': homePreset,
                'theme.dvd.preset': dvdPreset,
                'theme.games.preset': gamesPreset,
                'navbarShortcuts': shortcuts,
                'statsWidgets': stats,
                'fastAdd': fastAdd
            }
        }, { upsert: true });

        res.redirect('/admin/personnalisation?msg=saved');
    } catch (err) {
        console.error('[ERR] perso save', err);
        res.status(500).send('[ERR] perso save failed.');
    }
});

router.post('/modules/save', requireAuth, async (req, res) => {
    try {
        const { dvdActive, gamesActive } = req.body;
        if (!dvdActive && !gamesActive) return res.redirect('/admin?msg=error_no_module');
        await Settings.findOneAndUpdate({}, {
            $set: {
                'modules.dvd': dvdActive === 'on',
                'modules.games': gamesActive === 'on'
            }
        }, { upsert: true });
        res.redirect('/admin?msg=saved');
    } catch (err) {
        console.error('[ERR] modules save', err);
        res.status(500).send('[ERR] modules save failed.');
    }
});

router.post('/visibility/save', requireAuth, async (req, res) => {
    try {
        const { applyToAdmin, hiddenItems, hiddenGenres, hiddenTypes } = req.body;
        let parsedItems = [];
        if (hiddenItems) {
            try { parsedItems = JSON.parse(hiddenItems); } catch (e) { parsedItems = []; }
        }
        await Settings.findOneAndUpdate({}, {
            $set: {
                'visibility.applyToAdmin': applyToAdmin === 'on' || applyToAdmin === 'true' || applyToAdmin === true,
                'visibility.hiddenItems': parsedItems,
                'visibility.hiddenGenres': Array.isArray(hiddenGenres) ? hiddenGenres : (hiddenGenres ? [hiddenGenres] : []),
                'visibility.hiddenTypes': Array.isArray(hiddenTypes) ? hiddenTypes : (hiddenTypes ? [hiddenTypes] : [])
            }
        }, { upsert: true });
        res.redirect('/admin?msg=saved');
    } catch (err) {
        console.error('[ERR] visibility save', err);
        res.status(500).send('[ERR] visibility save failed.');
    }
});

router.get('/api/search-collection', requireAuth, async (req, res) => {
    try {
        const { q } = req.query;
        if (!q) return res.json([]);
        const regex = new RegExp(q, 'i');
        const items = await Item.find({
            $and: [
                { $or: [{ kind: 'Dvd' }, { kind: 'Game' }] },
                { $or: [{ title: regex }, { director: regex }] }
            ]
        }).limit(10).select('_id title director kind cover_image format format_type platform media_type').lean();
        res.json(items);
    } catch (err) {
        console.error('[ERR] search collection', err);
        res.status(500).json({ error: 'Search failed' });
    }
});

router.get('/api/search-image-universal', requireAuth, async (req, res) => {
    const { q, type } = req.query;
    const axiosConfig = {
        headers: { 'User-Agent': 'DVinylApp/3.0' },
        timeout: 10000,
        httpsAgent: new https.Agent({ family: 4, keepAlive: true })
    };

    try {
        if (type === 'game') {
            try {
                const igdbResults = await igdbRequest('games',
                    `search "${q.replace(/"/g, '\\"')}";
                    fields cover.url, artworks.url, screenshots.url;
                    limit 5;`
                );
                let urls = [];
                igdbResults.forEach(g => {
                    if (g.cover?.url) urls.push(g.cover.url);
                    if (g.artworks) g.artworks.forEach(a => urls.push(a.url));
                    if (g.screenshots) g.screenshots.forEach(s => urls.push(s.url));
                });
                urls = urls.map(u => {
                    let r = u.replace('t_thumb', 't_cover_big');
                    if (r.startsWith('//')) r = 'https:' + r;
                    return r;
                });
                const tmdbApiKey = process.env.TMDB_API_KEY;
                if (tmdbApiKey) {
                    const tmdbUrl = `https://api.themoviedb.org/3/search/multi?api_key=${tmdbApiKey}&query=${encodeURIComponent(q)}&language=en-US`;
                    const tmdbRes = await axios.get(tmdbUrl, axiosConfig);
                    const tmdbUrls = (tmdbRes.data.results || [])
                        .filter(i => i.poster_path)
                        .map(i => `https://image.tmdb.org/t/p/w500${i.poster_path}`);
                    urls = [...urls, ...tmdbUrls];
                }
                return res.json([...new Set(urls)]);
            } catch (err) {
                console.error('[ERR] Game image search failed:', err.message);
                return res.json([]);
            }
        }

        if (type === 'movie') {
            const tmdbApiKey = process.env.TMDB_API_KEY;
            if (!tmdbApiKey) return res.status(500).json({ error: 'Missing TMDB API Key' });
            const tmdbUrl = `https://api.themoviedb.org/3/search/multi?api_key=${tmdbApiKey}&query=${encodeURIComponent(q)}&language=en-US`;
            const response = await axios.get(tmdbUrl, axiosConfig);
            const results = (response.data.results || [])
                .filter(i => i.poster_path)
                .map(i => `https://image.tmdb.org/t/p/w500${i.poster_path}`);
            return res.json(results);
        }

        return res.json([]);
    } catch (err) {
        console.error('[ERR] search image universal:', err.message);
        res.status(500).json({ error: '[ERR] connexion error' });
    }
});

router.post('/delete-last-items', requireAuth, async (req, res) => {
    const { count, kind } = req.body;
    const n = parseInt(count);
    if (!n || n < 1) return res.status(400).json({ error: 'Invalid count' });
    if (!['Dvd', 'Game'].includes(kind)) return res.status(400).json({ error: 'Invalid kind' });
    try {
        const items = await Item.find({ kind }).sort({ added_at: -1, _id: -1 }).limit(n).select('_id');
        const ids = items.map(i => i._id);
        const result = await Item.deleteMany({ _id: { $in: ids } });
        res.json({ deleted: result.deletedCount });
    } catch (err) {
        console.error('[ERR] delete-last-items:', err.message);
        res.status(500).json({ error: err.message });
    }
});

router.post('/refresh-all-dvds-metadata', requireAuth, async (req, res) => {
    const { mode = 'all' } = req.body;
    const tmdbKey = process.env.TMDB_API_KEY;
    if (!tmdbKey) return res.status(500).json({ error: 'TMDB API key not configured' });

    try {
        let query = { tmdb_id: { $exists: true, $ne: null } };
        if (mode === 'missing') {
            query.$or = [
                { genre: { $exists: false } }, { genre: '' }, { genre: null },
                { genres: { $exists: false } }, { genres: { $size: 0 } },
                { styles: { $exists: false } }, { styles: { $size: 0 } }
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
                    if (io) io.emit('refresh_all_progress', { current, total: dvds.length, title: dvd.title });
                    const type = dvd.media_type === 'tv' ? 'tv' : 'movie';
                    const response = await axios.get(`https://api.themoviedb.org/3/${type}/${dvd.tmdb_id}?api_key=${tmdbKey}&language=en-US`);
                    if (response.data) {
                        const genres = (response.data.genres || []).map(g => g.name);
                        const updateObj = {};
                        if (mode === 'all' || !dvd.genres || dvd.genres.length === 0) updateObj.genres = genres;
                        if (!dvd.genre || dvd.genre.trim() === '') updateObj.genre = genres[0] || '';
                        await Dvd.updateOne({ _id: dvd._id }, { $set: updateObj });
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
        console.error('[ERR] Bulk refresh dvds:', err.message);
        if (!res.headersSent) res.status(500).json({ error: err.message });
    }
});

router.post('/refresh-all-games-metadata', requireAuth, async (req, res) => {
    const { mode = 'all' } = req.body;
    const clientId = process.env.TWITCH_CLIENT_ID;
    const clientSecret = process.env.TWITCH_CLIENT_SECRET;
    if (!clientId || !clientSecret) return res.status(500).json({ error: 'IGDB/Twitch credentials not configured' });

    try {
        let query = { igdb_id: { $exists: true, $ne: null } };
        if (mode === 'missing') {
            query.$or = [
                { genre: { $exists: false } }, { genre: '' }, { genre: null },
                { genres: { $exists: false } }, { genres: { $size: 0 } }
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
                    if (io) io.emit('refresh_all_progress', { current, total: games.length, title: game.title });
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
                        if (!game.genre || game.genre.trim() === '') updateObj.genre = genres[0] || '';
                        if (data.cover?.url) {
                            let cover = data.cover.url.replace('t_thumb', 't_cover_big');
                            if (cover.startsWith('//')) cover = 'https:' + cover;
                            updateObj.cover_image = cover;
                        }
                        await Game.updateOne({ _id: game._id }, { $set: updateObj });
                    }
                    await new Promise(r => setTimeout(r, 300));
                } catch (err) {
                    console.error(`[ERR] Refresh bulk game ${game.igdb_id}:`, err.message);
                    await new Promise(r => setTimeout(r, 1000));
                }
            }
            if (io) io.emit('refresh_all_finished', { count: current });
        })();
    } catch (err) {
        console.error('[ERR] Bulk refresh games:', err.message);
        if (!res.headersSent) res.status(500).json({ error: err.message });
    }
});

module.exports = router;
