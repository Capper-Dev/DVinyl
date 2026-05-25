const axios = require('axios');
const BarcodeCache = require('../models/BarcodeCache');
const { igdbRequest } = require('./igdbHelper');

const NOT_FOUND_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const AXIOS_TIMEOUT_MS = 10_000;
const UPCITEMDB_BASE = 'https://api.upcitemdb.com/prod/trial/lookup';

const PLATFORM_NOISE = /\b(Nintendo|PlayStation|Xbox|PS[1-5]|PSP|PSV|PS Vita|Switch|Wii ?U?|GameCube|N64|GBA|GBC|DS|3DS|2DS|Steam|PC|Sega|Mega Drive|Genesis|Saturn|Dreamcast|Atari)\b/gi;
const PACKAGING_NOISE = /\b(Limited|Collector('s)?|Edition|Steelbook|Day One|GOTY|Game of the Year|Deluxe|Standard|Special|Complete|Definitive|Remaster(ed)?|HD|Pack|Bundle|Region Free|PAL|NTSC)\b/gi;

function normalizeEan(input) {
    if (typeof input !== 'string') return null;
    const clean = input.replace(/[- ]/g, '');
    if (!/^\d{12,13}$/.test(clean)) return null;
    return clean;
}

function log(ean, source, status, extra) {
    const tail = extra ? ` ${extra}` : '';
    console.log(`[BC-GAME] ${ean} → ${source} ${status}${tail}`);
}

function cleanTitle(raw) {
    if (!raw) return '';
    return raw
        .replace(PLATFORM_NOISE, '')
        .replace(PACKAGING_NOISE, '')
        .replace(/[\[\(].*?[\]\)]/g, '')
        .replace(/[-:]/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

async function readCache(ean) {
    const row = await BarcodeCache.findOne({ ean, kind: 'game' });
    if (!row) return null;

    if (row.status === 'found') {
        await BarcodeCache.updateOne({ ean, kind: 'game' }, { $inc: { hit_count: 1 } });
        return {
            status: 'found',
            ean: row.ean,
            igdb_id: row.igdb_id,
            title: row.title,
            year: row.year,
            cover_image: row.cover_image,
            source: 'cache'
        };
    }

    const age = Date.now() - row.checked_at.getTime();
    if (row.status === 'not_found' && age < NOT_FOUND_TTL_MS) {
        await BarcodeCache.updateOne({ ean, kind: 'game' }, { $inc: { hit_count: 1 } });
        return { status: 'not_found', ean: row.ean, source: 'cache', checked_at: row.checked_at };
    }
    return null;
}

async function writeFound(ean, source, match, rawTitle) {
    await BarcodeCache.findOneAndUpdate(
        { ean, kind: 'game' },
        {
            $set: {
                kind: 'game',
                status: 'found',
                source,
                igdb_id: match.igdb_id,
                title: match.title,
                year: match.year,
                cover_image: match.cover_image,
                raw_title: rawTitle || null,
                checked_at: new Date()
            },
            $inc: { hit_count: 1 }
        },
        { upsert: true }
    );
}

async function writeNotFound(ean) {
    await BarcodeCache.findOneAndUpdate(
        { ean, kind: 'game' },
        {
            $set: {
                kind: 'game',
                status: 'not_found',
                source: null,
                igdb_id: null,
                title: null,
                year: null,
                cover_image: null,
                checked_at: new Date()
            },
            $inc: { hit_count: 1 }
        },
        { upsert: true }
    );
}

function formatIgdbHit(game) {
    let cover = '/ressources/no_file.png';
    if (game.cover && game.cover.url) {
        cover = game.cover.url.replace('t_thumb', 't_cover_big');
        if (cover.startsWith('//')) cover = 'https:' + cover;
    }
    let year = '';
    if (game.first_release_date) {
        year = new Date(game.first_release_date * 1000).getFullYear().toString();
    }
    return {
        igdb_id: game.id,
        title: game.name || '',
        year,
        cover_image: cover
    };
}

async function resolveTitleOnIgdb(rawTitle) {
    const title = cleanTitle(rawTitle);
    if (!title) return null;

    try {
        const results = await igdbRequest('games',
            `search "${title.replace(/"/g, '\\"')}";
             fields name, cover.url, first_release_date, total_rating_count;
             limit 5;`
        );
        if (!results || results.length === 0) return null;

        const sorted = [...results].sort((a, b) => (b.total_rating_count || 0) - (a.total_rating_count || 0));
        return formatIgdbHit(sorted[0]);
    } catch (err) {
        console.error('[ERR] IGDB title search:', err.message);
        return null;
    }
}

async function tryUpcitemdb(ean) {
    try {
        const res = await axios.get(`${UPCITEMDB_BASE}?upc=${ean}`, { timeout: AXIOS_TIMEOUT_MS });
        const items = res.data.items || [];
        if (items.length === 0) return { miss: true };

        const rawTitle = items[0].title || '';
        const match = await resolveTitleOnIgdb(rawTitle);
        if (!match) return { ambiguous: true, rawTitle };
        return { match, rawTitle };
    } catch (err) {
        console.error('[ERR] UPCItemDB:', err.message);
        return { error: true };
    }
}

async function lookupGameBarcode(ean) {
    const normalized = normalizeEan(ean);
    if (!normalized) {
        log(ean, 'normalize', 'invalid');
        return { status: 'invalid', ean };
    }

    const cached = await readCache(normalized);
    if (cached) {
        log(normalized, 'cache', cached.status);
        return cached;
    }

    const upc = await tryUpcitemdb(normalized);
    if (upc.match) {
        await writeFound(normalized, 'upcitemdb', upc.match, upc.rawTitle);
        log(normalized, 'upcitemdb', 'found');
        return { status: 'found', ean: normalized, ...upc.match, source: 'upcitemdb' };
    }
    if (upc.miss) {
        await writeNotFound(normalized);
        log(normalized, 'chain', 'not_found');
        return { status: 'not_found', ean: normalized, source: 'chain', checked_at: new Date() };
    }
    if (upc.ambiguous) {
        log(normalized, 'upcitemdb', 'ambiguous', upc.rawTitle);
        return { status: 'ambiguous', ean: normalized, raw_title: upc.rawTitle };
    }

    log(normalized, 'chain', 'error');
    return { status: 'error', ean: normalized };
}

async function saveManualGameMatch(ean, payload) {
    const normalized = normalizeEan(ean);
    if (!normalized) return { status: 'invalid', ean };
    if (!payload || !payload.igdb_id) return { status: 'invalid', ean: normalized };

    const match = {
        igdb_id: payload.igdb_id,
        title: payload.title || '',
        year: payload.year || '',
        cover_image: payload.cover_image || ''
    };

    await writeFound(normalized, 'manual', match, null);
    log(normalized, 'manual', 'found');
    return { status: 'found', ean: normalized, ...match, source: 'manual' };
}

module.exports = { lookupGameBarcode, saveManualGameMatch };
