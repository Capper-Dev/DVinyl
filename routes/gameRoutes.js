const express = require('express');
const router = express.Router();
const Game = require('../models/Game');
const Item = require('../models/Item');
const Collection = require('../models/Collection');
const { requireAuth } = require('../middleware/authMiddleware');
const { igdbRequest } = require('../utils/igdbHelper');
const { lookupGameBarcode, saveManualGameMatch } = require('../utils/gameBarcodeLookup');

/**
 * Format an IGDB game result for display in search results.
 */
const formatIGDBResult = (game) => {
    let cover = '/ressources/no_file.png';
    if (game.cover && game.cover.url) {
        cover = game.cover.url.replace('t_thumb', 't_cover_big');
        if (cover.startsWith('//')) cover = 'https:' + cover;
    }

    const platforms = (game.platforms || []).map(p => p.name).join(', ');

    let year = '';
    if (game.first_release_date) {
        year = new Date(game.first_release_date * 1000).getFullYear().toString();
    }

    let developer = '';
    let publisher = '';
    if (game.involved_companies) {
        const devCompany = game.involved_companies.find(ic => ic.developer);
        const pubCompany = game.involved_companies.find(ic => ic.publisher);
        if (devCompany && devCompany.company) developer = devCompany.company.name;
        if (pubCompany && pubCompany.company) publisher = pubCompany.company.name;
    }

    return {
        igdb_id: game.id,
        title: game.name || 'Unknown',
        year,
        cover_image: cover,
        platforms_text: platforms,
        platforms: (game.platforms || []).map(p => ({ id: p.id, name: p.name })),
        developer,
        publisher,
        genres: (game.genres || []).map(g => g.name),
        summary: game.summary || ''
    };
};

// ─── ADD GAME (search page) ─────────────────────────────────
router.get('/add-game', requireAuth, (req, res) => {
    res.render('add-game', { results: null, user: res.locals.user, currentType: 'add-game' });
});

// ─── SEARCH GAMES (IGDB) ────────────────────────────────────
router.post('/search-games', requireAuth, async (req, res) => {
    const query = req.body.query.trim();
    const cleanQuery = query.replace(/[- ]/g, '');
    const isBarcode = /^\d{12,13}$/.test(cleanQuery);

    try {
        if (isBarcode) {
            const result = await lookupGameBarcode(cleanQuery);

            if (result.status === 'found') {
                return res.redirect(`/confirm-game/${result.igdb_id}?barcode=${result.ean}`);
            }

            return res.render('add-game', {
                results: null,
                scanned_barcode: cleanQuery,
                barcode_no_results: true,
                barcode_error: result.status === 'error',
                user: res.locals.user,
                currentType: 'add-game'
            });
        }

        const results = await igdbRequest('games',
            `search "${query.replace(/"/g, '\\"')}";
            fields name, cover.url, platforms.name, first_release_date,
                   involved_companies.company.name, involved_companies.developer, involved_companies.publisher,
                   genres.name, summary;
            limit 24;`
        );

        res.render('add-game', {
            results: results.map(formatIGDBResult),
            scanned_barcode: '',
            user: res.locals.user,
            currentType: 'add-game'
        });

    } catch (err) {
        console.error("[ERR] Game search:", err.message);
        res.render('add-game', { results: [], scanned_barcode: '', error: 'Kunne ikke forbinde til IGDB.', user: res.locals.user, currentType: 'add-game' });
    }
});

// ─── CONFIRM GAME ────────────────────────────────────────────
router.get('/confirm-game/:igdb_id', requireAuth, async (req, res) => {
    const igdbId = req.params.igdb_id;

    try {
        const results = await igdbRequest('games',
            `where id = ${igdbId};
            fields name, cover.url, platforms.name, platforms.id, first_release_date,
                   involved_companies.company.name, involved_companies.developer, involved_companies.publisher,
                   genres.name, summary;
            limit 1;`
        );

        if (!results || results.length === 0) {
            return res.status(404).send('Intern serverfejl.');
        }

        const gameData = formatIGDBResult(results[0]);

        const locations = await Item.distinct('location', { location: { $ne: "" } });
        const genres = await Item.distinct('genre', { genre: { $ne: "" }, kind: 'Game' });
        const collections = await Collection.find({ type: 'game' }).sort({ createdAt: 1 }).lean();

        res.render('confirm-game', {
            game: gameData,
            scanned_barcode: req.query.barcode || '',
            user: res.locals.user,
            locations,
            genres,
            collections,
            currentType: 'games'
        });
    } catch (err) {
        console.error("[ERR] Game detail:", err);
        res.status(500).send('Intern serverfejl.');
    }
});

// ─── SAVE GAME ───────────────────────────────────────────────
router.post('/save-game', requireAuth, async (req, res) => {
    try {
        const {
            mongo_id, title, developer, publisher, platform, year,
            igdb_id, format, region, barcode, barcode_locked,
            cover_image, comments, location, genre, genres, styles,
            playStatus, user_rating, quantity, collection_id
        } = req.body;

        const parsedGenres = Array.isArray(genres) ? genres : (genres ? genres.split(',').map(g => g.trim()).filter(Boolean) : []);
        const parsedStyles = Array.isArray(styles) ? styles : (styles ? styles.split(',').map(s => s.trim()).filter(Boolean) : []);

        let game;

        if (mongo_id) {
            game = await Item.findById(mongo_id);
        }

        if (game) {
            game.title = title;
            game.developer = developer;
            game.publisher = publisher;
            game.platform = platform;
            game.year = year;
            game.format = format;
            game.region = region || '';
            game.barcode = barcode;
            game.barcode_locked = barcode_locked === 'on';
            game.cover_image = cover_image;
            game.comments = comments || '';
            game.location = location || '';
            game.genre = genre || (parsedGenres.length > 0 ? parsedGenres[0] : '');
            game.genres = parsedGenres;
            game.styles = parsedStyles;
            game.playStatus = playStatus || 'to_play';
            game.user_rating = user_rating || 0;
            game.quantity = quantity || 1;
            game.collection = collection_id || null;

            await game.save();
        } else {
            await Game.create({
                title, developer, publisher, platform, year,
                igdb_id, format, region: region || '', barcode,
                barcode_locked: barcode_locked === 'on',
                cover_image,
                kind: 'Game',
                comments: comments || '',
                location: location || '',
                genre: genre || (parsedGenres.length > 0 ? parsedGenres[0] : ''),
                genres: parsedGenres,
                styles: parsedStyles,
                playStatus: playStatus || 'to_play',
                user_rating: user_rating || 0,
                quantity: quantity || 1,
                collection: collection_id || null,
            });
        }

        const ean = req.body.barcode;
        if (ean && /^\d{12,13}$/.test(ean.replace(/[- ]/g, ''))) {
            saveManualGameMatch(ean, {
                igdb_id: req.body.igdb_id,
                title: req.body.title,
                year: req.body.year,
                cover_image: req.body.cover_image
            }).catch(err => console.error('[ERR] game cache save on confirm:', err));
        }

        res.redirect(`/collection?type=games`);

    } catch (err) {
        console.error("[ERR] Game save:", err);
        res.status(500).send('Intern serverfejl.');
    }
});

// ─── EDIT GAME ───────────────────────────────────────────────
router.get('/game/edit/:id', requireAuth, async (req, res) => {
    try {
        const game = await Item.findById(req.params.id);
        if (!game || game.kind !== 'Game') {
            return res.redirect('/collection?type=games');
        }

        const locations = await Item.distinct('location', { location: { $ne: "" } });
        const genres = await Item.distinct('genre', { genre: { $ne: "" }, kind: 'Game' });
        const collections = await Collection.find({ type: 'game' }).sort({ createdAt: 1 }).lean();

        res.render('edit-game', { game: game.toObject(), user: res.locals.user, locations, genres, collections, currentType: 'games' });
    } catch (err) {
        console.error(err);
        res.redirect('/collection?type=games');
    }
});

// ─── GAME DETAIL ─────────────────────────────────────────────
router.get('/game/:id', requireAuth, async (req, res) => {
    try {
        const game = await Item.findById(req.params.id);
        if (!game || game.kind !== 'Game') return res.redirect('/collection?type=games');

        res.render('game-detail', { game: game.toObject(), user: res.locals.user, currentType: 'game' });
    } catch (err) {
        res.redirect('/collection?type=games');
    }
});

// ─── DELETE GAME ─────────────────────────────────────────────
router.delete('/api/game/:id', requireAuth, async (req, res) => {
    try {
        const game = await Item.findOne({ _id: req.params.id, owner: res.locals.user._id });

        if (!game) {
            return res.status(404).json({ error: "Game not found or you are not the owner." });
        }

        await Item.deleteOne({ _id: req.params.id });
        res.json({ success: true, redirectUrl: `/collection?type=games` });

    } catch (err) {
        console.error(err);
        res.status(500).send('Intern serverfejl.');
    }
});

// ─── REFRESH GAME INFO ───────────────────────────────────────
router.post('/api/game/:id/refresh-info', requireAuth, async (req, res) => {
    try {
        const game = await Game.findById(req.params.id);
        if (!game) return res.status(404).json({ success: false, error: 'Game not found' });

        if (!game.igdb_id) {
            return res.status(400).json({ success: false, error: 'No IGDB ID to refresh' });
        }

        const results = await igdbRequest('games',
            `where id = ${game.igdb_id};
            fields name, cover.url, first_release_date, genres.name, summary,
                   involved_companies.company.name, involved_companies.developer, involved_companies.publisher;
            limit 1;`
        );

        if (!results || results.length === 0) {
            return res.status(404).json({ success: false, error: 'Not found on IGDB API' });
        }

        const formatted = formatIGDBResult(results[0]);
        const genres = formatted.genres || [];

        await Game.updateOne(
            { _id: game._id },
            {
                $set: {
                    cover_image: formatted.cover_image,
                    genres: genres,
                    genre: genres[0] || '',
                    year: formatted.year,
                    developer: formatted.developer || game.developer,
                    publisher: formatted.publisher || game.publisher
                }
            }
        );

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

module.exports = router;
