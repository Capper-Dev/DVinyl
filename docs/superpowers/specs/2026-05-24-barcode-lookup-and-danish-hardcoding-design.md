# Barcode Lookup Service + Danish-Only Hardcoding

**Date:** 2026-05-24
**Status:** Draft for review
**Author:** brainstorming session

---

## Summary

Two bundled changes:

1. **Barcode lookup service** with persistent local cache, fronting UPCItemDB (free) → TMDb EAN-find (free) → EAN-search.org (paid, last resort). Each EAN is queried against paid sources at most once. Used by DVD scan flow today, ready for games later.
2. **Strip i18next entirely.** Project becomes Danish-only. Remove the i18next stack, `/locales` folder, `User.language` field, and all `req.t()` / `t()` calls in routes and EJS views — replacing them with hardcoded Danish strings.

These two changes are independent in scope but bundled into one spec and one implementation plan at user request.

---

## Part 1 — Barcode Lookup Service

### Goal

Resolve a scanned EAN/UPC barcode to a TMDb movie/series match, caching every successful and (briefly) failed lookup. Replace ~90 lines of inline lookup logic in `routes/dvdRoutes.js` with a single function call.

### Scope

- **In scope:** DVDs (replaces existing inline logic). The service is built so games can adopt it later without changes to the service itself.
- **Out of scope:** Albums (Discogs by barcode), books (Hardcover by ISBN). Those have their own lookup paths and stay untouched. Games scanning UI is not wired up in this change.

### Public interface

`utils/barcodeLookup.js` exports:

```js
module.exports = {
  lookupBarcode,    // (ean) -> Promise<Result>
  saveManualMatch,  // (ean, { tmdb_id, media_type, title, year, cover_image }) -> Promise<Result>
  forceRelookup     // (ean) -> Promise<Result>   bypasses cache, refreshes entry
};
```

**Result shape:**

```js
// hit
{ status: 'found', ean, tmdb_id, media_type, title, year, cover_image, source }

// miss (real not-found from upstream)
{ status: 'not_found', ean, source: 'cache' | 'chain', checked_at }

// upstream error (all sources failed with network/quota errors, not real misses)
{ status: 'error', ean }

// invalid input
{ status: 'invalid', ean }
```

`source` is one of: `'cache' | 'upcitemdb' | 'tmdb-ean' | 'eansearch' | 'manual'`.

### Data model

New Mongoose model `models/BarcodeCache.js`:

```js
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
```

- `ean` is primary lookup key, unique.
- `status: 'not_found'` rows store only `checked_at` for expiry tracking.
- `raw_title` keeps what UPCItemDB/EAN-search returned before TMDb resolution — useful when EAN-search returns "Inception Blu-ray Steelbook" but TMDb match fails.
- `hit_count` increments on every cache hit for low-cost analytics.
- Writes use `findOneAndUpdate({ ean }, { $set: ..., $inc: { hit_count: 1 } }, { upsert: true })` for race-safety.
- No migration needed — new collection.

### Lookup chain

`lookupBarcode(ean)`:

1. **Normalize:** strip spaces/dashes; validate `/^\d{12,13}$/`. Otherwise return `{ status: 'invalid', ean }`.

2. **Cache read:** `BarcodeCache.findOne({ ean })`.
   - `status: 'found'` → increment `hit_count`, return.
   - `status: 'not_found'` and `Date.now() - checked_at < 7 days` → increment `hit_count`, return cached miss.
   - `status: 'not_found'` and `≥ 7 days old` → fall through; chain will update in place.
   - No row → fall through.

3. **Danish detection:** if `ean.startsWith('570')`, skip step 4, jump to step 6 (UPCItemDB never has Danish barcodes).

4. **UPCItemDB:** `GET https://api.upcitemdb.com/prod/trial/lookup?upc={ean}`.
   - On `items[0]`: extract title (strip format keywords via existing regex), extract year from title+description regex. Pass to step 7 (TMDb resolver). If resolver returns a single confident match: cache as `source: 'upcitemdb'` and return.
   - Network error or no items: continue.

5. **TMDb EAN-find:** `GET https://api.themoviedb.org/3/find/{ean}?api_key=...&external_source=ean_id&language=da-DK&region=DK`.
   - If `movie_results[0]` or `tv_results[0]` exists: format the hit, cache as `source: 'tmdb-ean'`, return.
   - Otherwise continue.

6. **EAN-search.org:** `GET https://api.ean-search.org/api?token=...&op=barcode-lookup&ean={ean}&format=json&language=2`.
   - HTTP 402 (quota) / 429 (rate-limited) → log + continue. Don't cache as not_found — it's our error, not a real miss.
   - Response `[{ name, categoryName, ... }]` → take `name`, clean format keywords, extract year, run step 7. If resolver returns a confident match: cache as `source: 'eansearch'` (also store `raw_title`) and return.
   - Empty array or `<Error>` response → continue.

7. **TMDb title resolver (helper):**
   - Clean title: strip `\b(DVD|Blu-?ray|4K|UHD|Ultra HD|Coffret|Edition|Steelbook|Combo|Pack)\b` and bracketed text. Collapse whitespace.
   - `GET /search/movie?query={title}&year={year}&language=da-DK&region=DK` — if exactly 1 result, return as movie.
   - Else `GET /search/tv?query={title}&first_air_date_year={year}&language=da-DK` — if exactly 1 result, return as tv.
   - Both ambiguous or zero results → return `null`. Caller treats as miss for that branch (doesn't cache, lets next source try). This is deliberate: an ambiguous UPCItemDB hit must not poison the cache; let EAN-search try its cleaner title.

8. **All sources exhausted with real misses:** upsert `{ status: 'not_found', checked_at: now }`, return `{ status: 'not_found', ean, source: 'chain', checked_at }`.

9. **All sources exhausted with errors (no real misses, only upstream failures):** return `{ status: 'error', ean }` without writing to cache. Caller shows "scan failed, try again" instead of "barcode not in database".

### Error handling

| Condition | Behavior |
|---|---|
| Network timeout / 5xx | Log, skip source, continue chain |
| HTTP 401 (bad token) / 402 (quota) / 429 (rate limit) | Log, skip source, continue chain. Never cache miss. |
| HTTP 200 + empty/not-found response | Treat as real miss for that source, continue chain. If all are real misses → cache `not_found`. |
| TMDb resolver ambiguous (>1 result) | Don't cache, fall through to next source. |
| All sources errored (no real misses) | Return `status: 'error'`, no cache write. |

### Timeouts and rate limits

- Axios per-call timeout: 10s. Worst case chain: ~30s.
- EAN-search ToS: max 1 query/sec. Human-paced scans (one per HTTP request) stay well under. No client-side throttle needed.

### Environment variables

Add to `.env.example`:
```
# Barcode lookup (DVDs)
EAN_SEARCH_TOKEN=YourEANSearchTokenHere
```

`TMDB_API_KEY` already present. UPCItemDB free tier requires no auth.

**Missing-token behavior:**
- No `TMDB_API_KEY` → throw on module load (matches existing pattern).
- No `EAN_SEARCH_TOKEN` → silently skip step 6, log once at startup. Service still works with UPC + TMDb-EAN only.

### HTTP layer

New file `routes/barcodeRoutes.js`, mounted at `BASE_URL + '/api/barcodes'`:

```
POST /api/barcodes/:ean/manual
  auth: requireAuth + requireAdmin
  body: { tmdb_id, media_type, title, year, cover_image }
  -> saveManualMatch(ean, body)
  -> 200 { ok: true, cached: <Result> }
```

**No `GET /api/barcodes/:ean` exposed.** Lookup is server-side only, called from `dvdRoutes.js`. Exposing it as HTTP would let any visitor burn EAN-search credits.

### Logging

One log line per lookup, matching project's existing `[ERR]`/`[SETUP]`/`[MIGRATION]` tag style:

```
[BC] 5705643011234 → eansearch found
[BC] 0883929123456 → upcitemdb found
[BC] 5701234567890 → chain not_found
[BC] 5702345678901 → error eansearch:429
```

### Integration with dvdRoutes.js

**Replace** the `/search-dvds` POST handler's `if (isBarcode) { ... }` block (~90 lines: UPC lookup, TMDb EAN-find, barcode-shaped TMDb search) with:

```js
const { lookupBarcode } = require('../utils/barcodeLookup');

if (isBarcode) {
  const result = await lookupBarcode(cleanQuery);

  if (result.status === 'found') {
    return res.redirect(
      `/confirm-dvd/${result.media_type}/${result.tmdb_id}?barcode=${result.ean}`
    );
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

**Unchanged:**
- Non-barcode TMDb multi-search path (text queries).
- `/confirm-dvd/:media_type/:tmdb_id` — receives `?barcode=X` and saves on DVD record.
- `formatTMDBItem` helper. The barcode service uses its own internal version (small duplication, keeps modules independent).

### Frontend touchpoint (flagged, not specified here)

The existing `add-dvd.ejs` view handles `barcode_no_results`. Verify it offers a TMDb title-search UI so admins can pick the right movie when auto-lookup fails, and `POST` to `/api/barcodes/:ean/manual` on confirm. If the UI doesn't exist yet, the implementation plan will add a minimal form. This is flagged as a frontend task; the service itself is complete without it.

### Files touched (Part 1)

| File | Action |
|---|---|
| `utils/barcodeLookup.js` | New (~250 lines) |
| `models/BarcodeCache.js` | New (~25 lines) |
| `routes/barcodeRoutes.js` | New (~20 lines) |
| `app.js` | +1 line: mount `barcodeRoutes` |
| `.env.example` | +2 lines: `EAN_SEARCH_TOKEN` |
| `routes/dvdRoutes.js` | -90 lines / +15 lines in `/search-dvds` handler |
| `views/add-dvd.ejs` | Possibly +manual-search form (flagged, not specified) |

---

## Part 2 — Strip i18next, hardcode Danish

### Goal

Remove the i18next stack entirely. Every translation call site (`req.t('foo.bar')`, `t('foo.bar')`, `<%= t(...) %>`) gets replaced with the Danish string from `locales/da.json`. Project becomes Danish-only.

### Why bundled

User decision. Tradeoffs (mixed PR sprawl, harder rollback) were discussed and accepted.

### Translation source

**No JSON locale file is used.** Each `req.t('key.path')` and `<%= t('key.path') %>` call site is replaced with the Danish string written directly into the code by hand (or LLM-assist during the replacement pass).

The keys in `locales/en.json` are useful as a reference list of what strings exist and roughly what they mean — read it once at the start of Phase B to understand context, then write Danish equivalents directly. Don't generate a `da.json` intermediate.

After Part 2 is complete, the entire `/locales/` directory is deleted along with the English JSON.

### Scope of removal

**Files / artifacts to delete:**
- `/locales/` directory (entire folder)
- `i18next` and `i18next-http-middleware` dependencies in `package.json`
- `User.language` schema field in `models/User.js` (line 42)

**Files to modify:**
- `app.js` — remove i18next init block (lines ~80-95), remove `app.use(i18nMiddleware.handle(i18next))`, remove the `req.i18n.changeLanguage(...)` middleware, remove `res.locals.t = req.t` and `res.locals.currentLng = req.language` lines. Keep `res.locals.appVersion`, `baseUrl`, etc.
- `middleware/settingsMiddleware.js` — remove `res.locals.currentLng = 'en'` line (and the duplicate in the catch block).
- `middleware/authMiddleware.js` (if it references `req.t` — to be confirmed).
- All route files using `req.t`: `controllers/authController.js`, `routes/{adminRoutes,albumRoutes,bookRoutes,dvdRoutes,gameRoutes,settingsRoutes,setupRoutes}.js` — replace each `req.t('key.path')` call site (the implementation plan will enumerate per-file counts via grep before starting).
- All EJS views using `t(...)`: 25 files identified during exploration (listed in exploration output). Per-file call counts to be enumerated in the implementation plan.
- User profile / settings views: remove the language-switch UI (if present in `views/settings.ejs` or `views/personnalisation.ejs`).

**File-by-file expected changes:** the implementation plan will enumerate every call site before any code changes (grep + per-file counts). Exact replacement total unknown until enumerated; rough order of magnitude is hundreds of call sites across ~30 files.

### Replacement strategy

1. **Phase A — enumerate:**
   - Grep every JS file (excluding `node_modules/`) for `req.t(`, `res.t(`, `locals.t(`. Output per-file lists of call sites with line numbers and the key string.
   - Grep every EJS file for `<%= t(`, `<%- t(`, `<% t(`. Same output.
   - Read `locales/en.json` once to have the English context handy for translation. Do NOT generate a `da.json`.
   - Result: a complete punch list of every call site to be replaced, grouped by file.

2. **Phase B — code replacement (manual, file-by-file):**
   - Work through the punch list one file at a time. For each call site, write the Danish text directly in place.
   - **JS files:** `req.t('foo.bar')` → `'Danish text'`. Use template literals if interpolation is needed: `` `Hej ${user.name}` ``.
   - **EJS — simple:** `<%= t('foo.bar') %>` → just Danish text (no EJS tags).
   - **EJS — unsafe:** `<%- t('foo.bar') %>` → Danish text (these strings were already trusted, plain text now).
   - **EJS — interpolated:** `<%= t('foo.bar', { name: user.name }) %>` → `<%= \`Hej ${user.name}\` %>` or equivalent EJS. Resolved case-by-case.
   - **Imperative tone for buttons/actions, polite for messages.** Match the existing English voice where it makes sense.
   - Commit per file (or per route group) so individual translation choices are reviewable.

3. **Phase C — remove the i18n stack:**
   - Remove i18next imports from `app.js`.
   - Remove `app.use(i18nMiddleware.handle(i18next))` and the `req.i18n.changeLanguage(...)` middleware block.
   - Remove `res.locals.t = req.t` and `res.locals.currentLng = req.language`.
   - Remove `res.locals.currentLng = 'en'` from `middleware/settingsMiddleware.js` (both the happy-path and catch-block instances).
   - Remove `language` field from `models/User.js`.
   - Remove `/locales/` directory entirely.
   - Remove `i18next` and `i18next-http-middleware` from `package.json` dependencies. Run `bun install`.
   - Remove language-switch UI from `views/settings.ejs` and/or `views/personnalisation.ejs` if present.

4. **Phase D — verification:**
   - Grep for `req.t(`, `res.t(`, `locals.t(`, `<%= t(`, `<%- t(`, `i18next`, `i18nMiddleware`, `req.i18n`, `req.language`, `currentLng` — all must return zero hits outside `node_modules/`.
   - Run `bun run start`, smoke-test login + every page type (home, music, books, dvd, games, admin, settings, setup wizard).
   - `bun run build` (per CLAUDE.md global rules) — verify success.

### Edge cases

- **`User.language` field:** safe to remove without migration. Mongoose silently drops fields not in schema on next save; existing documents keep the column in MongoDB but it becomes inert. No data loss for any other field.
- **Language-switch UI:** must be removed, not just hidden, to avoid dead form posts. Search settings.ejs and personnalisation.ejs.
- **Hardcoded fallback values:** existing code has `res.locals.currentLng = 'en'` in settings middleware catch blocks — these become dead code but should be deleted, not left.
- **Browser language detection (`i18next-http-middleware` LanguageDetector):** removed with the package.

### Files touched (Part 2)

| File | Action |
|---|---|
| `/locales/*.json` | Delete folder (5 files) |
| `package.json` + lock | Remove `i18next` + `i18next-http-middleware` deps |
| `app.js` | Remove ~20 lines of i18n setup |
| `middleware/settingsMiddleware.js` | Remove `currentLng` lines |
| `models/User.js` | Remove `language` field |
| `controllers/authController.js` | Replace `req.t()` calls |
| `routes/*.js` (8 files) | Replace `req.t()` calls |
| `views/*.ejs` (~25 files) | Replace `t()` calls |
| `views/settings.ejs` or `personnalisation.ejs` | Remove language-switch UI |

---

## Risk assessment (bundled)

| Risk | Mitigation |
|---|---|
| Part 2 breaks an unrelated view's render and barcode lookup gets blamed | Run Part 1 and Part 2 as **separate commits** within the same PR. If user wants to revert one, `git revert <commit>` works on either independently. |
| Missed call site sneaks past replacement | Phase D's grep gate (zero hits for `req.t(`, `t(`, etc.) catches this before merge. |
| EAN-search credits burned by bug | `lookupBarcode` only called server-side; auth middleware on dvdRoutes already requires admin. The 7-day cache + cache-first read prevent repeat hits. |
| Mocked `req.t()` in tests breaks | No test suite exists in the project (`"test": "echo \"Error: no test specified\""` in package.json). Non-issue. |

---

## Open questions

None — all resolved during brainstorming. Listed here as defaults if user wants to revisit:

- **Negative cache TTL:** 7 days. (EAN-search ToS asks for no negative caching; 7 days is the compromise.)
- **TMDb region:** `region=DK` added to all TMDb calls in the new service.
- **Module location:** `utils/barcodeLookup.js`.
- **Games scope:** service is games-ready but games scanning UI not built in this change.
- **Return shape:** service resolves all the way to a TMDb match, not just title.

---

## Out of scope (explicit)

- Albums/books lookup chains.
- Games scanning UI.
- Any test suite (project has none).
- Migrating existing `User.language` data.
- Renaming or restructuring the EJS views beyond text replacement.
- Adding new languages later (this is a one-way door per user decision).
