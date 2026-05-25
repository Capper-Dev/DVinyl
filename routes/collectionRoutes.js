const express = require('express');
const router = express.Router();
const Collection = require('../models/Collection');
const Item = require('../models/Item');
const { requireAuth } = require('../middleware/authMiddleware');

const VALID_TYPES = ['dvd', 'game', 'all'];

router.get('/', requireAuth, async (req, res) => {
    const { type } = req.query;
    try {
        const query = (type && VALID_TYPES.includes(type)) ? { type } : {};
        const collections = await Collection.find(query).sort({ createdAt: 1 }).lean();
        res.json(collections);
    } catch (err) {
        console.error('[ERR] GET /api/collections:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.post('/', requireAuth, async (req, res) => {
    const { name } = req.body;
    const type = VALID_TYPES.includes(req.body.type) ? req.body.type : 'all';
    if (!name || !name.trim()) {
        return res.status(400).json({ error: 'name required' });
    }
    try {
        const col = await Collection.create({ name: name.trim(), type });
        res.json(col);
    } catch (err) {
        console.error('[ERR] POST /api/collections:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.delete('/:id', requireAuth, async (req, res) => {
    try {
        const deleted = await Collection.findByIdAndDelete(req.params.id);
        if (!deleted) return res.status(404).json({ error: 'Collection not found' });
        await Item.updateMany({ collection: req.params.id }, { $set: { collection: null } });
        res.json({ success: true });
    } catch (err) {
        console.error('[ERR] DELETE /api/collections:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
