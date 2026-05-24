# Barcode Lookup Service + Danish Hardcoding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a caching barcode lookup service for DVDs (UPCItemDB → TMDb-EAN → EAN-search.org), then strip i18next from the project entirely and replace every translation call with hardcoded Danish text.

**Architecture:** New service module (`utils/barcodeLookup.js`) + Mongo cache collection + thin HTTP route for manual saves. Replaces ~90 lines of inline lookup logic in `routes/dvdRoutes.js`. Part 2 is a separate find-and-replace pass across ~30 files plus removal of the i18next stack.

**Tech Stack:** Node.js / Express 5 / Mongoose 8 / Bun / EJS views. Plain JavaScript (CommonJS, no TypeScript, no comments per project rules). `axios` for HTTP. No test framework — verification is via curl + manual browser smoke tests.

**Spec:** `docs/superpowers/specs/2026-05-24-barcode-lookup-and-danish-hardcoding-design.md`

---

## Important conventions for this plan

- **No tests.** Project has no test suite. Each task includes a manual verification step (curl, scan, navigate) instead of automated tests. The executing agent must NOT introduce a test framework — that's out of scope and would break the project's bun + node-only toolchain.
- **No code comments.** Per `~/.claude/CLAUDE.md` global rules.
- **Git ops are user-controlled.** Every "commit" step says `# user will commit — do not run git commit/push`. The executing agent stages changes and reports them, but the human handles git operations.
- **CommonJS only.** `require()` / `module.exports`, never `import`.
- **Match existing style.** Look at neighbors (`models/Collection.js`, `utils/migrate.js`) before writing.
- **CSS / build verification:** if any `.tsx` / `.ts` / `.css` file is touched, run `bun run build:css` per global rules. This plan touches none of those, so skip.

---

## File structure overview

**Part 1 — Barcode service (new files):**
- `models/BarcodeCache.js` — Mongoose model for the cache collection.
- `utils/barcodeLookup.js` — service module with the lookup chain and exports.
- `routes/barcodeRoutes.js` — HTTP route for `POST /api/barcodes/:ean/manual`.

**Part 1 — Barcode service (modified):**
- `app.js` — mount `barcodeRoutes`.
- `.env.example` — add `EAN_SEARCH_TOKEN`.
- `routes/dvdRoutes.js` — replace inline UPC/TMDb-EAN block in `/search-dvds` POST.
- `views/add-dvd.ejs` — verify/add manual TMDb title-search UI when `barcode_no_results` is true.

**Part 2 — Danish hardcoding (modified or deleted):**
- Delete `/locales/` directory entirely.
- Modify `app.js`, `middleware/settingsMiddleware.js`, `middleware/authMiddleware.js`, `models/User.js`, `package.json`.
- Modify all route files using `req.t()`: `controllers/authController.js`, `routes/{adminRoutes,albumRoutes,bookRoutes,dvdRoutes,gameRoutes,settingsRoutes,setupRoutes}.js`.
- Modify all EJS views using `t()`: ~25 files in `/views/`.

---

# PART 1 — Barcode Lookup Service

---

### Task 1: Create the BarcodeCache Mongoose model

**Files:**
- Create: `F:/MainProjects/DVinyl/models/BarcodeCache.js`

- [ ] **Step 1: Write the model file**

```js
const mongoose = require('mongoose');

const barcodeCacheSchema = new mongoose.Schema({
    ean:         { type: String, required: true, unique: true, index: true },
    status:      { type: String, enum: ['found', 'not_found'], required: true },
    source:      { type: String, enum: ['upcitemdb', 'tmdb-ean', 'eansearch', 'manual'] },
    tmdb_id:     { type: Number },
    media_type:  { type: String, enum: ['movie', 'tv'] },
    title:       { type: String },
    year:        { type: String },
    cover_image: { type: String },
    raw_title:   { type: String },
    checked_at:  { type: Date, default: Date.now, index: true },
    hit_count:   { type: Number, default: 0 }
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

module.exports = mongoose.model('BarcodeCache', barcodeCacheSchema);
```

- [ ] **Step 2: Manual verify — model loads without throwing**

Run: `bun --eval "require('./models/BarcodeCache.js'); console.log('ok')"`
Expected output: `ok`

- [ ] **Step 3: Stage for commit**

Stage: `models/BarcodeCache.js`
Commit message (user runs): `feat: add BarcodeCache mongoose model`

---

### Task 2: Add EAN_SEARCH_TOKEN to .env.example

**Files:**
- Modify: `F:/MainProjects/DVinyl/.env.example`

- [ ] **Step 1: Read the existing .env.example to find the right insertion point**

The DVD section currently has:
```
# DVDs
TMDB_API_KEY=YourTMDBAPIKeyHere
```

- [ ] **Step 2: Edit — append EAN_SEARCH_TOKEN under the DVDs section**

Change the DVD block to:
```
# DVDs
TMDB_API_KEY=YourTMDBAPIKeyHere
EAN_SEARCH_TOKEN=YourEANSearchTokenHere
```

- [ ] **Step 3: Stage for commit**

Stage: `.env.example`
Commit message (user runs): `chore: document EAN_SEARCH_TOKEN env var`

---

### Task 3: Create the barcode lookup service module skeleton

**Files:**
- Create: `F:/MainProjects/DVinyl/utils/barcodeLookup.js`

This task creates the module structure with stubs for the three exports. Tasks 4-8 fill in the lookup chain logic. This stepwise approach keeps each task independently testable.

- [ ] **Step 1: Write the module skeleton**

```js
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

async function lookupBarcode(ean) {
    const normalized = normalizeEan(ean);
    if (!normalized) {
        return { status: 'invalid', ean };
    }
    return { status: 'not_found', ean: normalized, source: 'chain', checked_at: new Date() };
}

async function saveManualMatch(ean, payload) {
    const normalized = normalizeEan(ean);
    if (!normalized) {
        return { status: 'invalid', ean };
    }
    return { status: 'not_found', ean: normalized, source: 'manual', checked_at: new Date() };
}

async function forceRelookup(ean) {
    return lookupBarcode(ean);
}

module.exports = {
    lookupBarcode,
    saveManualMatch,
    forceRelookup
};
```

- [ ] **Step 2: Manual verify — module loads and exports the three functions**

Run:
```
bun --eval "const s = require('./utils/barcodeLookup'); console.log(typeof s.lookupBarcode, typeof s.saveManualMatch, typeof s.forceRelookup)"
```
Expected output: `function function function`

- [ ] **Step 3: Stage for commit**

Stage: `utils/barcodeLookup.js`
Commit message (user runs): `feat: scaffold barcodeLookup service module`

---

### Task 4: Add cache read/write helpers to barcodeLookup.js

**Files:**
- Modify: `F:/MainProjects/DVinyl/utils/barcodeLookup.js`

- [ ] **Step 1: Add helpers above `lookupBarcode`**

Insert these functions in `utils/barcodeLookup.js` between `extractYear` and `lookupBarcode`:

```js
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
```

- [ ] **Step 2: Manual verify — module still loads**

Run: `bun --eval "require('./utils/barcodeLookup'); console.log('ok')"`
Expected output: `ok`

- [ ] **Step 3: Stage for commit**

Stage: `utils/barcodeLookup.js`
Commit message (user runs): `feat: add cache read/write helpers to barcodeLookup`

---

### Task 5: Add TMDb title resolver

**Files:**
- Modify: `F:/MainProjects/DVinyl/utils/barcodeLookup.js`

- [ ] **Step 1: Add the resolver and a helper for formatting TMDb hits**

Insert these two functions before `lookupBarcode`:

```js
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
```

- [ ] **Step 2: Manual verify — resolver works against TMDb (skip if no key)**

If `TMDB_API_KEY` is set, run:
```
bun --eval "require('dotenv').config(); require('./utils/barcodeLookup'); const m = require('./utils/barcodeLookup'); /* not exported, verify file loads */"
```

Then write a one-shot test (do NOT commit this file):
```
bun --eval "require('dotenv').config(); const s = require('./utils/barcodeLookup'); /* internal helper not exported; verify by lookupBarcode call in Task 9 */; console.log('module loads')"
```
Expected output: `module loads`

(The resolver itself is exercised end-to-end in Task 9. Direct unit test impossible without exporting it; we accept this — the function is small and the integration test in Task 9 covers it.)

- [ ] **Step 3: Stage for commit**

Stage: `utils/barcodeLookup.js`
Commit message (user runs): `feat: add TMDb title resolver to barcodeLookup`

---

### Task 6: Add UPCItemDB source

**Files:**
- Modify: `F:/MainProjects/DVinyl/utils/barcodeLookup.js`

- [ ] **Step 1: Add the UPCItemDB query function**

Insert before `lookupBarcode`:

```js
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
```

- [ ] **Step 2: Manual verify — module still loads**

Run: `bun --eval "require('./utils/barcodeLookup'); console.log('ok')"`
Expected output: `ok`

- [ ] **Step 3: Stage for commit**

Stage: `utils/barcodeLookup.js`
Commit message (user runs): `feat: add UPCItemDB source to barcodeLookup`

---

### Task 7: Add TMDb EAN-find source

**Files:**
- Modify: `F:/MainProjects/DVinyl/utils/barcodeLookup.js`

- [ ] **Step 1: Add the TMDb EAN-find function**

Insert before `lookupBarcode`:

```js
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
```

- [ ] **Step 2: Manual verify — module still loads**

Run: `bun --eval "require('./utils/barcodeLookup'); console.log('ok')"`
Expected output: `ok`

- [ ] **Step 3: Stage for commit**

Stage: `utils/barcodeLookup.js`
Commit message (user runs): `feat: add TMDb EAN-find source to barcodeLookup`

---

### Task 8: Add EAN-search.org source

**Files:**
- Modify: `F:/MainProjects/DVinyl/utils/barcodeLookup.js`

- [ ] **Step 1: Add the EAN-search function**

Insert before `lookupBarcode`:

```js
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
```

- [ ] **Step 2: Manual verify — module still loads**

Run: `bun --eval "require('./utils/barcodeLookup'); console.log('ok')"`
Expected output: `ok`

- [ ] **Step 3: Stage for commit**

Stage: `utils/barcodeLookup.js`
Commit message (user runs): `feat: add EAN-search.org source to barcodeLookup`

---

### Task 9: Wire the lookup chain together in `lookupBarcode`

**Files:**
- Modify: `F:/MainProjects/DVinyl/utils/barcodeLookup.js`

- [ ] **Step 1: Replace the stub `lookupBarcode` function with the full chain**

Find:
```js
async function lookupBarcode(ean) {
    const normalized = normalizeEan(ean);
    if (!normalized) {
        return { status: 'invalid', ean };
    }
    return { status: 'not_found', ean: normalized, source: 'chain', checked_at: new Date() };
}
```

Replace with:
```js
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
```

- [ ] **Step 2: Manual verify — module loads and lookupBarcode returns the correct shape for an invalid input**

Run:
```
bun --eval "(async () => { require('dotenv').config(); const { lookupBarcode } = require('./utils/barcodeLookup'); console.log(JSON.stringify(await lookupBarcode('not-an-ean'))); })()"
```
Expected output: `{"status":"invalid","ean":"not-an-ean"}`

- [ ] **Step 3: Manual verify — lookupBarcode runs against a real DK barcode (requires MongoDB and EAN_SEARCH_TOKEN)**

Pick any known Danish DVD barcode (570xxxxxxxxxx). If no real one is handy, this verification can be deferred to Task 12 (which integrates with dvdRoutes and exercises the chain end-to-end through the UI).

Skip if no Mongo running locally.

- [ ] **Step 4: Stage for commit**

Stage: `utils/barcodeLookup.js`
Commit message (user runs): `feat: wire lookupBarcode chain (cache → upc → tmdb-ean → eansearch)`

---

### Task 10: Implement `saveManualMatch`

**Files:**
- Modify: `F:/MainProjects/DVinyl/utils/barcodeLookup.js`

- [ ] **Step 1: Replace the stub `saveManualMatch` with the real implementation**

Find:
```js
async function saveManualMatch(ean, payload) {
    const normalized = normalizeEan(ean);
    if (!normalized) {
        return { status: 'invalid', ean };
    }
    return { status: 'not_found', ean: normalized, source: 'manual', checked_at: new Date() };
}
```

Replace with:
```js
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
```

- [ ] **Step 2: Also replace `forceRelookup` with the real implementation**

Find:
```js
async function forceRelookup(ean) {
    return lookupBarcode(ean);
}
```

Replace with:
```js
async function forceRelookup(ean) {
    const normalized = normalizeEan(ean);
    if (!normalized) return { status: 'invalid', ean };
    await BarcodeCache.deleteOne({ ean: normalized });
    return lookupBarcode(normalized);
}
```

- [ ] **Step 3: Manual verify — module loads, saveManualMatch validates input**

Run:
```
bun --eval "(async () => { const { saveManualMatch } = require('./utils/barcodeLookup'); console.log(JSON.stringify(await saveManualMatch('bad-ean', {}))); })()"
```
Expected output: `{"status":"invalid","ean":"bad-ean"}`

- [ ] **Step 4: Stage for commit**

Stage: `utils/barcodeLookup.js`
Commit message (user runs): `feat: implement saveManualMatch and forceRelookup`

---

### Task 11: Create barcodeRoutes for the manual-save endpoint

**Files:**
- Create: `F:/MainProjects/DVinyl/routes/barcodeRoutes.js`
- Modify: `F:/MainProjects/DVinyl/app.js`

- [ ] **Step 1: Create `routes/barcodeRoutes.js`**

```js
const express = require('express');
const router = express.Router();
const { saveManualMatch, forceRelookup } = require('../utils/barcodeLookup');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');

router.post('/:ean/manual', requireAuth, requireAdmin, async (req, res) => {
    try {
        const result = await saveManualMatch(req.params.ean, req.body);
        if (result.status === 'invalid') {
            return res.status(400).json({ ok: false, error: 'invalid_input' });
        }
        return res.json({ ok: true, cached: result });
    } catch (err) {
        console.error('[ERR] barcode manual save:', err);
        return res.status(500).json({ ok: false, error: 'server_error' });
    }
});

router.post('/:ean/relookup', requireAuth, requireAdmin, async (req, res) => {
    try {
        const result = await forceRelookup(req.params.ean);
        return res.json({ ok: true, cached: result });
    } catch (err) {
        console.error('[ERR] barcode relookup:', err);
        return res.status(500).json({ ok: false, error: 'server_error' });
    }
});

module.exports = router;
```

- [ ] **Step 2: Mount the route in `app.js`**

Find the section near the bottom of `app.js` that mounts routes (look for `app.use(BASE_URL + '/api/collections', collectionRoutes);`).

Add immediately after that line:
```js
const barcodeRoutes = require('./routes/barcodeRoutes.js');
app.use(BASE_URL + '/api/barcodes', barcodeRoutes);
```

- [ ] **Step 3: Manual verify — start server, hit the endpoint with curl**

Start: `bun run start` (in another terminal)

Then from a shell with cookies for an admin session (or test from the browser dev tools):
```
curl -X POST "http://localhost:3099/api/barcodes/bad-ean/manual" -H "Content-Type: application/json" -d "{}"
```
Expected: HTTP 401 or 403 (auth required). That confirms the route is mounted and the auth middleware fires.

Stop the server.

- [ ] **Step 4: Stage for commit**

Stage: `routes/barcodeRoutes.js`, `app.js`
Commit message (user runs): `feat: add /api/barcodes routes for manual match and relookup`

---

### Task 12: Replace inline barcode logic in dvdRoutes.js with lookupBarcode

**Files:**
- Modify: `F:/MainProjects/DVinyl/routes/dvdRoutes.js`

**Note for the executing agent:** the current `/search-dvds` POST handler in `routes/dvdRoutes.js` has roughly 90 lines of inline UPC/TMDb-EAN/TMDb-search logic. Read the full handler first so you understand what stays (the non-barcode path) and what goes (the `if (isBarcode) { ... }` block).

- [ ] **Step 1: Read the current `/search-dvds` handler**

Open `F:/MainProjects/DVinyl/routes/dvdRoutes.js` and find the `router.post('/search-dvds', ...)` handler. Note:
- The `formatTMDBItem` helper at the top — stays unchanged.
- The non-barcode `search/multi` two-page parallel fetch at the bottom — stays unchanged.
- The `if (isBarcode) { ... }` block (UPC lookup + TMDb EAN-find + the year-aware movie-only search) — gets deleted.

- [ ] **Step 2: Add the import at the top of the file**

Near the other `require()` calls at the top, add:
```js
const { lookupBarcode } = require('../utils/barcodeLookup');
```

- [ ] **Step 3: Replace the barcode-handling block**

Inside `router.post('/search-dvds', ...)`, find the section that starts with:
```js
const isBarcode = /^\d{12,13}$/.test(query.replace(/[- ]/g, ''));

if (isBarcode) {
```

Delete from that `if (isBarcode) {` through its closing `}` (this includes the UPC lookup, TMDb EAN-find, and the year-shaped TMDb movie search — everything inside the `if (barcodeScanned)` branch that runs the movie-only TMDb search and renders the result).

Replace with:
```js
const cleanQuery = query.replace(/[- ]/g, '');
const isBarcode = /^\d{12,13}$/.test(cleanQuery);

if (isBarcode) {
    const result = await lookupBarcode(cleanQuery);

    if (result.status === 'found') {
        return res.redirect(`/confirm-dvd/${result.media_type}/${result.tmdb_id}?barcode=${result.ean}`);
    }

    return res.render('add-dvd', {
        results: null,
        scanned_barcode: cleanQuery,
        barcode_no_results: true,
        barcode_error: result.status === 'error',
        user: res.locals.user,
        currentType: 'add-dvd'
    });
}
```

- [ ] **Step 4: Remove now-unused variables**

In the same handler, delete the lines:
```js
let barcodeScanned = '';
let barcodeYear = '';
```
(they were only used by the deleted block). Also delete the `if (barcodeScanned && barcodeYear && results.length === 1)` short-circuit at the bottom of the handler if it's still there — the barcode path returns early now.

- [ ] **Step 5: Verify the non-barcode path is intact**

Read the rest of the handler. It should still:
- Compute `searchQuery` from `query`
- Run the two-page TMDb `search/multi` calls in parallel
- Filter to movie/tv, format, render `add-dvd` with results

If anything looks broken, fix it before moving on.

- [ ] **Step 6: Manual verify — start server, search a non-barcode query**

Start: `bun run start`
In browser: log in as admin, go to `/add-dvd`, search for `inception`. Expect results.

Then search a barcode (any valid 12-13 digit number). Expect either:
- Redirect to `/confirm-dvd/...` (cache hit or chain hit)
- `add-dvd` re-rendered with `barcode_no_results` (chain miss)
- `add-dvd` re-rendered with `barcode_error` (upstream all failed)

Stop the server.

- [ ] **Step 7: Stage for commit**

Stage: `routes/dvdRoutes.js`
Commit message (user runs): `refactor: use barcodeLookup service in dvdRoutes /search-dvds`

---

### Task 13: Verify add-dvd.ejs handles barcode_no_results with manual TMDb search

**Files:**
- Read: `F:/MainProjects/DVinyl/views/add-dvd.ejs`
- Possibly modify the same file

- [ ] **Step 1: Read add-dvd.ejs**

Open `views/add-dvd.ejs`. Look for usage of `barcode_no_results` and `scanned_barcode`.

- [ ] **Step 2: Decide if a manual-search UI exists**

The view should, when `barcode_no_results` is truthy, show a UI that lets the admin search TMDb by title and select a movie/series, then POST the selection to `/api/barcodes/:ean/manual`.

**If such a UI already exists:** verify it posts to the right endpoint with `{ tmdb_id, media_type, title, year, cover_image }`. If the endpoint is different, update the form action / fetch URL. Done with this task — go to Step 5.

**If it does not exist:** continue to Step 3.

- [ ] **Step 3: Add a minimal manual-search form**

Add inside the existing template, conditionally rendered when `barcode_no_results`:

```ejs
<% if (typeof barcode_no_results !== 'undefined' && barcode_no_results) { %>
  <div class="rounded p-4 mb-4 bg-yellow-100 text-yellow-900">
    <% if (typeof barcode_error !== 'undefined' && barcode_error) { %>
      Stregkode-opslag fejlede. Prøv igen, eller søg manuelt på titlen nedenfor.
    <% } else { %>
      Stregkoden <strong><%= scanned_barcode %></strong> blev ikke fundet. Søg manuelt:
    <% } %>

    <form method="POST" action="/search-dvds" class="mt-2 flex gap-2">
      <input type="text" name="query" placeholder="Filmtitel" class="border rounded px-2 py-1 flex-1" required>
      <button type="submit" class="bg-blue-600 text-white px-3 py-1 rounded">Søg</button>
    </form>

    <p class="text-sm mt-2 opacity-70">
      Når du har valgt den rigtige film fra resultaterne, gemmes stregkoden automatisk til cachen, så fremtidige scanninger bliver hurtige.
    </p>
  </div>
<% } %>
```

(The "save manual match" wiring is implicit: when the admin picks a movie and confirms via `/confirm-dvd/:media_type/:tmdb_id?barcode=...`, the confirm route already saves the barcode on the DVD record. **However**, that flow does NOT call `saveManualMatch` to populate `BarcodeCache`. Continue to Task 14 to wire that.)

- [ ] **Step 4: Verify the view renders without throwing**

Start: `bun run start`. Trigger a barcode that misses (any random 12-13 digit number). Confirm the new section renders.

Stop the server.

- [ ] **Step 5: Stage for commit**

Stage: `views/add-dvd.ejs`
Commit message (user runs): `feat: surface manual search fallback when barcode lookup misses`

---

### Task 14: Wire manual confirmation to cache the barcode→tmdb match

**Files:**
- Modify: `F:/MainProjects/DVinyl/routes/dvdRoutes.js`

When an admin confirms a DVD via `/confirm-dvd/:media_type/:tmdb_id?barcode=...` after a barcode lookup miss, the barcode→tmdb mapping should be saved to `BarcodeCache` so future scans skip the chain.

- [ ] **Step 1: Find the confirm handler**

In `routes/dvdRoutes.js`, find `router.get('/confirm-dvd/:media_type/:tmdb_id', ...)` (the GET that renders the confirm view) OR the POST handler that actually saves the DVD record (look for one that persists to the `Dvd` model).

- [ ] **Step 2: Add saveManualMatch call after the DVD record is saved**

Identify the route that saves the DVD record (where `Dvd.create(...)` or `Dvd.findByIdAndUpdate(...)` is called). After the successful save, if `req.body.barcode` (or wherever the barcode is in the form data — read the view to be sure) is present and is a valid 12-13 digit string, call:

```js
const { saveManualMatch } = require('../utils/barcodeLookup');

await saveManualMatch(barcode, {
    tmdb_id: tmdbId,
    media_type: mediaType,
    title: title,
    year: year,
    cover_image: coverImage
}).catch(err => console.error('[ERR] cache save on confirm:', err));
```

(Use the variable names already present in that handler. Wrap in `.catch` so a cache write failure never blocks the user's successful DVD save.)

- [ ] **Step 3: Manual verify — full loop**

Start server. Scan/search a barcode that misses. Use the manual search to find the right movie. Confirm and save the DVD.

Then re-search the same barcode. It should now redirect immediately to `/confirm-dvd/...` (cache hit).

Stop server.

- [ ] **Step 4: Stage for commit**

Stage: `routes/dvdRoutes.js`
Commit message (user runs): `feat: cache manual barcode confirmations to BarcodeCache`

---

### Task 15: End-to-end manual verification of Part 1

**Files:** none modified

- [ ] **Step 1: Start the server**

`bun run start`

- [ ] **Step 2: Test the four paths in the browser**

Log in as admin. Go to `/add-dvd`. For each:

1. **Cache miss → UPCItemDB hit:** scan/enter a non-DK barcode known to be in UPCItemDB (e.g., a US-issued DVD). Expect redirect to `/confirm-dvd/...`. Server log: `[BC] {ean} → upcitemdb found`.
2. **Cache miss → TMDb EAN-find hit:** scan a barcode known to TMDb's external_source. Expect redirect. Log: `[BC] {ean} → tmdb-ean found`.
3. **Cache miss → EAN-search hit:** scan a DK barcode (570xxx). Expect redirect. Log: `[BC] {ean} → eansearch found`.
4. **Cache hit:** re-scan any of the above. Expect immediate redirect. Log: `[BC] {ean} → cache found`.
5. **Real miss:** scan a barcode no source has. Expect `add-dvd` page with manual search UI. Log: `[BC] {ean} → chain not_found`.
6. **All errors:** disconnect from internet, scan a new barcode. Expect `add-dvd` page with error banner. Log: `[BC] {ean} → chain error`. (Re-connect after testing.)

- [ ] **Step 3: Inspect BarcodeCache documents**

Connect to MongoDB:
```
docker exec -it <mongo-container> mongosh dvinyl --eval "db.barcodecaches.find().pretty()"
```
(adjust per your local setup)

Verify documents have the expected fields and `hit_count > 0` for any re-scanned EAN.

- [ ] **Step 4: Stop server**

- [ ] **Step 5: No commit — this is verification only**

---

# PART 2 — Strip i18next, hardcode Danish

---

### Task 16: Enumerate all i18next call sites

**Files:** none modified — this task produces a report

- [ ] **Step 1: Grep every JS file for `req.t(`, `res.t(`, `locals.t(`**

Use the Grep tool with these patterns, restricted to JS files outside `node_modules/`:
- Pattern: `req\.t\(` — output `content` mode with line numbers
- Pattern: `res\.t\(` — same
- Pattern: `locals\.t\(` — same
- Pattern: `res\.locals\.t\(` — same

Save the combined output to `docs/superpowers/plans/.translation-call-sites-js.txt` (this file will be `.gitignore`'d via a one-line addition, OR just deleted at the end of Part 2; do NOT commit it).

- [ ] **Step 2: Grep every EJS file for `t(`**

Use the Grep tool with these patterns, restricted to `.ejs` files:
- Pattern: `<%[=-]\s*t\(` — captures `<%= t(` and `<%- t(` (with optional whitespace)
- Pattern: `<%\s*t\(` — captures statement-form `<% t(` (rare)

Save output to `docs/superpowers/plans/.translation-call-sites-ejs.txt`.

- [ ] **Step 3: Read `locales/en.json`**

Read the entire English locale file. This is the human-readable reference for what each key means. Keep it open in another tab during Phase 2 (Tasks 17-22). Do NOT generate a `da.json` — translate directly into the code.

- [ ] **Step 4: Verify counts are sane**

Eyeball the two report files. Roughly how many call sites total? Expectation from exploration: hundreds. If the number is in the thousands or near zero, something is wrong — re-run the greps and investigate.

- [ ] **Step 5: No commit — enumeration is workspace-only**

---

### Task 17: Hardcode Danish in `controllers/authController.js`

**Files:**
- Modify: `F:/MainProjects/DVinyl/controllers/authController.js`

- [ ] **Step 1: Read the file**

Open `controllers/authController.js` and locate every `req.t(...)` call. For each, look up the key in `locales/en.json`, write a Danish equivalent, and replace the call inline.

- [ ] **Step 2: Replace each call site**

For each occurrence:
- Simple call `req.t('foo.bar')` → `'Danish string'`
- Template-style `req.t('foo.bar', { name: x })` → `` `Danish string with ${x}` ``

Match the imperative/polite tone of the English original.

- [ ] **Step 3: Manual verify — file parses**

Run: `bun --eval "require('./controllers/authController.js'); console.log('ok')"`
Expected output: `ok`

(If the file requires DB connection on load, it may error in non-Mongo way — that's fine, you're just confirming no syntax errors.)

- [ ] **Step 4: Grep verify — no req.t left in this file**

Use Grep on `controllers/authController.js` for `req\.t\(`. Expected: zero matches.

- [ ] **Step 5: Stage for commit**

Stage: `controllers/authController.js`
Commit message (user runs): `refactor: hardcode danish in authController`

---

### Task 18: Hardcode Danish in route files (one file per commit)

This task is repeated **once per route file** that uses `req.t()`. Execute as one task per file; each gets its own commit.

**Files to process (one per iteration):**
1. `F:/MainProjects/DVinyl/routes/adminRoutes.js`
2. `F:/MainProjects/DVinyl/routes/albumRoutes.js`
3. `F:/MainProjects/DVinyl/routes/bookRoutes.js`
4. `F:/MainProjects/DVinyl/routes/dvdRoutes.js`
5. `F:/MainProjects/DVinyl/routes/gameRoutes.js`
6. `F:/MainProjects/DVinyl/routes/settingsRoutes.js`
7. `F:/MainProjects/DVinyl/routes/setupRoutes.js`

For each file, repeat:

- [ ] **Step 1: Read the file**

Open it. Find every `req.t(...)` call site using the report from Task 16.

- [ ] **Step 2: Replace each call site**

Same rules as Task 17:
- `req.t('foo.bar')` → `'Danish string'`
- `req.t('foo.bar', { name: x })` → `` `Danish string with ${x}` ``

- [ ] **Step 3: Manual verify — file parses**

Run: `bun --eval "require('./routes/<filename>'); console.log('ok')"`
Expected: `ok` (or a Mongo connection error, which is fine).

- [ ] **Step 4: Grep verify**

Grep that one file for `req\.t\(`. Expected: zero matches.

- [ ] **Step 5: Stage for commit (one file at a time)**

Stage: `routes/<filename>`
Commit message (user runs): `refactor: hardcode danish in <filename>`

---

### Task 19: Hardcode Danish in EJS views (one file per commit)

This task is repeated **once per view file** using `t()`. Per the exploration, ~25 files in `/views/` plus partials.

**Files to process (one per iteration), from exploration output:**
- `views/404.ejs`
- `views/add-book.ejs`, `views/add-dvd.ejs`, `views/add-game.ejs`, `views/add-vinyl.ejs`
- `views/admin.ejs`
- `views/book-detail.ejs`, `views/collection.ejs`
- `views/confirm-book.ejs`, `views/confirm-dvd.ejs`, `views/confirm-game.ejs`, `views/confirm-vinyl.ejs`
- `views/dvd-detail.ejs`
- `views/edit-book.ejs`, `views/edit-dvd.ejs`, `views/edit-game.ejs`, `views/edit-vinyl.ejs`
- `views/game-detail.ejs`
- `views/login.ejs`
- `views/partials/admin-visibility.ejs`, `views/partials/header.ejs`
- `views/personnalisation.ejs`
- `views/settings.ejs`
- `views/setup.ejs`
- `views/vinyl-detail.ejs`
- `views/wishlist.ejs`

For each file:

- [ ] **Step 1: Read the file**

Open it. Find every `t(...)` call using the Task 16 report.

- [ ] **Step 2: Replace each call site**

Rules:
- `<%= t('foo.bar') %>` → just `Danish text` (the EJS tags go away).
- `<%- t('foo.bar') %>` → just `Danish text` (these strings were already trusted).
- `<%= t('foo.bar', { name: user.name }) %>` → `<%= \`Danish text ${user.name}\` %>` (kept as EJS template tag because of the interpolation).
- `t('foo.bar')` inside a JS expression in EJS (e.g., `attr="<%= t('x') %>"`) → `attr="Danish text"`.

- [ ] **Step 3: Manual verify — view renders**

Start: `bun run start`. Navigate to the page that uses this view (or trigger the error condition for `404.ejs` etc.). Confirm the page renders without EJS errors and the Danish text appears correctly.

Stop the server.

- [ ] **Step 4: Grep verify**

Grep this single file for `t\(`. Expected: zero matches (or only non-translation `t(` calls — verify case by case if any remain).

- [ ] **Step 5: Stage for commit**

Stage: `views/<filename>`
Commit message (user runs): `refactor: hardcode danish in <filename>`

---

### Task 20: Remove language-switch UI from settings/personnalisation views

**Files:**
- Modify: `F:/MainProjects/DVinyl/views/settings.ejs`
- Modify: `F:/MainProjects/DVinyl/views/personnalisation.ejs`

- [ ] **Step 1: Read both files**

Look for any UI element that:
- Renders a dropdown / select / button for language choice
- Posts to a language-change endpoint
- References `user.language` or `currentLng` for display

- [ ] **Step 2: Delete the UI**

Remove the entire form / dropdown / section that handles language switching. Don't just hide it — delete it. Leave a clean layout.

If a `<form>` posts to a `/change-language` (or similar) endpoint, remove the form. The corresponding route handler will be removed in Task 21.

- [ ] **Step 3: Manual verify — settings and personnalisation pages render**

Start server. Navigate to `/settings` and `/personnalisation`. Both render without errors and without the language-switch UI.

- [ ] **Step 4: Stage for commit**

Stage: `views/settings.ejs`, `views/personnalisation.ejs`
Commit message (user runs): `refactor: remove language switch UI`

---

### Task 21: Remove language-change route handler (if it exists)

**Files:**
- Modify: one of `routes/authRoutes.js`, `routes/settingsRoutes.js`, or wherever the language-change endpoint lives

- [ ] **Step 1: Find the endpoint**

Grep all route files for handlers that update `user.language` or call `req.i18n.changeLanguage`. Likely candidates: `authRoutes.js`, `settingsRoutes.js`.

- [ ] **Step 2: Delete the handler**

Remove the entire route handler (the `router.post('/change-language', ...)` block, or whatever the pattern is). Remove imports that become unused.

If no such handler exists, skip this task and note that in the commit.

- [ ] **Step 3: Manual verify — server still starts**

Run `bun run start`. Confirm no startup errors. Stop.

- [ ] **Step 4: Stage for commit**

Stage: affected route file
Commit message (user runs): `refactor: remove language-change route handler`

---

### Task 22: Remove `language` field from User model

**Files:**
- Modify: `F:/MainProjects/DVinyl/models/User.js`

- [ ] **Step 1: Delete lines 42-46**

Current:
```js
    language: {
        type: String,
        enum: ['fr', 'en', 'de', 'es', 'it'],
        default: 'fr'
    },
```

Delete these 5 lines entirely.

- [ ] **Step 2: Also update the validation messages on the model**

The User model has Danish-needed messages embedded as validation error keys (line 13, 19, 22, 26, 27 of the file as it currently exists):
- `"auth.username_required"` → `"Brugernavn er påkrævet"`
- `"auth.email_required"` → `"Email er påkrævet"`
- `"auth.email_invalid"` → `"Ugyldig email"`
- `"auth.password_required"` → `"Adgangskode er påkrævet"`
- `"auth.password_too_short"` → `"Adgangskoden er for kort"`

Replace each.

- [ ] **Step 3: Manual verify — model loads**

Run: `bun --eval "require('./models/User.js'); console.log('ok')"`
Expected: `ok`.

- [ ] **Step 4: Stage for commit**

Stage: `models/User.js`
Commit message (user runs): `refactor: remove language field from User and hardcode danish validation messages`

---

### Task 23: Remove i18next from `app.js`

**Files:**
- Modify: `F:/MainProjects/DVinyl/app.js`

- [ ] **Step 1: Delete i18next imports near the top**

Find and delete:
```js
const i18next = require('i18next');
const i18nMiddleware = require('i18next-http-middleware');
```

- [ ] **Step 2: Delete the i18next.init() block**

Find the block starting with `i18next.init({` and ending with the closing `});`. Delete the entire block.

- [ ] **Step 3: Delete `app.use(i18nMiddleware.handle(i18next));`**

Delete this single line.

- [ ] **Step 4: Delete the language-change middleware**

Find:
```js
app.use(async (req, res, next) => {
  if (req.user && req.user.language) {
    await req.i18n.changeLanguage(req.user.language);
  }
  res.locals.t = req.t;
  res.locals.currentLng = req.language;
  res.locals.appVersion = pkg.version;
  res.locals.baseUrl = BASE_URL;
  req.io = io;
  next();
});
```

Replace with a stripped version that keeps the still-needed locals:
```js
app.use((req, res, next) => {
  res.locals.appVersion = pkg.version;
  res.locals.baseUrl = BASE_URL;
  req.io = io;
  next();
});
```

- [ ] **Step 5: Fix the IP-blocking middleware that uses `req.t`**

Find:
```js
if (blocked) return res.status(403).send(req.t('common.forbidden'));
```
Replace with:
```js
if (blocked) return res.status(403).send('Adgang nægtet');
```

- [ ] **Step 6: Manual verify — server starts**

Run: `bun run start`. Confirm startup log appears. Hit any page in the browser. Stop server.

- [ ] **Step 7: Stage for commit**

Stage: `app.js`
Commit message (user runs): `refactor: remove i18next from app.js`

---

### Task 24: Strip `currentLng` from settingsMiddleware

**Files:**
- Modify: `F:/MainProjects/DVinyl/middleware/settingsMiddleware.js`

- [ ] **Step 1: Find and delete both `currentLng` assignments**

The middleware has two:
- `res.locals.currentLng = 'en';` in the success path (around line 30 of that file)
- `res.locals.currentLng = 'en';` in the catch block at the bottom

Delete both lines.

- [ ] **Step 2: Manual verify — server starts**

Run: `bun run start`. Hit a page. Stop.

- [ ] **Step 3: Stage for commit**

Stage: `middleware/settingsMiddleware.js`
Commit message (user runs): `refactor: drop currentLng from settingsMiddleware`

---

### Task 25: Check authMiddleware for i18n references

**Files:**
- Modify (maybe): `F:/MainProjects/DVinyl/middleware/authMiddleware.js`

- [ ] **Step 1: Read the file**

Open `middleware/authMiddleware.js`. Grep within it for `req.t`, `req.i18n`, `req.language`, `currentLng`.

- [ ] **Step 2: Replace any hits with Danish strings or remove**

Same rules as Task 17. If no hits, skip the rest of this task.

- [ ] **Step 3: Manual verify and stage**

If modified: `bun --eval "require('./middleware/authMiddleware.js'); console.log('ok')"` → `ok`.
Stage `middleware/authMiddleware.js` if changed.
Commit message: `refactor: remove i18n refs from authMiddleware`

---

### Task 26: Remove `/locales/` directory

**Files:**
- Delete: `F:/MainProjects/DVinyl/locales/` (whole folder)

- [ ] **Step 1: Verify no remaining refs**

Grep entire project (excluding `node_modules/`) for `locales/`. Expected matches:
- Possibly in `.env.example` comments (leave alone, harmless)
- Possibly in old git history (irrelevant)

Should NOT match any active JS code that's been kept. If any remain, fix those files first.

- [ ] **Step 2: Delete the folder**

`rm -rf F:/MainProjects/DVinyl/locales`

- [ ] **Step 3: Verify server starts**

Run: `bun run start`. Confirm no errors. Visit several pages (`/`, `/login`, `/admin`, `/add-dvd`). Stop.

- [ ] **Step 4: Stage for commit**

Stage: the deletion of `locales/`
Commit message (user runs): `chore: remove locales directory`

---

### Task 27: Remove i18next packages from package.json

**Files:**
- Modify: `F:/MainProjects/DVinyl/package.json`

- [ ] **Step 1: Edit package.json dependencies**

Find and delete these two lines from the `"dependencies"` block:
```json
    "i18next": "^25.8.0",
    "i18next-http-middleware": "^3.9.2",
```

(Adjust the trailing comma on the previous line if needed to keep JSON valid.)

- [ ] **Step 2: Reinstall**

Run: `bun install`

Expected: no errors, lock file updates, `node_modules/i18next` and `node_modules/i18next-http-middleware` are removed.

- [ ] **Step 3: Manual verify — server starts and pages render**

Run: `bun run start`. Visit `/`, `/login`, `/admin`, `/add-dvd`, `/settings`, `/personnalisation`. All render in Danish, no errors. Stop.

- [ ] **Step 4: Stage for commit**

Stage: `package.json`, `bun.lock`
Commit message (user runs): `chore: remove i18next dependencies`

---

### Task 28: Final verification — grep gates

**Files:** none modified

- [ ] **Step 1: Run all the kill-switch greps**

Use the Grep tool over the entire project (excluding `node_modules/`):

| Pattern | Expected hits |
|---|---|
| `req\.t\(` | 0 |
| `res\.t\(` | 0 |
| `locals\.t\(` | 0 |
| `<%[=-]\s*t\(` (`.ejs` only) | 0 |
| `i18next` | 0 |
| `i18nMiddleware` | 0 |
| `req\.i18n` | 0 |
| `req\.language` | 0 |
| `currentLng` | 0 |

**If any pattern returns hits:** stop, list the files, and fix them before moving on.

- [ ] **Step 2: Delete the workspace report files from Task 16**

If `docs/superpowers/plans/.translation-call-sites-js.txt` and `.translation-call-sites-ejs.txt` exist, delete them. They were workspace-only.

- [ ] **Step 3: No commit — verification only**

---

### Task 29: Full smoke test

**Files:** none modified

- [ ] **Step 1: Start server**

`bun run start`

- [ ] **Step 2: Smoke-test these pages as admin**

For each, confirm the page renders cleanly with Danish text and no JS console errors:
1. `/` (home)
2. `/login` (log out first, then visit)
3. `/setup` (skip if admin already exists)
4. `/admin`
5. `/settings`
6. `/personnalisation`
7. `/add-vinyl`, `/add-book`, `/add-dvd`, `/add-game`
8. A detail page from each media type (`/dvd/<id>`, etc.)
9. An edit page from each media type
10. `/wishlist`
11. A non-existent URL like `/foobar` (should render `404.ejs`)

- [ ] **Step 3: Smoke-test the barcode lookup end-to-end (one more time)**

From `/add-dvd`, scan or enter:
- A barcode known to be in cache (hit count goes up)
- A new barcode (chain runs, gets cached)
- An unrecognized barcode (miss path, manual UI appears)

- [ ] **Step 4: Stop server**

- [ ] **Step 5: No commit — final verification only**

---

## Done

Both Part 1 and Part 2 are complete. The user reviews the staged commits and runs:
- `git log --oneline` to see the commit list
- Whatever git push / PR workflow they prefer

---

## Self-review notes

**Spec coverage check:**

Part 1:
- ✅ BarcodeCache model (Task 1)
- ✅ utils/barcodeLookup.js exports lookupBarcode / saveManualMatch / forceRelookup (Tasks 3, 9, 10)
- ✅ Cache read with 7-day TTL on not_found (Task 4)
- ✅ Cache write helpers (Task 4)
- ✅ Lookup chain: cache → UPC (skip if DK) → TMDb-EAN → EAN-search → TMDb resolver (Tasks 5-9)
- ✅ Error vs miss distinction → status: 'error' vs 'not_found' (Task 9)
- ✅ Logging format `[BC] {ean} → {source} {status}` (Task 3)
- ✅ EAN_SEARCH_TOKEN env (Task 2)
- ✅ HTTP /api/barcodes/:ean/manual route (Task 11)
- ✅ Replace inline logic in dvdRoutes (Task 12)
- ✅ Frontend manual fallback (Task 13)
- ✅ Wire confirm → cache (Task 14)
- ✅ End-to-end verification (Task 15)

Part 2:
- ✅ Enumerate call sites first (Task 16)
- ✅ Replace each file's calls (Tasks 17-19)
- ✅ Remove language-switch UI (Task 20)
- ✅ Remove language-change route (Task 21)
- ✅ Remove User.language field (Task 22)
- ✅ Strip i18next from app.js (Task 23)
- ✅ Strip currentLng from settingsMiddleware (Task 24)
- ✅ Check authMiddleware (Task 25)
- ✅ Delete /locales/ (Task 26)
- ✅ Remove npm deps (Task 27)
- ✅ Grep gates (Task 28)
- ✅ Full smoke test (Task 29)

**Placeholder scan:** No TBDs, no "implement later" — every code step has the full code.

**Type consistency:** All function signatures match between Tasks 3 (skeleton), 9 (real lookupBarcode), 10 (real saveManualMatch / forceRelookup). The Result shape used in Task 12's dvdRoutes integration matches what Task 9 returns. `BarcodeCache` field names are consistent across Tasks 1, 4, 9, 10.

**Known small gaps** (acceptable):
- The TMDb title resolver isn't directly unit-testable since it's not exported. Coverage is via end-to-end testing in Task 15. Acceptable because: no test framework exists in the project, the resolver is small and has clear inputs/outputs, and it's exercised by every chain path in Task 15.
- Task 13's "verify if manual search UI exists" is conditional rather than prescribed exactly. This is intentional — the executing agent needs to read the existing view to make the call.
