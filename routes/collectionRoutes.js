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
