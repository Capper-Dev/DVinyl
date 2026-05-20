# Collections + UI Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-type named collections (dvd/game/book) so multiple people can maintain separate lists, and clean up the UI by removing footer, simplifying header, and reducing visual noise.

**Architecture:** New `Collection` mongoose model (name + type). `Item` base schema gets an optional `collection` ObjectId ref. A new `collectionRoutes.js` handles CRUD. Existing collection page gets a pill filter; confirm/edit pages get a collection dropdown. UI changes are purely in EJS partials and views.

**Tech Stack:** Node.js/Express, Mongoose, EJS, Tailwind CSS (CDN), Flowbite dropdowns

---

### Task 1: Collection model

**Files:**
- Create: `models/Collection.js`
- Modify: `models/Item.js`

- [ ] **Step 1: Create `models/Collection.js`**

```js
const mongoose = require('mongoose');

const collectionSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    type: { type: String, required: true, enum: ['dvd', 'game', 'book'] },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Collection', collectionSchema);
```

- [ ] **Step 2: Add `collection` field to `models/Item.js`**

Add after the `added_at` line:
```js
collection: { type: mongoose.Schema.Types.ObjectId, ref: 'Collection', default: null }
```

Full updated schema block:
```js
const itemSchema = new mongoose.Schema({
  title: { type: String, required: true },
  year: String,
  cover_image: String,
  user_image: String,
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  in_wishlist: { type: Boolean, default: false },
  comments: { type: String, default: '' },
  location: { type: String, default: '' },
  quantity: { type: Number, default: 1, min: 1 },
  genre: String,
  genres: [String],
  styles: [String],
  barcode: { type: String, default: '' },
  barcode_locked: { type: Boolean, default: false },
  added_at: { type: Date, default: Date.now },
  collection: { type: mongoose.Schema.Types.ObjectId, ref: 'Collection', default: null }
}, options);
```

- [ ] **Step 3: Verify syntax**
```bash
node --check models/Collection.js && node --check models/Item.js && echo OK
```
Expected: `OK`

- [ ] **Step 4: Commit**
```bash
git add models/Collection.js models/Item.js
git commit -m "feat: add Collection model and collection field to Item"
```

---

### Task 2: Collection API routes

**Files:**
- Create: `routes/collectionRoutes.js`
- Modify: `app.js`

- [ ] **Step 1: Create `routes/collectionRoutes.js`**

```js
const express = require('express');
const router = express.Router();
const Collection = require('../models/Collection');
const Item = require('../models/Item');

router.get('/', async (req, res) => {
    const { type } = req.query;
    if (!['dvd', 'game', 'book'].includes(type)) {
        return res.status(400).json({ error: 'Invalid type' });
    }
    const collections = await Collection.find({ type }).sort({ createdAt: 1 }).lean();
    res.json(collections);
});

router.post('/', async (req, res) => {
    const { name, type } = req.body;
    if (!name || !['dvd', 'game', 'book'].includes(type)) {
        return res.status(400).json({ error: 'name and valid type required' });
    }
    const col = await Collection.create({ name: name.trim(), type });
    res.json(col);
});

router.delete('/:id', async (req, res) => {
    await Collection.findByIdAndDelete(req.params.id);
    await Item.updateMany({ collection: req.params.id }, { $set: { collection: null } });
    res.json({ success: true });
});

module.exports = router;
```

- [ ] **Step 2: Mount route in `app.js`**

Add import near the other route imports (around line 41):
```js
const collectionRoutes = require('./routes/collectionRoutes.js');
```

Add mount near the other `app.use` route mounts (around line 203):
```js
app.use(BASE_URL + '/api/collections', collectionRoutes);
```

- [ ] **Step 3: Verify syntax**
```bash
node --check routes/collectionRoutes.js && node --check app.js && echo OK
```
Expected: `OK`

- [ ] **Step 4: Commit**
```bash
git add routes/collectionRoutes.js app.js
git commit -m "feat: collection CRUD API routes"
```

---

### Task 3: Collection dropdown on confirm-dvd page

**Files:**
- Modify: `views/confirm-dvd.ejs`
- Modify: `routes/dvdRoutes.js`

- [ ] **Step 1: Pass collections to confirm-dvd render in `routes/dvdRoutes.js`**

In the `GET /confirm-dvd/:media_type/:tmdb_id` handler, add before `res.render`:
```js
const Collection = require('../models/Collection');
```
Add at top of file with other requires.

Then inside the handler, replace the `res.render('confirm-dvd', {...})` call with:
```js
const collections = await Collection.find({ type: 'dvd' }).sort({ createdAt: 1 }).lean();

res.render('confirm-dvd', {
    dvd: dvdData,
    scanned_barcode: req.query.barcode || '',
    user: res.locals.user,
    locations,
    genres,
    collections,
    currentType: 'dvd'
});
```

Also pass `collections` in the `GET /dvd/edit/:id` handler:
```js
const Collection = require('../models/Collection'); // already added above
// inside handler, before res.render:
const collections = await Collection.find({ type: 'dvd' }).sort({ createdAt: 1 }).lean();
res.render('edit-dvd', { dvd: dvd.toObject(), user: res.locals.user, locations, genres, collections, currentType: 'dvd' });
```

- [ ] **Step 2: Add collection dropdown to `views/confirm-dvd.ejs`**

Find the save form (contains `action="<%= baseUrl %>/save-dvd"`). Add this field inside the form before the submit button:

```html
<div>
    <label class="block text-xs font-semibold uppercase tracking-wider opacity-60 mb-2">Collection</label>
    <select name="collection_id" class="w-full card-theme border border-black/10 dark:border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none">
        <option value="">Uncategorized</option>
        <% if (typeof collections !== 'undefined') { %>
        <% collections.forEach(function(col) { %>
        <option value="<%= col._id %>"><%= col.name %></option>
        <% }) %>
        <% } %>
    </select>
</div>
```

- [ ] **Step 3: Store `collection_id` in `save-dvd` handler in `routes/dvdRoutes.js`**

In the `POST /save-dvd` handler, add `collection_id` to destructured body:
```js
const {
    mongo_id, title, director, studio, year, duration,
    tmdb_id, media_type, format, zone, barcode, barcode_locked, is_boxset,
    cover_image, in_wishlist, comments, location, genre, genres, styles,
    watchStatus, user_rating, quantity, collection_id
} = req.body;
```

When updating existing dvd, add:
```js
dvd.collection = collection_id || null;
```

When creating new dvd via `Dvd.create({...})`, add to the object:
```js
collection: collection_id || null,
```

- [ ] **Step 4: Verify syntax**
```bash
node --check routes/dvdRoutes.js && echo OK
```
Expected: `OK`

- [ ] **Step 5: Commit**
```bash
git add views/confirm-dvd.ejs routes/dvdRoutes.js
git commit -m "feat: collection dropdown on DVD confirm/save"
```

---

### Task 4: Collection dropdown on confirm-game and save-game

**Files:**
- Modify: `views/confirm-game.ejs`
- Modify: `routes/gameRoutes.js`

- [ ] **Step 1: Pass collections to confirm-game and edit-game in `routes/gameRoutes.js`**

Add at top with other requires:
```js
const Collection = require('../models/Collection');
```

In `GET /confirm-game/:igdb_id` handler, before `res.render`:
```js
const collections = await Collection.find({ type: 'game' }).sort({ createdAt: 1 }).lean();
```
Add `collections` to the render call.

In `GET /game/edit/:id` handler, before `res.render`:
```js
const collections = await Collection.find({ type: 'game' }).sort({ createdAt: 1 }).lean();
```
Add `collections` to the render call.

- [ ] **Step 2: Add collection dropdown to `views/confirm-game.ejs`**

Inside the save form, add before submit button:
```html
<div>
    <label class="block text-xs font-semibold uppercase tracking-wider opacity-60 mb-2">Collection</label>
    <select name="collection_id" class="w-full card-theme border border-black/10 dark:border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none">
        <option value="">Uncategorized</option>
        <% if (typeof collections !== 'undefined') { %>
        <% collections.forEach(function(col) { %>
        <option value="<%= col._id %>"><%= col.name %></option>
        <% }) %>
        <% } %>
    </select>
</div>
```

- [ ] **Step 3: Store `collection_id` in `save-game` handler**

Add `collection_id` to destructured body in `POST /save-game`. When updating, add `game.collection = collection_id || null;`. When creating, add `collection: collection_id || null` to `Game.create({...})`.

- [ ] **Step 4: Verify syntax**
```bash
node --check routes/gameRoutes.js && echo OK
```
Expected: `OK`

- [ ] **Step 5: Commit**
```bash
git add views/confirm-game.ejs routes/gameRoutes.js
git commit -m "feat: collection dropdown on game confirm/save"
```

---

### Task 5: Collection dropdown on confirm-book and save-book

**Files:**
- Modify: `views/confirm-book.ejs` (or equivalent — check `views/` for the book confirm view name)
- Modify: `routes/bookRoutes.js`

- [ ] **Step 1: Find the book confirm view name**
```bash
ls F:/MainProjects/DVinyl/views/ | grep -i book
```

- [ ] **Step 2: Pass collections to book confirm and edit handlers in `routes/bookRoutes.js`**

Add at top:
```js
const Collection = require('../models/Collection');
```

In the confirm/detail GET handler and edit GET handler, before `res.render`:
```js
const collections = await Collection.find({ type: 'book' }).sort({ createdAt: 1 }).lean();
```
Add `collections` to the render call.

- [ ] **Step 3: Add collection dropdown to the book confirm view**

Same pattern as DVD and game:
```html
<div>
    <label class="block text-xs font-semibold uppercase tracking-wider opacity-60 mb-2">Collection</label>
    <select name="collection_id" class="w-full card-theme border border-black/10 dark:border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none">
        <option value="">Uncategorized</option>
        <% if (typeof collections !== 'undefined') { %>
        <% collections.forEach(function(col) { %>
        <option value="<%= col._id %>"><%= col.name %></option>
        <% }) %>
        <% } %>
    </select>
</div>
```

- [ ] **Step 4: Store `collection_id` in `save-book` handler**

Add `collection_id` to destructured body. When updating, add `book.collection = collection_id || null;`. When creating, add `collection: collection_id || null`.

- [ ] **Step 5: Verify syntax**
```bash
node --check routes/bookRoutes.js && echo OK
```
Expected: `OK`

- [ ] **Step 6: Commit**
```bash
git add views/confirm-book.ejs routes/bookRoutes.js
git commit -m "feat: collection dropdown on book confirm/save"
```

---

### Task 6: Collection filter on collection page

**Files:**
- Modify: `routes/albumRoutes.js` (handles `/collection` route)
- Modify: `views/collection.ejs`

- [ ] **Step 1: Load collections and apply filter in `GET /collection` handler in `routes/albumRoutes.js`**

Add at top:
```js
const Collection = require('../models/Collection');
```

Inside the `GET /collection` handler, after determining `activeType`, add:
```js
const typeToCollectionType = { dvd: 'dvd', games: 'game', books: 'book' };
const collectionType = typeToCollectionType[activeType];
let collectionsForType = [];
let activeCollectionId = req.query.collection || null;

if (collectionType) {
    collectionsForType = await Collection.find({ type: collectionType }).sort({ createdAt: 1 }).lean();
}
```

Then apply collection filter to the item query. Find where `Item.find({...})` is called and add to the query object:
```js
if (activeCollectionId === 'uncategorized') {
    query.collection = null;
} else if (activeCollectionId) {
    query.collection = activeCollectionId;
}
```

Pass to render:
```js
collectionsForType,
activeCollectionId,
```

- [ ] **Step 2: Add collection pill filter to `views/collection.ejs`**

Find where the type/format toggle buttons are rendered. Add the collection filter row above the item grid, rendered only when `collectionsForType.length > 0`:

```html
<% if (typeof collectionsForType !== 'undefined' && collectionsForType.length > 0) { %>
<div class="flex flex-wrap gap-2 mb-4">
    <a href="?type=<%= currentType %>"
       class="px-3 py-1 rounded-full text-xs font-semibold transition <%= !activeCollectionId ? 'bg-primary-theme text-white' : 'card-theme opacity-70 hover:opacity-100' %>">
        All
    </a>
    <a href="?type=<%= currentType %>&collection=uncategorized"
       class="px-3 py-1 rounded-full text-xs font-semibold transition <%= activeCollectionId === 'uncategorized' ? 'bg-primary-theme text-white' : 'card-theme opacity-70 hover:opacity-100' %>">
        Uncategorized
    </a>
    <% collectionsForType.forEach(function(col) { %>
    <a href="?type=<%= currentType %>&collection=<%= col._id %>"
       class="px-3 py-1 rounded-full text-xs font-semibold transition <%= activeCollectionId && activeCollectionId.toString() === col._id.toString() ? 'bg-primary-theme text-white' : 'card-theme opacity-70 hover:opacity-100' %>">
        <%= col.name %>
    </a>
    <% }) %>
</div>
<% } %>
```

- [ ] **Step 3: Add "New Collection" button and modal to `views/collection.ejs`**

Find the page header area (near the title and existing Add button). Add a "New Collection" button:
```html
<button onclick="document.getElementById('new-collection-modal').classList.remove('hidden')"
        class="px-3 py-1.5 text-xs font-semibold card-theme border border-black/10 dark:border-white/10 rounded-lg hover:opacity-80 transition flex items-center gap-2">
    <i class="fa-solid fa-folder-plus"></i> New Collection
</button>
```

Add the modal before the closing `<%- include('partials/footer') %>` (or at the end of body):
```html
<div id="new-collection-modal" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
    <div class="card-theme rounded-xl p-6 w-full max-w-sm shadow-2xl">
        <h3 class="text-base font-bold mb-4">New Collection</h3>
        <input id="new-collection-name" type="text" placeholder="e.g. Casper's Games"
               class="w-full card-theme border border-black/10 dark:border-white/10 rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none">
        <div class="flex gap-2 justify-end">
            <button onclick="document.getElementById('new-collection-modal').classList.add('hidden')"
                    class="px-4 py-2 text-sm rounded-lg card-theme opacity-70 hover:opacity-100 transition">Cancel</button>
            <button onclick="createCollection()"
                    class="px-4 py-2 text-sm font-semibold rounded-lg bg-primary-theme text-white hover:opacity-90 transition">Create</button>
        </div>
    </div>
</div>

<script>
async function createCollection() {
    const name = document.getElementById('new-collection-name').value.trim();
    const type = '<%= currentType === "dvd" ? "dvd" : currentType === "games" ? "game" : "book" %>';
    if (!name) return;
    const res = await fetch('<%= baseUrl %>/api/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, type })
    });
    if (res.ok) {
        window.location.reload();
    }
}
</script>
```

- [ ] **Step 4: Verify syntax**
```bash
node --check routes/albumRoutes.js && echo OK
```
Expected: `OK`

- [ ] **Step 5: Commit**
```bash
git add routes/albumRoutes.js views/collection.ejs
git commit -m "feat: collection filter pills and new collection modal on collection page"
```

---

### Task 7: UI overhaul — header simplification

**Files:**
- Modify: `views/partials/header.ejs`

- [ ] **Step 1: Replace the ⋮ dropdown with a single theme toggle button**

Find and replace the entire dropdown block (from `<button type="button" ... id="user-menu-button"` through the closing `</div>` of `id="user-dropdown"`) with:

```html
<button id="theme-toggle" class="p-2 rounded-full bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20 transition text-[var(--text-main)]">
    <i id="theme-icon" class="fa-solid fa-moon w-4 text-center"></i>
</button>
```

- [ ] **Step 2: Verify the theme toggle JS still works**

Search `views/partials/header.ejs` for `theme-toggle` and `theme-icon` — ensure the existing JS handler that switches icons and dark class is still present further down in the file. If it was inside the removed dropdown, move it to a `<script>` block at the bottom of header.ejs:

```html
<script>
const themeToggle = document.getElementById('theme-toggle');
const themeIcon = document.getElementById('theme-icon');
if (themeToggle) {
    themeToggle.addEventListener('click', () => {
        const html = document.documentElement;
        html.classList.toggle('dark');
        const isDark = html.classList.contains('dark');
        themeIcon.className = isDark ? 'fa-solid fa-moon w-4 text-center' : 'fa-solid fa-sun w-4 text-center';
        document.cookie = `i18next=; theme=${isDark ? 'dark' : 'light'}; path=/`;
        fetch('<%= baseUrl %>/settings/theme', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ theme: isDark ? 'dark' : 'light' })
        }).catch(() => {});
    });
}
</script>
```

- [ ] **Step 3: Commit**
```bash
git add views/partials/header.ejs
git commit -m "ui: simplify header — theme toggle only, remove dropdown"
```

---

### Task 8: UI overhaul — remove footer, move scripts

**Files:**
- Modify: `views/partials/footer.ejs`
- Modify: `views/partials/header.ejs` (add SW script)

- [ ] **Step 1: Move service worker + loader scripts from `footer.ejs` to end of `header.ejs`**

Add before the closing `</head>` tag in `header.ejs` (or just before `</body>` at bottom):

```html
<script>
window.addEventListener('load', function () {
    const loader = document.getElementById('page-loader');
    if (loader) {
        loader.classList.add('opacity-0');
        setTimeout(() => { loader.style.display = 'none'; }, 500);
    }
});
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('<%= baseUrl %>/sw.js')
            .then(reg => console.log('[SW] saved', reg.scope))
            .catch(err => console.warn('[SW] error:', err));
    });
}
</script>
```

- [ ] **Step 2: Replace footer.ejs content with just closing tags**

Replace entire content of `views/partials/footer.ejs` with:
```html
</main>
</body>
</html>
```

- [ ] **Step 3: Commit**
```bash
git add views/partials/footer.ejs views/partials/header.ejs
git commit -m "ui: remove footer, move SW/loader scripts to header"
```

---

### Task 9: UI overhaul — home page cleanup

**Files:**
- Modify: `views/index.ejs`

- [ ] **Step 1: Read the home page**
```bash
cat -n F:/MainProjects/DVinyl/views/index.ejs | head -60
```

- [ ] **Step 2: Remove "Welcome [username]!" and gradient overlays**

Find and remove/replace:
- Any `<%= user.username %>` or `Welcome` greeting — replace with the site name or nothing
- Any `bg-gradient-*` classes on hero sections — remove them
- Any `animate-pulse` classes — remove them

- [ ] **Step 3: Commit**
```bash
git add views/index.ejs
git commit -m "ui: clean up home page, remove personalisation and gradients"
```

---

### Task 10: UI overhaul — reduce accent color noise

**Files:**
- Modify: `views/partials/header.ejs` (loader icon)
- Modify: `views/collection.ejs`

- [ ] **Step 1: Tone down the page loader**

In `header.ejs`, find the loader spinner:
```html
<i class="fa-solid fa-compact-disc fa-spin text-6xl text-primary-theme drop-shadow-md"></i>
```
Replace with a simpler spinner:
```html
<i class="fa-solid fa-compact-disc fa-spin text-4xl opacity-40 text-[var(--text-main)]"></i>
```

- [ ] **Step 2: Check collection page for any extraneous color usage**

Open `views/collection.ejs` and look for decorative uses of `text-primary-theme`, `bg-primary-theme`, gradient classes. Keep accent color only on: active filter pills, primary CTA buttons, active nav items. Remove from decorative badges, icons, count displays.

- [ ] **Step 3: Commit**
```bash
git add views/partials/header.ejs views/collection.ejs
git commit -m "ui: reduce accent color to active states and CTAs only"
```

---

## Self-Review

**Spec coverage check:**
- ✅ Collection model with name + type — Task 1
- ✅ Item gets collection field — Task 1
- ✅ GET/POST/DELETE /api/collections — Task 2
- ✅ Uncategorized = null collection — Tasks 3–5 (default null), Task 6 (filter)
- ✅ Collection dropdown on confirm-dvd — Task 3
- ✅ Collection dropdown on confirm-game — Task 4
- ✅ Collection dropdown on confirm-book — Task 5
- ✅ Pill filter on collection page — Task 6
- ✅ New Collection modal — Task 6
- ✅ Delete collection → items become uncategorized — Task 2
- ✅ Header: theme toggle only — Task 7
- ✅ Footer removed — Task 8
- ✅ SW/loader scripts preserved — Task 8
- ✅ Home page cleaned — Task 9
- ✅ Accent color reduced — Task 10

**Notes:**
- Task 5 step 1 has a shell command to discover the book confirm view name — execute it first before editing
- Task 7 step 2: verify theme toggle JS location before removing — it may already be in a separate script block lower in header.ejs
- Edit pages (edit-dvd, edit-game, edit-book) should also get the collection dropdown pre-selected to the item's current collection — this is a follow-up if needed; the plan covers confirm (add) pages fully
