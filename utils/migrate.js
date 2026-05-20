const Item = require('../models/Item');
const User = require('../models/User');
const bcrypt = require('bcrypt');

const migrateDatabase = async () => {
    try {
        const userCount = await User.countDocuments();
        if (userCount === 0) {
            const hashed = await bcrypt.hash('admin', 10);
            await User.create({
                username: 'admin',
                email: 'admin@dvinyl.local',
                password: hashed,
                isAdmin: true,
                language: 'en',
                lastChange: new Date()
            });
            console.log('[SETUP] Default admin user created (username: admin, password: admin)');
        }

        const oldItemsCount = await Item.countDocuments({ kind: { $exists: false } });

        if (oldItemsCount > 0) {
            console.log(`[MIGRATION] : Found ${oldItemsCount} old items...`);
            console.log('[MIGRATION] Updating...');
            const result = await Item.updateMany(
                { kind: { $exists: false } }, 
                { $set: { kind: 'Music' } } 
            );

            console.log(`[MIGRATION] ${result.modifiedCount} old items updated.`);
        } 

    } catch (error) {
        console.error('[MIGRATION] ERROR :', error);
    }
};

module.exports = migrateDatabase;