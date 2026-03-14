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
    return { users, blockedIps, logs };
}

// DASHBOARD (GET)
router.get('/', requireAuth, requireAdmin, async (req, res) => {
    try {
        const data = await loadAdminData();

        // Read optional message key from query and translate in the view.
        const msgKey = req.query.msg;

        res.render('admin', {
            ...data,
            user: res.locals.user,
            successMessage: msgKey ? req.t(`messages.${msgKey}`) : null,
            newPassword: null, 
            hasHardcoverKey: !!process.env.HARDCOVER_API_KEY,
            hasTmdbKey: !!process.env.TMDB_API_KEY
        });
    } catch (err) {
        console.error(err);
        res.status(500).send(req.t('errors.generic_server_error'));
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
                successMessage: req.t('messages.password_reset_success', { name: userToUpdate.username }),
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
            homePreset, musicPreset, booksPreset, dvdPreset,
            navbarShortcuts, statsWidgets 
        } = req.body;

        const shortcuts = Array.isArray(navbarShortcuts) ? navbarShortcuts : (navbarShortcuts ? [navbarShortcuts] : []);        
        const stats = Array.isArray(statsWidgets) ? statsWidgets : (statsWidgets ? [statsWidgets] : []);
        
        const validFastAdd = ['', 'vinyl', 'cd', 'cassette', 'book', 'dvd'];
        const fastAdd = validFastAdd.includes(req.body.fastAdd) ? req.body.fastAdd : '';
        
        const update = {
            'theme.home.preset':  homePreset,
            'theme.music.preset': musicPreset,
            'theme.books.preset': booksPreset,
            'theme.dvd.preset':   dvdPreset,
            'navbarShortcuts':    shortcuts,
            'statsWidgets':       stats,
            'fastAdd':           fastAdd
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
        const { musicActive, booksActive, dvdActive, advancedCDActive } = req.body;

        if (!musicActive && !booksActive && !dvdActive) {
            return res.redirect('/admin?msg=error_no_module');
        }

        const update = {
            'modules.music': musicActive === 'on',
            'modules.books': booksActive === 'on',
            'modules.dvd':   dvdActive === 'on',
            'modules.advancedCD': advancedCDActive === 'on'
        };

        await Settings.findOneAndUpdate({}, { $set: update }, { upsert: true });
        
        res.redirect('/admin?msg=saved');
    } catch (err) {
        console.error("[ERR] modules save", err);
        res.status(500).send("[ERR] modules save failed.");
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
        if (type === 'book') {
            const response = await axios.get(`https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=10`, axiosConfig);
            const results = (response.data.docs || [])
                .filter(doc => doc.cover_i)
                .map(doc => `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`);
            
            return res.json(results);
        }

        if (type === 'movie') {
            const tmdbApiKey = process.env.TMDB_API_KEY;
            if (!tmdbApiKey) {
                console.error("[ERR] TMDB_API_KEY missing");
                return res.status(500).json({ error: "Missing TMDB API Key" });
            }

            const tmdbUrl = `https://api.themoviedb.org/3/search/multi?api_key=${tmdbApiKey}&query=${encodeURIComponent(q)}&language=fr-FR`;
            const response = await axios.get(tmdbUrl, axiosConfig);
            
            const results = (response.data.results || [])
                .filter(item => item.poster_path)
                .map(item => `https://image.tmdb.org/t/p/w500${item.poster_path}`);

            console.log(`[SEARCH] TMDB found: ${results.length} posters`);
            return res.json(results);
        }

        const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=album&limit=12`;
        const response = await axios.get(itunesUrl, axiosConfig);
        
        const results = (response.data.results || []).map(item => {
            return item.artworkUrl100.replace('100x100bb.jpg', '600x600bb.jpg');
        });
        
        console.log(`[SEARCH] iTunes found: ${results.length}`);
        res.json(results);

    } catch (err) {
        console.error("[ERR] search image universal:", err.message);
        res.status(500).json({ error: "[ERR] connexion error" });
    }
});


router.get('/api/search-discogs-gallery', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { q } = req.query;
        const axiosConfig = {
            headers: { 
                'User-Agent': 'DVinylApp/2.0',
                'Authorization': `Discogs token=${process.env.DISCOGS_TOKEN || ''}`
            }
        };

        const searchRes = await axios.get(`https://api.discogs.com/database/search?q=${encodeURIComponent(q)}&type=release&per_page=3`, axiosConfig);
        const results = searchRes.data.results || [];
        const galleryPromises = results.map(async (item) => {
            try {
                const detail = await axios.get(`https://api.discogs.com/releases/${item.id}`, axiosConfig);
                return (detail.data.images || []).map(img => img.resource_url);
            } catch (e) { return []; }
        });

        const allGalleries = await Promise.all(galleryPromises);
        
        const finalImages = [...new Set(allGalleries.flat())];
        
        res.json(finalImages);
    } catch (err) {
        console.error("[ERR] Discogs Global Gallery:", err.message);
        res.status(500).json({ error: "ERROR Discogs search" });
    }
});


router.post('/delete-last-items', requireAuth, requireAdmin, async (req, res) => {
    const { count, kind } = req.body;
    const n = parseInt(count);

    if (!n || n < 1) return res.status(400).json({ error: 'Invalid count' });
    if (!['Book', 'Music', 'Dvd'].includes(kind)) return res.status(400).json({ error: 'Invalid kind' });

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

module.exports = router;