const axios = require('axios');
const BarcodeCache = require('../models/BarcodeCache');

const NOT_FOUND_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const AXIOS_TIMEOUT_MS = 10_000;
const TMDB_BASE = 'https://api.themoviedb.org/3';
const UPCITEMDB_BASE = 'https://api.upcitemdb.com/prod/trial/lookup';
const EANSEARCH_BASE = 'https://api.ean-search.org/api';

let warnedNoEanToken = false;

function normalizeEan(input) {
    if (typeof input !== 'string') return null;
    const clean = input.replace(/[- ]/g, '');
    if (!/^\d{12,13}$/.test(clean)) return null;
    return clean;
}

function isDanish(ean) {
    return ean.startsWith('570');
}

function log(ean, source, status, extra) {
    const tail = extra ? ` ${extra}` : '';
    console.log(`[BC] ${ean} → ${source} ${status}${tail}`);
}

function cleanTitle(raw) {
    if (!raw) return '';
    return raw
        .replace(/\b(DVD|Blu-?ray|4K|UHD|Ultra HD|Coffret|Edition|Steelbook|Combo|Pack)\b/gi, '')
        .replace(/[\[\(].*?[\]\)]/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

function extractYear(text) {
    if (!text) return '';
    const match = text.match(/\b(19|20)\d{2}\b/);
    return match ? match[0] : '';
}

async function readCache(ean) {
    const row = await BarcodeCache.findOne({ ean });
    if (!row) return null;

    if (row.status === 'found') {
        await BarcodeCache.updateOne({ ean }, { $inc: { hit_count: 1 } });
        return {
            status: 'found',
            ean: row.ean,
            tmdb_id: row.tmdb_id,
            media_type: row.media_type,
            title: row.title,
            year: row.year,
            cover_image: row.cover_image,
            source: 'cache'
        };
    }

    const age = Date.now() - row.checked_at.getTime();
    if (row.status === 'not_found' && age < NOT_FOUND_TTL_MS) {
        await BarcodeCache.updateOne({ ean }, { $inc: { hit_count: 1 } });
        return {
            status: 'not_found',
            ean: row.ean,
            source: 'cache',
            checked_at: row.checked_at
        };
    }
    return null;
}

async function writeFound(ean, source, match, rawTitle) {
    await BarcodeCache.findOneAndUpdate(
        { ean },
        {
            $set: {
                status: 'found',
                source,
                tmdb_id: match.tmdb_id,
                media_type: match.media_type,
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
        { ean },
        {
            $set: {
                status: 'not_found',
                source: null,
                tmdb_id: null,
                media_type: null,
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

function formatTmdbHit(item, mediaType) {
    const isTv = mediaType === 'tv';
    return {
        tmdb_id: item.id,
        media_type: mediaType,
        title: isTv ? item.name : item.title,
        year: isTv
            ? (item.first_air_date ? item.first_air_date.substring(0, 4) : '')
            : (item.release_date ? item.release_date.substring(0, 4) : ''),
        cover_image: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : '',
        description: item.overview || ''
    };
}

async function resolveTitleOnTmdb(rawTitle, year) {
    const apiKey = process.env.TMDB_API_KEY;
    if (!apiKey) throw new Error('TMDB_API_KEY missing');

    const title = cleanTitle(rawTitle);
    if (!title) return null;

    const movieParams = new URLSearchParams({
        api_key: apiKey,
        query: title,
        language: 'da-DK',
        region: 'DK',
        page: '1'
    });
    if (year) movieParams.set('year', year);

    try {
        const movieRes = await axios.get(`${TMDB_BASE}/search/movie?${movieParams}`, { timeout: AXIOS_TIMEOUT_MS });
        const movies = movieRes.data.results || [];
        if (movies.length === 1) return formatTmdbHit(movies[0], 'movie');
    } catch (err) {
        console.error('[ERR] TMDb movie search:', err.message);
    }

    const tvParams = new URLSearchParams({
        api_key: apiKey,
        query: title,
        language: 'da-DK',
        page: '1'
    });
    if (year) tvParams.set('first_air_date_year', year);

    try {
        const tvRes = await axios.get(`${TMDB_BASE}/search/tv?${tvParams}`, { timeout: AXIOS_TIMEOUT_MS });
        const tvs = tvRes.data.results || [];
        if (tvs.length === 1) return formatTmdbHit(tvs[0], 'tv');
    } catch (err) {
        console.error('[ERR] TMDb tv search:', err.message);
    }

    return null;
}

async function tryUpcitemdb(ean) {
    try {
        const res = await axios.get(`${UPCITEMDB_BASE}?upc=${ean}`, { timeout: AXIOS_TIMEOUT_MS });
        const items = res.data.items || [];
        if (items.length === 0) return { miss: true };

        const item = items[0];
        const rawTitle = item.title || '';
        const year = extractYear(`${rawTitle} ${item.description || ''}`);
        const match = await resolveTitleOnTmdb(rawTitle, year);
        if (!match) return { ambiguous: true, rawTitle };
        return { match, rawTitle };
    } catch (err) {
        console.error('[ERR] UPCItemDB:', err.message);
        return { error: true };
    }
}

async function tryTmdbEan(ean) {
    const apiKey = process.env.TMDB_API_KEY;
    if (!apiKey) throw new Error('TMDB_API_KEY missing');

    try {
        const url = `${TMDB_BASE}/find/${ean}?api_key=${apiKey}&external_source=ean_id&language=da-DK&region=DK`;
        const res = await axios.get(url, { timeout: AXIOS_TIMEOUT_MS });
        const movies = res.data.movie_results || [];
        const tvs = res.data.tv_results || [];

        if (movies.length > 0) return { match: formatTmdbHit(movies[0], 'movie') };
        if (tvs.length > 0) return { match: formatTmdbHit(tvs[0], 'tv') };
        return { miss: true };
    } catch (err) {
        console.error('[ERR] TMDb EAN-find:', err.message);
        return { error: true };
    }
}

async function tryEansearch(ean) {
    const token = process.env.EAN_SEARCH_TOKEN;
    if (!token) {
        if (!warnedNoEanToken) {
            console.log('[BC] EAN_SEARCH_TOKEN not set — skipping ean-search.org');
            warnedNoEanToken = true;
        }
        return { error: true };
    }

    try {
        const url = `${EANSEARCH_BASE}?token=${token}&op=barcode-lookup&ean=${ean}&format=json&language=2`;
        const res = await axios.get(url, { timeout: AXIOS_TIMEOUT_MS });

        const data = res.data;
        if (Array.isArray(data) && data.length > 0 && data[0].name) {
            const rawTitle = data[0].name;
            const year = extractYear(rawTitle);
            const match = await resolveTitleOnTmdb(rawTitle, year);
            if (!match) return { ambiguous: true, rawTitle };
            return { match, rawTitle };
        }
        return { miss: true };
    } catch (err) {
        const status = err.response ? err.response.status : 'network';
        console.error(`[ERR] EAN-search (${status}):`, err.message);
        return { error: true };
    }
}

async function lookupBarcode(ean) {
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

    let sawRealMiss = false;

    if (!isDanish(normalized)) {
        const upc = await tryUpcitemdb(normalized);
        if (upc.match) {
            await writeFound(normalized, 'upcitemdb', upc.match, upc.rawTitle);
            log(normalized, 'upcitemdb', 'found');
            return { status: 'found', ean: normalized, ...upc.match, source: 'upcitemdb' };
        }
        if (upc.miss) sawRealMiss = true;

        const tmdb = await tryTmdbEan(normalized);
        if (tmdb.match) {
            await writeFound(normalized, 'tmdb-ean', tmdb.match, null);
            log(normalized, 'tmdb-ean', 'found');
            return { status: 'found', ean: normalized, ...tmdb.match, source: 'tmdb-ean' };
        }
        if (tmdb.miss) sawRealMiss = true;
    }

    const eansearch = await tryEansearch(normalized);
    if (eansearch.match) {
        await writeFound(normalized, 'eansearch', eansearch.match, eansearch.rawTitle);
        log(normalized, 'eansearch', 'found');
        return { status: 'found', ean: normalized, ...eansearch.match, source: 'eansearch' };
    }
    if (eansearch.miss) sawRealMiss = true;

    if (sawRealMiss) {
        await writeNotFound(normalized);
        log(normalized, 'chain', 'not_found');
        return { status: 'not_found', ean: normalized, source: 'chain', checked_at: new Date() };
    }

    log(normalized, 'chain', 'error');
    return { status: 'error', ean: normalized };
}

async function saveManualMatch(ean, payload) {
    const normalized = normalizeEan(ean);
    if (!normalized) {
        log(ean, 'manual', 'invalid');
        return { status: 'invalid', ean };
    }
    if (!payload || !payload.tmdb_id || !payload.media_type) {
        log(normalized, 'manual', 'bad_payload');
        return { status: 'invalid', ean: normalized };
    }

    const match = {
        tmdb_id: payload.tmdb_id,
        media_type: payload.media_type,
        title: payload.title || '',
        year: payload.year || '',
        cover_image: payload.cover_image || ''
    };

    await writeFound(normalized, 'manual', match, null);
    log(normalized, 'manual', 'found');
    return { status: 'found', ean: normalized, ...match, source: 'manual' };
}

async function forceRelookup(ean) {
    const normalized = normalizeEan(ean);
    if (!normalized) return { status: 'invalid', ean };
    await BarcodeCache.deleteOne({ ean: normalized });
    return lookupBarcode(normalized);
}

module.exports = {
    lookupBarcode,
    saveManualMatch,
    forceRelookup
};
