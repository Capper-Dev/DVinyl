const mongoose = require('mongoose');

const options = {
  discriminatorKey: 'kind',
  collection: 'albums',
  timestamps: { createdAt: false, updatedAt: 'updated_at' }
};

const itemSchema = new mongoose.Schema({
  title: { type: String, required: true },
  year: String,
  cover_image: String,
  user_image: String,
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  in_wishlist: { type: Boolean, default: false },
  comments: { type: String, default: '' },
  location: { type: String, default: '' },
  quantity: { type: Number, default: 1, min: 1 },
  genre: String,
  genres: [String],
  styles: [String],
  barcode: { type: String, default: '' },
  barcode_locked: { type: Boolean, default: false },
  added_at: { type: Date, default: Date.now },
  collection: { type: mongoose.Schema.Types.ObjectId, ref: 'Collection', default: null }

}, options);

const Item = mongoose.model('Item', itemSchema);
module.exports = Item;