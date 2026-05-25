const express = require('express');
const router = express.Router();
const Item = require('../models/Item');
const Collection = require('../models/Collection');
const Settings = require('../models/Settings');
const { requireAuth } = require('../middleware/authMiddleware');

// Export the whole library as JSON
router.get('/export', requireAuth, async (req, res) => {
    try {
        const data = {
            albums: await Item.find({}).lean(),
            collections: await Collection.find({}).lean(),
            settings: await Settings.findOne().lean(),
            metadata: { version: '3.0.0', date: new Date() }
        };

        const fileName = `dvinyl_backup_${new Date().toISOString().split('T')[0]}.json`;
        res.setHeader('Content-disposition', 'attachment; filename=' + fileName);
        res.setHeader('Content-type', 'application/json');
        res.send(JSON.stringify(data, null, 2));
    } catch (err) {
        console.error(err);
        res.status(500).send('Export failed');
    }
});

// Restore from a backup JSON
router.post('/import', requireAuth, async (req, res) => {
    try {
        let data = req.body;
        if (data.backupData) {
            try {
                data = typeof data.backupData === 'string' ? JSON.parse(data.backupData) : data.backupData;
            } catch (e) {
                return res.status(400).json({ error: 'Invalid JSON format' });
            }
        }
        if (!data || !data.albums) {
            return res.status(400).json({ error: 'Backup file missing required fields' });
        }

        await Promise.all([
            Item.deleteMany({}),
            Collection.deleteMany({}),
            Settings.deleteMany({})
        ]);

        if (Array.isArray(data.albums) && data.albums.length > 0) {
            const cleanAlbums = data.albums.filter(a => a.kind === 'Dvd' || a.kind === 'Game');
            if (cleanAlbums.length > 0) await Item.insertMany(cleanAlbums);
        }
        if (Array.isArray(data.collections) && data.collections.length > 0) {
            await Collection.insertMany(data.collections);
        }
        if (data.settings) {
            await Settings.create(data.settings);
        } else {
            await Settings.create({});
        }

        res.status(200).json({ success: true, message: 'Import successful' });
    } catch (err) {
        console.error('[ERR] Import:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
