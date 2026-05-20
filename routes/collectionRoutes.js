const express = require('express');
const router = express.Router();
const Collection = require('../models/Collection');
const Item = require('../models/Item');

router.get('/', async (req, res) => {
    const { type } = req.query;
    if (!type || !['dvd', 'game', 'book'].includes(type)) {
        return res.status(400).json({ error: 'Invalid type' });
    }
    try {
        const collections = await Collection.find({ type }).sort({ createdAt: 1 }).lean();
        res.json(collections);
    } catch (err) {
        console.error('[ERR] GET /api/collections:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.post('/', async (req, res) => {
    const { name, type } = req.body;
    if (!name || !['dvd', 'game', 'book'].includes(type)) {
        return res.status(400).json({ error: 'name and valid type required' });
    }
    try {
        const col = await Collection.create({ name: name.trim(), type });
        res.json(col);
    } catch (err) {
        console.error('[ERR] POST /api/collections:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.delete('/:id', async (req, res) => {
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
