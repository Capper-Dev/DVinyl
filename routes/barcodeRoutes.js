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
