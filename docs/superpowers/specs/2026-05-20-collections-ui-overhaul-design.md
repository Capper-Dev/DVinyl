# Collections + UI Overhaul Design
Date: 2026-05-20

## Overview
Two parallel changes: (1) per-type named collections so multiple people can maintain separate lists of DVDs, games, and books; (2) UI cleanup to reduce visual noise and simplify navigation.

---

## 1. Collections Feature

### Data Model
New `Collection` Mongoose model:
- `name` — String, required
- `type` — String, enum: `['dvd', 'game', 'book']`, required
- `createdAt` — Date, default now

Existing `Item` base schema gets a new optional field:
- `collection` — ObjectId ref to `Collection`, optional

Items with no `collection` set are treated as "Uncategorized".

### Create Collection
A small modal (triggered by a "New Collection" button on the collection page) with a single text input for the name. On submit, POSTs to `/api/collections` with `{ name, type }`. The modal closes and the new collection appears in the filter immediately.

### Adding Items to a Collection
On the confirm pages (`confirm-dvd`, `confirm-game`, confirm-book equivalent) and edit pages, a dropdown labelled "Collection" shows all collections of that item's type plus an "Uncategorized" option. The selected collection ID is submitted with the save form and stored on the item.

### Collection Filter on Collection Page
Above the item grid, a horizontal pill/tab row shows: **All** | **Uncategorized** | *[collection names for this type]*. Selecting a pill filters the displayed items. Default is **All**. The filter is a query param (`?collection=<id>` or `?collection=uncategorized`) so it's linkable.

### Backend
- `GET /api/collections?type=dvd|game|book` — list collections for a type
- `POST /api/collections` — create collection `{ name, type }`
- `DELETE /api/collections/:id` — delete collection (items become uncategorized)
- Collection filter applied in the existing collection route handler when `?collection=` param is present

---

## 2. UI Overhaul

### Remove
- Footer entirely (keep the service worker registration script, move it inline or to a layout partial)
- User avatar/name/email from header
- Admin dashboard link
- Personalisation link from dropdown
- The ⋮ dropdown entirely — replace with a single theme toggle icon button

### Header Simplification
Left: logo + site name. Right: theme toggle button only. Mobile hamburger stays for the navbar shortcuts.

### Visual Tone
- Reduce accent color usage — primary color only on active states and CTAs, not decorative elements
- Card backgrounds: subtle, low-contrast
- Typography: tighter hierarchy, less bold everywhere
- Remove any gradient overlays on the home hero
- Home page: remove the "Welcome [username]!" personalisation, replace with a neutral tagline or nothing

### Footer Removal
Delete `footer.ejs` include from layout. Move the service worker JS inline into the main layout `<script>` block so it still registers.

---

## Scope Boundaries
- No changes to music module (it exists, leave it alone)
- No user management, settings pages, or backup routes touched
- Collections are not nested — flat list per type only
- No collection sharing or permissions — all collections visible to all visitors
