const mongoose = require('mongoose');
const Item = require('./Item');

const dvdSchema = new mongoose.Schema({
  director: { type: String, required: true },
  studio: String, 
  duration: String,
  rating: String,   
  zone: String,     
  tmdb_id: Number, 
  
  media_type: { 
      type: String, 
      enum: ['movie', 'tv'],
      default: 'movie'
  },

  format: { 
      type: String, 
      enum: ['dvd', 'bluray', '4k', 'vhs', 'laserdisc'],
      default: 'dvd'
  },
  is_boxset: { type: Boolean, default: false },
  barcode: String,

  watchStatus: {
      type: String,
      enum: ['to_watch', 'watching', 'watched'],
      default: 'to_watch'
  },
  user_rating: {
      type: Number,
      min: 0,
      max: 5,
      default: 0
  },
  genre: { type: String, default: '' }
});

const Dvd = Item.discriminator('Dvd', dvdSchema);

module.exports = Dvd;