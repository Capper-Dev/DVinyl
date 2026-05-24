const mongoose = require('mongoose');

const themeSchema = {
    preset: { type: String, default: 'default' }
};

const settingsSchema = new mongoose.Schema({
    siteName: { type: String, default: 'DVinyl' },
    modules: {
        dvd:     { type: Boolean, default: true },
        games:   { type: Boolean, default: true }
    },
    theme: {
        home:    { type: Object, default: themeSchema },
        dvd:     { type: Object, default: themeSchema },
        games:   { type: Object, default: themeSchema }
    },
    navbarShortcuts: {
        type: [String],
        default: ['global_home', 'dvd', 'games', 'global_wishlist']
    },
    statsWidgets: {
        type: [String],
        default: ['total', 'dvd_total', 'game_total', 'director']
    },
    fastAdd: { type: String, default: '' },
    visibility: {
        applyToAdmin: { type: Boolean, default: false },
        hiddenItems: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Item' }],
        hiddenGenres: [{ type: String }],
        hiddenTypes: [{ type: String }]
    }
});

module.exports = mongoose.model('Settings', settingsSchema);
