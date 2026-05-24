const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const Item = require('../models/Item');
const Collection = require('../models/Collection');
const User = require('../models/User');

const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');
const { applyVisibilityFilter } = require('../utils/visibilityHelper');

async function getAdminId() {
    const admin = await User.findOne({ isAdmin: true }).select('_id');
    return admin ? admin._id : null;
}

const formatForView = (item) => {
    if (!item) return null;
    const obj = item.toObject ? item.toObject() : item;

    return {
        ...obj,
        artist: obj.director || obj.developer || obj.publisher || '',
        media_type: obj.media_type || obj.format || '',
        cover_image: obj.cover_image || '',
        user_image: obj.user_image || '',
        label: obj.studio || obj.publisher || '',
        director: obj.director || '',
        developer: obj.developer || '',
        publisher: obj.publisher || '',
        studio: obj.studio || '',
        year: obj.year || '',
        format_type: obj.format_type || '',
        location: obj.location || '',
        genre: obj.genre || '',
        quantity: obj.quantity || 1,
        country: obj.country || ''
    };
};

// Dashboard: collection summary
router.get('/', requireAuth, async (req, res) => {
    try {
        const adminId = await getAdminId();
        const settings = res.locals.settings;
        let queryAll = { owner: adminId, in_wishlist: false };
        applyVisibilityFilter(queryAll, res.locals.isAdmin, settings);
        const allItems = await Item.find(queryAll).lean();

        const stats = {
            total: allItems.reduce((acc, i) => acc + (i.quantity || 1), 0),

            dvd_total: allItems.filter(i => i.kind === 'Dvd').reduce((acc, i) => acc + (i.quantity || 1), 0),
            dvd_dvd: allItems.filter(i => i.kind === 'Dvd' && i.format === 'dvd').reduce((acc, i) => acc + (i.quantity || 1), 0),
            dvd_bluray: allItems.filter(i => i.kind === 'Dvd' && i.format === 'bluray').reduce((acc, i) => acc + (i.quantity || 1), 0),
            dvd_4k: allItems.filter(i => i.kind === 'Dvd' && i.format === '4k').reduce((acc, i) => acc + (i.quantity || 1), 0),

            game_total: allItems.filter(i => i.kind === 'Game').reduce((acc, i) => acc + (i.quantity || 1), 0),
            game_physical: allItems.filter(i => i.kind === 'Game' && i.format === 'physical').reduce((acc, i) => acc + (i.quantity || 1), 0),
            game_collector: allItems.filter(i => i.kind === 'Game' && i.format === 'collector').reduce((acc, i) => acc + (i.quantity || 1), 0),
            game_limited: allItems.filter(i => i.kind === 'Game' && i.format === 'limited').reduce((acc, i) => acc + (i.quantity || 1), 0),
            game_steelbook: allItems.filter(i => i.kind === 'Game' && i.format === 'steelbook').reduce((acc, i) => acc + (i.quantity || 1), 0)
        };

        const getTop = (items, field) => {
            const map = {};
            items.forEach(i => {
                const value = i[field];
                if (value && typeof value === 'string') {
                    map[value] = (map[value] || 0) + (i.quantity || 1);
                }
            });
            let topName = 'N/A';
            let topCount = 0;
            Object.keys(map).forEach(name => {
                if (map[name] > topCount) {
                    topCount = map[name];
                    topName = name;
                }
            });
            return { name: topName, count: topCount };
        };

        stats.director = getTop(allItems.filter(i => i.kind === 'Dvd'), 'director');
        stats.studio = getTop(allItems.filter(i => i.kind === 'Dvd'), 'studio');
        stats.game_developer = getTop(allItems.filter(i => i.kind === 'Game'), 'developer');
        stats.game_publisher = getTop(allItems.filter(i => i.kind === 'Game'), 'publisher');

        const recentItems = await Item.find(queryAll)
            .sort({ added_at: -1 })
            .limit(6)
            .lean();

        res.render('index', {
            stats,
            recentItems: recentItems.map(formatForView),
            user: res.locals.user
        });
    } catch (err) {
        console.error("Dashboard error:", err);
        res.status(500).send('Intern serverfejl.');
    }
});

// Collection view
router.get('/collection', requireAuth, async (req, res) => {
    try {
        const adminId = await getAdminId();
        const { search, type, format, location, genre, sort, artist, decade } = req.query;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 25;

        let query = { owner: adminId, in_wishlist: false };
        let conditions = [];

        if (search) {
            const regex = new RegExp(search, 'i');
            conditions.push({
                $or: [{ title: regex }, { director: regex }, { developer: regex }]
            });
        }

        if (type && type !== 'all') {
            const typeMap = { dvd: 'Dvd', games: 'Game' };
            if (typeMap[type]) query.kind = typeMap[type];
        }

        if (format && format !== 'all') {
            const formatRegex = new RegExp(`^${format}$`, 'i');
            conditions.push({
                $or: [{ media_type: formatRegex }, { format: formatRegex }]
            });
        }

        if (location) {
            conditions.push({ location: new RegExp(location, 'i') });
        }

        if (artist) {
            const artistRegex = new RegExp(artist, 'i');
            conditions.push({
                $or: [
                    { director: artistRegex },
                    { developer: artistRegex },
                    { publisher: artistRegex },
                    { studio: artistRegex }
                ]
            });
        }

        if (genre) {
            const genreArr = genre.split(',').map(g => g.trim()).filter(Boolean);
            if (genreArr.length > 0) {
                conditions.push({
                    $or: [
                        { genre: { $in: genreArr.map(g => new RegExp(g, 'i')) } },
                        { genres: { $in: genreArr.map(g => new RegExp(g, 'i')) } },
                        { styles: { $in: genreArr.map(g => new RegExp(g, 'i')) } }
                    ]
                });
            }
        }

        if (decade) {
            const decadeArr = decade.split(',').map(d => parseInt(d)).filter(d => !isNaN(d));
            if (decadeArr.length > 0) {
                const years = [];
                decadeArr.forEach(startYear => {
                    for (let y = startYear; y < startYear + 10; y++) {
                        years.push(new RegExp(`^${y}$`));
                    }
                });
                conditions.push({ year: { $in: years } });
            }
        }

        const typeToCollectionType = { dvd: 'dvd', games: 'game' };
        const collectionType = typeToCollectionType[type];
        let collectionsForType = [];
        let activeCollectionId = req.query.collection || null;

        if (collectionType) {
            collectionsForType = await Collection.find({ type: collectionType }).sort({ createdAt: 1 }).lean();
        }

        if (activeCollectionId === 'uncategorized') {
            query.collection = null;
        } else if (activeCollectionId && mongoose.isValidObjectId(activeCollectionId)) {
            query.collection = activeCollectionId;
        }

        const filterMode = req.query.filterMode || 'show';
        if (filterMode === 'hide' && conditions.length > 0) {
            query.$and = [{ $nor: [{ $and: conditions }] }];
        } else if (conditions.length > 0) {
            query.$and = conditions;
        }

        applyVisibilityFilter(query, res.locals.isAdmin, res.locals.settings);

        const totalItems = await Item.countDocuments(query);

        const buildSortObj = () => {
            const sortMap = {
                'added_desc': { added_at: -1 },
                'added_asc': { added_at: 1 },
                'title_asc': { title: 1 },
                'title_desc': { title: -1 },
                'year_desc': { year: -1 },
                'year_asc': { year: 1 },
            };

            if (sort && sort.startsWith('artist')) {
                const dir = sort === 'artist_asc' ? 1 : -1;
                if (!type || type === 'all') return { title: dir };
                const fieldMap = { dvd: 'director', games: 'developer' };
                const field = fieldMap[type] || 'title';
                return { [field]: dir };
            }

            return sortMap[sort] || { added_at: -1 };
        };

        const albums = await Item.find(query)
            .sort(buildSortObj())
            .skip((page - 1) * limit)
            .limit(limit)
            .lean();

        const filterMap = {
            dvd: [
                { id: 'dvd', label: 'DVD' },
                { id: 'bluray', label: 'Blu-ray' },
                { id: '4k', label: '4K Ultra HD' }
            ],
            games: [
                { id: 'physical', label: 'Fysisk' },
                { id: 'collector', label: 'Samler' },
                { id: 'limited', label: 'Begrænset udgave' },
                { id: 'steelbook', label: 'Steelbook' }
            ]
        };

        const artistList = await (async () => {
            const baseQuery = { owner: adminId, in_wishlist: false, $or: [{ kind: 'Dvd' }, { kind: 'Game' }] };
            if (!type || type === 'all') {
                const [directors, developers] = await Promise.all([
                    Item.distinct('director', { ...baseQuery, director: { $nin: ['', null] } }),
                    Item.distinct('developer', { ...baseQuery, developer: { $nin: ['', null] } })
                ]);
                return [...new Set([...directors, ...developers])].filter(Boolean).sort();
            }
            const fieldMap = { dvd: 'director', games: 'developer' };
            const field = fieldMap[type];
            if (!field) return [];
            const kind = { dvd: 'Dvd', games: 'Game' }[type];
            return (await Item.distinct(field, { owner: adminId, in_wishlist: false, kind, [field]: { $nin: ['', null] } })).sort();
        })();

        res.render('collection', {
            albums: albums.map(formatForView),
            totalItems,
            totalPages: Math.ceil(totalItems / limit),
            currentPage: page,
            queryLimit: limit,
            currentType: type || 'all',
            currentFormat: format || 'all',
            querySearch: search || '',
            queryLocation: location || '',
            queryGenre: genre || '',
            queryArtist: artist || '',
            queryDecade: decade || '',
            queryFilterMode: filterMode,
            currentSort: sort || 'added_desc',

            activeFilters: filterMap[type] || [],
            artistList,
            locations: await Item.distinct('location', { owner: adminId, $or: [{ kind: 'Dvd' }, { kind: 'Game' }] }),
            genres: await (async () => {
                if (!type || type === 'all') return [];
                const kind = { dvd: 'Dvd', games: 'Game' }[type];
                if (!kind) return [];
                const typeQuery = { kind };

                const [gBase, gArray, sArray] = await Promise.all([
                    Item.distinct('genre', { owner: adminId, ...typeQuery, genre: { $nin: ['', null] } }),
                    Item.distinct('genres', { owner: adminId, ...typeQuery }),
                    Item.distinct('styles', { owner: adminId, ...typeQuery })
                ]);
                return [...new Set([...gBase, ...gArray, ...sArray])].filter(Boolean).sort();
            })(),
            standardFormatTerms: [],
            collectionsForType,
            activeCollectionId,
        });

    } catch (err) {
        console.error(err);
        res.status(500).send('Intern serverfejl.');
    }
});

// Move an item from wishlist to collection
router.post('/api/album/:id/move-to-collection', requireAuth, requireAdmin, async (req, res) => {
    try {
        await Item.findByIdAndUpdate(req.params.id, { in_wishlist: false, added_at: new Date() });
        res.json({ success: true });
    } catch (err) {
        res.status(500).send('Intern serverfejl.');
    }
});

// Wishlist
router.get('/wishlist', requireAuth, async (req, res) => {
    try {
        const adminId = await getAdminId();
        let query = {
            owner: adminId,
            in_wishlist: true
        };
        applyVisibilityFilter(query, res.locals.isAdmin, res.locals.settings);

        const items = await Item.find(query).sort({ added_at: -1 });

        res.render('wishlist', {
            albums: items.map(formatForView),
            user: res.locals.user
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Intern serverfejl.');
    }
});

module.exports = router;
