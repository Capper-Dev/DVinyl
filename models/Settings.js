const mongoose = require('mongoose');

const themeSchema = {
    preset: { type: String, default: 'default' }
};

const settingsSchema = new mongoose.Schema({
    siteName: { type: String, default: 'DVinyl' },
    modules: {
        music:   { type: Boolean, default: true },
        books:   { type: Boolean, default: true },
        dvd:     { type: Boolean, default: true },
        games:   { type: Boolean, default: true },
        advancedCD: { type: Boolean, default: false }
    },
    theme: {
        home:    { type: Object, default: themeSchema },
        music:   { type: Object, default: themeSchema },
        books:   { type: Object, default: themeSchema },
        dvd:     { type: Object, default: themeSchema },
        games:   { type: Object, default: themeSchema }
    },
    navbarShortcuts: {
        type: [String],
        default: ['global_home', 'books', 'dvd', 'games', 'global_wishlist']
    },
    statsWidgets: { 
        type: [String], 
        default: ['total', 'vinyl', 'cd', 'cassette', 'artist'] 
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