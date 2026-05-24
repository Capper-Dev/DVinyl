const mongoose = require('mongoose');

const collectionSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    type: { type: String, required: true, enum: ['dvd', 'game'] },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Collection', collectionSchema);
