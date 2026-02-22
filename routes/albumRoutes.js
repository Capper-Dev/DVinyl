const express = require('express');
const router = express.Router();
const axios = require('axios');
const Album = require('../models/Vinyl');

const Item = require('../models/Item');
const Vinyl = require('../models/Vinyl');

const { requireAuth, requireAdmin } = require('../middleware/authMiddleware'); // Protect routes
const User = require('../models/User');

async function getAdminId() {
    const admin = await User.findOne({ isAdmin: true }).select('_id');
    return admin ? admin._id : null;
}

const formatForView = (item) => {
    if (!item) return null;
    const obj = item.toObject ? item.toObject() : item;

    return {
        ...obj,
        artist: obj.artist || obj.creator || obj.author || obj.director || 'Inconnu',
        media_type: obj.media_type || obj.format || 'other',
        cover_image: obj.cover_image || obj.coverUrl || '/ressources/logo.png',        
        tracklist: obj.tracklist || [],
        label: obj.label || obj.publisher || obj.studio || '',
        year: obj.year || '',
        format_type: obj.format_type || '',
        variant_color: obj.variant_color || '',
        location: obj.location || '',
        quantity: obj.quantity || 1,
        country: obj.country || ''
    };
};

// routes/albumRoutes.js
// Dashboard: view collection summary
router.get('/', requireAuth, async (req, res) => {
    try {
        const adminId = await getAdminId();
        const settings = res.locals.settings;
        const allItems = await Item.find({ owner: adminId, in_wishlist: false }).lean();
        
        const countByFormat = (items, format) => {
            return items
                .filter(i => {
                    const f = (i.media_type || i.format || '').toLowerCase();
                    return f === format.toLowerCase();
                })
                .reduce((acc, i) => acc + Number(i.quantity || 1), 0);
        };

        const stats = {
            total: allItems.reduce((acc, i) => acc + (i.quantity || 1), 0),

            vinyl: countByFormat(allItems, 'vinyl'),
            cd: countByFormat(allItems, 'cd'),
            cassette: countByFormat(allItems, 'cassette'),

            book_total: allItems.filter(i => i.kind === 'Book').reduce((acc, i) => acc + (i.quantity || 1), 0),
            book_hardcover: allItems.filter(i => i.kind === 'Book' && i.format === 'hardcover').reduce((acc, i) => acc + (i.quantity || 1), 0),
            book_paperback: allItems.filter(i => i.kind === 'Book' && i.format === 'paperback').reduce((acc, i) => acc + (i.quantity || 1), 0),
            book_manga: allItems.filter(i => i.kind === 'Book' && i.format === 'manga').reduce((acc, i) => acc + (i.quantity || 1), 0),
            book_comic: allItems.filter(i => i.kind === 'Book' && i.format === 'comic').reduce((acc, i) => acc + (i.quantity || 1), 0),

            dvd_total: allItems.filter(i => i.kind === 'Dvd').reduce((acc, i) => acc + (i.quantity || 1), 0),
            dvd_dvd: allItems.filter(i => i.kind === 'Dvd' && i.format === 'dvd').reduce((acc, i) => acc + (i.quantity || 1), 0),
            dvd_bluray: allItems.filter(i => i.kind === 'Dvd' && i.format === 'bluray').reduce((acc, i) => acc + (i.quantity || 1), 0),
            dvd_4k: allItems.filter(i => i.kind === 'Dvd' && i.format === '4k').reduce((acc, i) => acc + (i.quantity || 1), 0),
            dvd_vhs: allItems.filter(i => i.kind === 'Dvd' && i.format === 'vhs').reduce((acc, i) => acc + (i.quantity || 1), 0),
            dvd_laserdisc: allItems.filter(i => i.kind === 'Dvd' && i.format === 'laserdisc').reduce((acc, i) => acc + (i.quantity || 1), 0)
        };

        const getTop = (items, field) => {
            const map = {};
            let topName = req.t('common.not_available');
            let topCount = 0;
            items.forEach(item => {
                const name = item[field];
                if (name) {
                    map[name] = (map[name] || 0) + 1;
                    if (map[name] > topCount) { 
                        topCount = map[name]; 
                        topName = name; 
                    }
                }
            });
            return { name: topName, count: topCount };
        };

        stats.artist = getTop(allItems.filter(i => i.kind === 'Music' || (!i.kind && i.artist)), 'artist');
        stats.author = getTop(allItems.filter(i => i.kind === 'Book'), 'author');
        stats.director = getTop(allItems.filter(i => i.kind === 'Dvd'), 'director');

        res.render('index', { 
            latestCollection: (await Item.find({ owner: adminId, in_wishlist: false }).sort({ added_at: -1 }).limit(4)).map(formatForView),
            latestWishlist: (await Item.find({ owner: adminId, in_wishlist: true }).sort({ added_at: -1 }).limit(4)).map(formatForView),
            stats,
            settings 
        });
    } catch (err) {
        console.error("Dashboard error:", err);
        res.status(500).send(req.t('errors.generic_server_error'));
    }
});

router.get('/collection', requireAuth, async (req, res) => {
    try {
        const adminId = await getAdminId();
        const { search, type, format, location } = req.query;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 25;

        let query = { owner: adminId, in_wishlist: false };
        let conditions = []; 

        
        if (search) {
            const regex = new RegExp(search, 'i');
            conditions.push({ 
                $or: [{ title: regex }, { artist: regex }, { author: regex }, { director: regex }] 
            });
        }

        
        if (type && type !== 'all') {
            const typeMap = { music: 'Music', books: 'Book', dvd: 'Dvd' };
            if (type === 'music') {
                
                conditions.push({ 
                    $or: [{ kind: 'Music' }, { kind: { $exists: false } }] 
                });
            } else {
                query.kind = typeMap[type];
            }
        }

        
        if (format && format !== 'all') {
            
            const formatRegex = new RegExp(`^${format}$`, 'i');
            conditions.push({ 
                $or: [{ media_type: formatRegex }, { format: formatRegex }] 
            });
        }

        if (location) {
            query.location = new RegExp(location, 'i');
        }

        
        if (conditions.length > 0) {
            query.$and = conditions;
        }

        const totalItems = await Item.countDocuments(query);
        
        
        const albums = await Item.find(query)
            .sort({ added_at: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .lean(); 

        const filterMap = {
            music: [
                { id: 'vinyl', label: req.t('media.vinyl') },
                { id: 'cd', label: req.t('media.cd') },
                { id: 'cassette', label: req.t('media.cassette') }
            ],
            books: [
                { id: 'manga', label: req.t('media.manga') },
                { id: 'comic', label: req.t('media.comic') },
                { id: 'hardcover', label: req.t('media.hardcover') },
                { id: 'paperback', label: req.t('media.paperback') }
            ],
            dvd: [
                { id: 'dvd', label: req.t('media.dvd') },
                { id: 'bluray', label: req.t('media.bluray') },
                { id: '4k', label: req.t('media.4k') }
            ]
        };

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
            activeFilters: filterMap[type] || [],
            locations: await Item.distinct('location', { owner: adminId })
        });

    } catch (err) {
        console.error(err);
        res.status(500).send(req.t('errors.generic_server_error'));
    }
});

// Add-vinyl search page (view)
router.get('/add-vinyl', requireAuth, requireAdmin, (req, res) => {
    res.render('add-vinyl', { results: null, user: res.locals.user });
});


// route for editing an existing album
router.get('/album/edit/:id', requireAuth, async (req, res) => {
    try {
        const album = await Item.findById(req.params.id);
        if (!album) {
            return res.redirect('/collection?type=music');
        }
        const albumFormatted = formatForView(album);
        console.log(albumFormatted)
        const adminId = await getAdminId();
        const locations = await Item.distinct('location', { owner: adminId, location: { $ne: "" } });
        
        res.render('edit-vinyl', { vinyl: albumFormatted, user: res.locals.user, locations });
    } catch (err) {
        console.error(err);
        res.redirect('/collection?type=music');
    }
});

router.post('/search-discogs', requireAuth, requireAdmin, async (req, res) => {
  const query = req.body.query;
  const type = req.body.type || 'vinyl';
  const token = process.env.DISCOGS_TOKEN;

  try {
    const url = `https://api.discogs.com/database/search?q=${query}&type=release&format=${type}&token=${token}`;
    const response = await axios.get(url, { headers: { 'User-Agent': 'DVinylApp/1.0' } });

    const technicalBlacklist = [
        'Vinyl', 'LP', 'Album', 'Reissue', 'Repress', 'Stereo', 'Gatefold', 
        '12"', '7"', 'Limited Edition', 'Compilation', 'Deluxe Edition', 'Numbered', 'Promo'
    ];

    const processedResults = response.data.results.slice(0, 10).map(item => {
        let variant_info = '';
        
        if (item.formats && item.formats[0] && item.formats[0].text) {
            variant_info = item.formats[0].text.split(',')
                .map(p => p.trim())
                .filter(part => !technicalBlacklist.some(term => part.toLowerCase().includes(term.toLowerCase())))
                .join(', ');
        }

        return {
            ...item,
            variant_info: variant_info,
            country: item.country || ''
        };
    });

    res.render('add-vinyl', { 
        results: processedResults,
        searchType: type,
        user: res.locals.user
    });
  } catch (err) {
    console.log(err);
    res.render('add-vinyl', { results: [], error: req.t('errors.api_error'), searchType: type, user: res.locals.user });
  }
});

// Confirmation with extended info
router.get('/confirm-vinyl/:id', requireAuth, async (req, res) => {
    const discogsId = req.params.id;
    const token = process.env.DISCOGS_TOKEN;

    try {
        const url = `https://api.discogs.com/releases/${discogsId}?token=${token}`;
        const response = await axios.get(url, { headers: { 'User-Agent': 'DVinylApp/1.0' } });
        const data = response.data;

        const standardTerms = [
            'Vinyl', 'LP', 'Album', 'Reissue', 'Repress', 'Stereo', 'Gatefold', 
            '12"', '7"', 'Limited Edition', 'Compilation', 'Deluxe Edition', 'Numbered', 'Promo'
        ];        

        let formatType = [];
        let variantColor = [];

        if (data.formats && data.formats.length > 0) {
            const f = data.formats[0];
            formatType.push(f.name);

            if (f.text) {
                const parts = f.text.split(',').map(p => p.trim());
                parts.forEach(part => {
                    if (standardTerms.includes(part)) {
                        if (!formatType.includes(part)) formatType.push(part);
                    } else {
                        if (!variantColor.includes(part)) variantColor.push(part);
                    }
                });
            }

            if (f.descriptions) {
                f.descriptions.forEach(desc => {
                    if (standardTerms.includes(desc)) {
                        if (!formatType.includes(desc)) formatType.push(desc);
                    } else {
                        if (!variantColor.includes(desc)) {
                            variantColor.push(desc);
                        }
                    }
                });
            }
        }
        
        const adminId = await User.findOne({ isAdmin: true }).select('_id').lean();
        const locations = await Item.distinct('location', { owner: adminId, location: { $ne: "" } });

        const vinyl = {
            title: data.title,
            artist: data.artists ? data.artists.map(a => a.name).join(', ') : 'Unknown',
            year: data.year || '',
            label: data.labels && data.labels.length > 0 ? data.labels[0].name : '',
            catalog_number: data.labels && data.labels.length > 0 ? data.labels[0].catno : '',
            format_type: formatType.join(', '),
            variant_color: variantColor.join(', '), 
            tracklist: data.tracklist || [],
            cover_image: data.images && data.images.length > 0 ? data.images[0].resource_url : '',
            discogs_id: data.id, 
            country: data.country || '',
        };

        res.render('confirm-vinyl', { vinyl, user: res.locals.user, locations });
    } catch (err) {
        console.log(err);
        res.status(500).send(req.t('errors.generic_server_error'));
    } 
});

// Save handler: smart create or update logic
// Performs creation or update depending on provided IDs
router.post('/save-vinyl', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { 
            mongo_id, title, artist, year, label, catalog_number, country,
            format_type, variant_color, cover_image, user_image, discogs_id, tracklist_json,
            media_type, in_wishlist, comments, location, quantity
        } = req.body;
        
        const tracklist = tracklist_json ? JSON.parse(tracklist_json) : [];
        const adminId = req.user._id;
        const isWishlist = in_wishlist === 'true';
        
        let album;

        if (mongo_id) {
            album = await Item.findById(mongo_id);
        }
        
        if (!album && discogs_id) {
            album = await Vinyl.findOne({ discogs_id: discogs_id, owner: adminId });
        }

        if (album) {
            album.title = title;
            if (artist) album.artist = artist;
            album.discogs_id = discogs_id;
            album.year = year;
            album.label = label;
            album.catalog_number = catalog_number;
            album.format_type = format_type;
            album.variant_color = variant_color;
            album.tracklist = tracklist;
            album.cover_image = cover_image;
            album.in_wishlist = isWishlist;
            album.media_type = media_type || 'vinyl';
            album.comments = comments || '';
            album.location = location || '';
            album.quantity = parseInt(quantity) || 1;
            album.country = country || '';
            
            if (user_image && user_image.length > 0) {
                album.user_image = user_image;
            }

            await album.save();
        } else {
            await Vinyl.create({
                title, artist, year, label, catalog_number,
                format_type, variant_color,
                tracklist,
                cover_image, 
                user_image, 
                discogs_id,
                media_type: media_type || 'vinyl',
                in_wishlist: isWishlist,
                owner: adminId,
                comments: comments || '',
                location: location || '',
                quantity: parseInt(quantity) || 1,
                country: country || '',
            });
        }

        if (isWishlist) {
            res.redirect('/wishlist');
        } else {
            res.redirect(`/collection?type=music`);
        }

    } catch (err) {
        console.error("Save error:", err);
        res.status(500).send(req.t('errors.generic_server_error'));
    }
});

// API route to move an album from wishlist to collection
router.post('/api/album/:id/move-to-collection', requireAuth, requireAdmin, async (req, res) => {
    try {
        await Item.findByIdAndUpdate(req.params.id, { in_wishlist: false, added_at: new Date() });
        res.json({ success: true });
    } catch (err) {
        res.status(500).send(req.t('errors.generic_server_error'));
    }
});

// API route to fetch all collection discogs IDs (used for global estimates)
router.get('/api/collection/ids', requireAuth, async (req, res) => {
    try {
        const adminId = await getAdminId();
        const albums = await Vinyl.find({ 
            owner: adminId, 
            in_wishlist: false 
        }).select('discogs_id quantity');
        
        console.log(`📦 Global estimate: ${albums.length} albums sent to front-end.`);
        res.json({ success: true, albums });

    } catch (err) {
        console.error("API Collection IDs error:", err);
        res.status(500).send(req.t('errors.generic_server_error'));
    }
});

router.get('/wishlist', requireAuth, async (req, res) => {
    try {
        const adminId = await getAdminId();
        const albums = await Item.find({ 
            owner: adminId,
            in_wishlist: true 
        }).sort({ added_at: -1 });

        res.render('wishlist', { 
            albums, 
            user: res.locals.user 
        });
    } catch (err) {
        console.log(err);
        res.status(500).send(req.t('errors.generic_server_error'));
    }
});

// collection item detail
router.get('/album/:id', requireAuth, async (req, res) => {
    try {
        const album = await Item.findById(req.params.id);
        if (!album) return res.redirect('/collection?type=music');
        const albumFormatted = formatForView(album);

        res.render('vinyl-detail', { album: albumFormatted, vinyl: albumFormatted, user: res.locals.user });
    } catch (err) {
        res.redirect('/collection?type=music');
    }
});

// Delete route (API)
router.delete('/api/album/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
        // Look up the album to determine its media type (CD or vinyl)
        const album = await Item.findOne({ _id: req.params.id, owner: res.locals.user._id });

        if (!album) {
            return res.status(404).json({ error: "Album not found or you are not the owner." });
        }

        // Save the type for redirect
        const typeRedirect = album.media_type || 'vinyl';

        // Delete
        await Item.deleteOne({ _id: req.params.id });

        // Respond to the frontend with the redirect URL
        res.json({ success: true, redirectUrl: `/collection?type=music` });

    } catch (err) {
        console.error(err);
        res.status(500).send(req.t('errors.generic_server_error'));
    }
});

// Internal API to search Google Images
router.get('/api/google-images', requireAuth, async (req, res) => {
    const query = req.query.q;
    const apiKey = process.env.GOOGLE_API_KEY; // Google Custom Search API key
    const cx = process.env.GOOGLE_CSE_ID; // Custom Search Engine ID

    if (!query) return res.status(400).json([]);

    try {
        const url = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(query)}&cx=${cx}&searchType=image&key=${apiKey}&num=8`;
        const response = await axios.get(url);
        
        // Return only the image links
        const images = response.data.items.map(item => item.link);
        res.json(images);
    } catch (err) {
        console.error(err);
        res.status(500).send(req.t('errors.generic_server_error'));
    }
});

// Estimate route (Discogs API)
router.get('/api/estimate/:discogsId', requireAuth, async (req, res) => {
    try {
        const discogsId = req.params.discogsId;
        const token = process.env.DISCOGS_TOKEN;

        const userCurrency = res.locals.user.currency || 'USD';

        // PLAN A: Active marketplace prices
        try {
            const statsRes = await fetch(`https://api.discogs.com/marketplace/stats/${discogsId}?curr_abbr=${userCurrency}&token=${token}`, {
                headers: { 'User-Agent': 'DVinylApp/1.0' }
            });

            if (statsRes.ok) {
                const statsData = await statsRes.json();
                
                // Verify there's a non-zero lowest price
                if (statsData.lowest_price && statsData.lowest_price.value > 0) {
                    console.log(`💰 Plan A (market) for ID ${discogsId}: ${statsData.lowest_price.value}€`);
                    return res.json({
                        success: true,
                        source: 'market', // concrete market data
                        price: statsData.lowest_price,
                        details: `${statsData.num_for_sale} for sale`
                    });
                }
            }
        } catch (e) {
            console.log(`⚠️ Plan A failed for ${discogsId} (not for sale or error)`);
        }

        // PLAN B: Price suggestions / historical fallback
        // If we reach here, Plan A failed (no active sellers or error)
        try {
            const suggRes = await fetch(`https://api.discogs.com/marketplace/price_suggestions/${discogsId}?token=${token}`, {
                headers: { 'User-Agent': 'DVinylApp/1.0' }
            });

            if (suggRes.ok) {
                const suggData = await suggRes.json();
                
                // Try to find "Very Good Plus" key flexibly (case/format tolerant)
                const keys = Object.keys(suggData);
                const vgKey = keys.find(k => k.toLowerCase().includes('very good plus'));
                const mintKey = keys.find(k => k.toLowerCase().includes('mint (m)')); // Fallback if VG+ doesn't exist

                const bestPrice = suggData[vgKey] || suggData[mintKey];

                if (bestPrice && bestPrice.value > 0) {
                    console.log(`📉 Plan B (history) for ID ${discogsId}: ${bestPrice.value}€`);
                    return res.json({
                        success: true,
                        source: 'history', // historical estimation
                        price: bestPrice,
                        details: "Based on historical data (VG+)"
                    });
                }
            }
            } catch (e) {
            console.log(`⚠️ Plan B failed for ${discogsId}`);
        }

        // TOTAL FAILURE
        console.log(`❌ No price found for ${discogsId}`);
        res.json({ success: false, error: "Unavailable" });

    } catch (err) {
        console.error("Estimation server error:", err);
        res.json({ success: false, error: "Server error" });
    }
});

// Discogs import route (starts the import process)
router.post('/import/discogs', requireAuth, async (req, res) => {
    const { discogsUrl, full, type } = req.body;
    const userId = req.user._id;
    const token = process.env.DISCOGS_TOKEN;

    const usernameMatch = discogsUrl.match(/(?:user\/|user=)([^/?&]+)/);
    if (!usernameMatch) return res.status(400).json({ error: "Invalid Discogs URL" });
    const username = usernameMatch[1];

    await User.findByIdAndUpdate(userId, { discogsUsername: username });

    res.status(202).json({ success: true, message: "Import started" });

    try {
        let page = 1;
        let totalImported = 0;
        let hasMore = true;
        const standardTerms = ['Vinyl', 'LP', 'Album', 'Reissue', 'Repress', 'Stereo', 'Gatefold', '12"', '7"'];
        
        const isWishlist = (type === 'wishlist');
        const apiUrl = isWishlist ? `https://api.discogs.com/users/${username}/wants` : `https://api.discogs.com/users/${username}/collection/folders/0/releases`;
        const listKey = isWishlist ? 'wants' : 'releases';
        
        while (hasMore) {
            const response = await axios.get(apiUrl, {
                params: { page, per_page: 50 },
                headers: { 'Authorization': `Discogs token=${token}`, 'User-Agent': 'DVinylApp/1.0' }
            });
            
            const listItems = response.data[listKey];
            const pagination = response.data.pagination;

            if (!listItems || listItems.length === 0) break;
            
            const albumsToInsert = [];
            
            for (const item of listItems) {

                const info = item.basic_information;
                const existing = await Vinyl.findOne({ discogs_id: info.id, owner: userId });
                if (existing) continue;

                let tracklist = [];
                if (full === true) {
                    try {
                        const detailRes = await axios.get(`https://api.discogs.com/releases/${info.id}`, {
                            headers: { 'Authorization': `Discogs token=${token}`, 'User-Agent': 'DVinylApp/1.0' }
                        });
                        tracklist = detailRes.data.tracklist || [];
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    } catch (e) { console.error(`Tracklist error ID ${info.id}`); }
                }

                let formatType = [info.formats?.[0]?.name].filter(Boolean);
                let variantColor = [];
                if (info.formats?.[0]?.descriptions) {
                    info.formats[0].descriptions.forEach(d => standardTerms.includes(d) ? formatType.push(d) : variantColor.push(d));
                }
                const rawFormat = info.formats?.[0]?.name.toLowerCase() || 'vinyl';
                let mediaType = rawFormat.includes('cd') ? 'cd' : (rawFormat.includes('cassette') ? 'cassette' : 'vinyl');

                albumsToInsert.push({
                    title: info.title,
                    artist: info.artists.map(a => a.name).join(', '),
                    year: info.year || 0, 
                    label: info.labels?.[0]?.name || 'Unknown',
                    catalog_number: info.labels?.[0]?.catno || '',
                    format_type: formatType.join(', '), 
                    variant_color: variantColor.join(', '),
                    media_type: mediaType, 
                    cover_image: info.cover_image || info.thumb || '',
                    tracklist, 
                    discogs_id: info.id, 
                    owner: userId, 
                    added_at: new Date(),
                    location: '',
                    in_wishlist: isWishlist,
                    kind: 'Music'
                });
                
                req.io.emit('import_progress', { current: totalImported + albumsToInsert.length });
            }

            if (albumsToInsert.length > 0) {
                await Vinyl.insertMany(albumsToInsert);
                totalImported += albumsToInsert.length;

                req.io.emit('import_progress', { current: totalImported });
            }

            if (page >= pagination.pages) hasMore = false;
            else page++;
        }

        req.io.emit('import_finished', { count: totalImported });

    } catch (err) {
        req.io.emit('import_error', { message: err.message });
    }
});

// API route to import tracklist from Discogs
router.post('/api/album/:id/import-tracklist', requireAuth, requireAdmin, async (req, res) => {
    const { discogsId } = req.body;
    const albumId = req.params.id;
    const token = process.env.DISCOGS_TOKEN;

    if (!discogsId) {
        return res.status(400).json({ success: false, error: "ID Discogs missing" });
    }

    try {
        const response = await axios.get(`https://api.discogs.com/releases/${discogsId}`, {
            headers: { 'User-Agent': 'DVinylApp/1.0', 'Authorization': `Discogs token=${token}` }
        });

        const tracklist = response.data.tracklist;

        if (!tracklist || tracklist.length === 0) {
            return res.status(404).json({ success: false, error: "No tracklist found on Discogs" });
        }

        await Vinyl.findByIdAndUpdate(albumId, { tracklist: tracklist });
        res.status(200).json({ success: true });

    } catch (err) {
        console.error("Erreur API Discogs:", err.message);
        res.status(500).json({ success: false, error: "Error during Discogs API call" });
    }
});

module.exports = router;