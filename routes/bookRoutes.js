const express = require('express');
const router = express.Router();
const axios = require('axios');
const Book = require('../models/Book');
const Item = require('../models/Item');
const User = require('../models/User');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');

async function getAdminId() {
    const admin = await User.findOne({ isAdmin: true }).select('_id');
    return admin ? admin._id : null;
}

const formatGoogleBook = (item) => {
    const volumeInfo = item.volumeInfo || {};
    const isbnObj = volumeInfo.industryIdentifiers?.find(id => id.type === 'ISBN_13') 
                 || volumeInfo.industryIdentifiers?.find(id => id.type === 'ISBN_10');
    const isbn = isbnObj ? isbnObj.identifier : '';

    let cover = '/ressources/no_book.png';

    if (volumeInfo.imageLinks) {
        cover = (volumeInfo.imageLinks.medium || 
                 volumeInfo.imageLinks.small || 
                 volumeInfo.imageLinks.thumbnail)
                 .replace('http:', 'https:')
                 .replace('&zoom=1', '&zoom=2');
    } else if (isbn) {
        cover = `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`;
    }

    return {
        google_id: item.id,
        title: volumeInfo.title || 'Titre inconnu',
        author: volumeInfo.authors ? volumeInfo.authors.join(', ') : 'Auteur inconnu',
        publisher: volumeInfo.publisher || '',
        year: volumeInfo.publishedDate ? volumeInfo.publishedDate.substring(0, 4) : '',
        isbn: isbn,
        pages: volumeInfo.pageCount || null,
        language: volumeInfo.language || '',
        cover_image: cover,
        description: volumeInfo.description || ''
    };
};

router.get('/add-book', requireAuth, requireAdmin, (req, res) => {
    res.render('add-book', { results: null, user: res.locals.user });
});

router.post('/search-books', requireAuth, requireAdmin, async (req, res) => {
    let query = req.body.query;
    
    const cleanQuery = query.replace(/[- ]/g, '');
    if (/^\d{10,13}$/.test(cleanQuery)) {
        query = `isbn:${cleanQuery}`;
    } else {
        query = `intitle:${query}`;
    }

    try {
        const apiKey = process.env.GOOGLE_BOOKS_API_KEY ? `&key=${process.env.GOOGLE_BOOKS_API_KEY}` : '';
        const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}${apiKey}&maxResults=12`;
        
        const response = await axios.get(url);
        const results = response.data.items ? response.data.items.map(formatGoogleBook) : [];

        res.render('add-book', { 
            results, 
            user: res.locals.user 
        });
    } catch (err) {
        console.error("[ERR] Google Books:", err);
        res.render('add-book', { results: [], error: req.t('errors.api_error'), user: res.locals.user });
    }
});

router.get('/confirm-book/:google_id', requireAuth, async (req, res) => {
    const googleId = req.params.google_id;

    try {
        const apiKey = process.env.GOOGLE_BOOKS_API_KEY ? `?key=${process.env.GOOGLE_BOOKS_API_KEY}` : '';
        const url = `https://www.googleapis.com/books/v1/volumes/${googleId}${apiKey}`;
        
        const response = await axios.get(url);
        const bookData = formatGoogleBook(response.data);

        const adminId = await User.findOne({ isAdmin: true }).select('_id').lean();
        const locations = await Item.distinct('location', { owner: adminId, location: { $ne: "" } });

        res.render('confirm-book', { book: bookData, user: res.locals.user, locations });
    } catch (err) {
        console.error("Erreur récupération livre:", err);
        res.status(500).send(req.t('errors.generic_server_error'));
    } 
});

router.post('/save-book', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { 
            mongo_id, title, author, publisher, year, isbn, pages, language, 
            format, series, volume, cover_image, google_id, 
            in_wishlist, comments, location, readingStatus, rating, quantity
        } = req.body;
        
        const adminId = req.user._id;
        const isWishlist = in_wishlist === 'true';
        let book;

        if (mongo_id) {
            book = await Item.findById(mongo_id);
        }
        
        if (book) {
            book.title = title;
            book.author = author;
            book.publisher = publisher;
            book.year = year;
            book.isbn = isbn;
            book.pages = pages;
            book.language = language;
            book.format = format;
            book.series = series;
            book.volume = volume;
            book.cover_image = cover_image;
            book.in_wishlist = isWishlist;
            book.comments = comments || '';
            book.location = location || '';
            book.readingStatus = readingStatus || 'to_read';
            book.rating = rating || 0;
            book.quantity = quantity || 1;
            
            await book.save();
        } else {
            await Book.create({
                title, author, publisher, year, isbn, pages, language,
                format, series, volume, cover_image,
                kind: 'Book',
                media_type: 'book',
                in_wishlist: isWishlist,
                owner: adminId,
                comments: comments || '',
                location: location || '',
                readingStatus: readingStatus || 'to_read',
                rating: rating || 0,
                quantity: quantity || 1,
            });
        }

        if (isWishlist) {
            res.redirect('/wishlist');
        } else {
            res.redirect(`/collection?type=books`);
        }

    } catch (err) {
        console.error("Erreur sauvegarde livre:", err);
        res.status(500).send(req.t('errors.generic_server_error'));
    }
});

router.get('/book/edit/:id', requireAuth, async (req, res) => {
    try {
        const book = await Item.findById(req.params.id);
        if (!book || book.kind !== 'Book') {
            return res.redirect('/collection');
        }

        const adminId = await getAdminId();
        const locations = await Item.distinct('location', { owner: adminId, location: { $ne: "" } });
        
        res.render('edit-book', { book: book.toObject(), user: res.locals.user, locations });
    } catch (err) {
        console.error(err);
        res.redirect('/collection');
    }
});

router.get('/book/:id', requireAuth, async (req, res) => {
    try {
        const book = await Item.findById(req.params.id);
        if (!book || book.kind !== 'Book') return res.redirect('/collection');

        res.render('book-detail', { book: book.toObject(), user: res.locals.user });
    } catch (err) {
        res.redirect('/collection');
    }
});

router.delete('/api/book/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
        const book = await Item.findOne({ _id: req.params.id, owner: res.locals.user._id });

        if (!book) {
            return res.status(404).json({ error: "Book not found or you are not the owner." });
        }

        await Item.deleteOne({ _id: req.params.id });

        res.json({ success: true, redirectUrl: `/collection?type=books` });

    } catch (err) {
        console.error(err);
        res.status(500).send(req.t('errors.generic_server_error'));
    }
});

module.exports = router;