const mongoose = require('mongoose');

async function dropLegacyBarcodeIndex() {
    try {
        const coll = mongoose.connection.collection('barcodecaches');
        const indexes = await coll.indexes();
        const legacy = indexes.find(i => i.name === 'ean_1');
        if (legacy) {
            await coll.dropIndex('ean_1');
            console.log('[MIGRATE] Dropped legacy unique index barcodecaches.ean_1');
        }
    } catch (err) {
        if (err.codeName === 'NamespaceNotFound' || err.message?.includes('ns not found')) return;
        console.error('[MIGRATE] dropLegacyBarcodeIndex failed:', err.message);
    }
}

const migrateDatabase = async () => {
    await dropLegacyBarcodeIndex();
};

module.exports = migrateDatabase;
