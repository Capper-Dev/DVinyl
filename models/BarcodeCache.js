const mongoose = require('mongoose');

const barcodeCacheSchema = new mongoose.Schema({
    ean:         { type: String, required: true, unique: true, index: true },
    status:      { type: String, enum: ['found', 'not_found'], required: true },
    source:      { type: String, enum: ['upcitemdb', 'tmdb-ean', 'eansearch', 'manual'] },
    tmdb_id:     { type: Number },
    media_type:  { type: String, enum: ['movie', 'tv'] },
    title:       { type: String },
    year:        { type: String },
    cover_image: { type: String },
    raw_title:   { type: String },
    checked_at:  { type: Date, default: Date.now, index: true },
    hit_count:   { type: Number, default: 0 }
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

module.exports = mongoose.model('BarcodeCache', barcodeCacheSchema);
