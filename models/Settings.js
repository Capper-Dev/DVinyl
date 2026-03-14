const mongoose = require('mongoose');

const themeSchema = {
    preset: { type: String, default: 'default' }
};

const settingsSchema = new mongoose.Schema({
    siteName: { type: String, default: 'DVinyl' },
    modules: {
        music:   { type: Boolean, default: true },
        books:   { type: Boolean, default: false },
        dvd:     { type: Boolean, default: false },
        advancedCD: { type: Boolean, default: false }
    },
    theme: {
        home:    { type: Object, default: themeSchema },
        music:   { type: Object, default: themeSchema },
        books:   { type: Object, default: themeSchema },
        dvd:     { type: Object, default: themeSchema }
    },
    navbarShortcuts: { 
        type: [String], 
        default: ['global_home', 'music_vinyl', 'music_cd', 'music_cassette', 'global_wishlist']
    },
    statsWidgets: { 
        type: [String], 
        default: ['total', 'vinyl', 'cd', 'cassette', 'artist'] 
    },
    fastAdd: { type: String, default: '' }
});

module.exports = mongoose.model('Settings', settingsSchema);