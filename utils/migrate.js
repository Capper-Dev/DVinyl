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

    } catch (error) {
        console.error('[MIGRATION] ERROR :', error);
    }
};

module.exports = migrateDatabase;