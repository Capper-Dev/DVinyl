const express = require('express');
const router = express.Router();
const axios = require('axios');
const Book = require('../models/Book');
const Item = require('../models/Item');
const User = require('../models/User');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');
const xml2js = require('xml2js');

async function getAdminId() {
    const admin = await User.findOne({ isAdmin: true }).select('_id');
    return admin ? admin._id : null;
}


const formatHardcoverBook = (book) => {
    if (!book || !book.id) return null;
    
    let authors = 'Unknown';
    
    if (book.author_names?.length > 0) {
        authors = book.author_names.join(', ');
    }

    else if (book.cached_contributors) {
        let contributors = book.cached_contributors;
        if (typeof contributors === 'string') {
            try { contributors = JSON.parse(contributors); } catch(e) { contributors = null; }
        }
        if (Array.isArray(contributors)) {
            const names = contributors.map(c => c?.author?.name || c?.name).filter(Boolean);
            if (names.length > 0) authors = names.join(', ');
        } else if (contributors && typeof contributors === 'object') {
            const names = Object.values(contributors).filter(Boolean);
            if (names.length > 0) authors = names.join(', ');
        }
    }

    let cover = '/ressources/no_book.png';
    if (book.image) {
        cover = typeof book.image === 'string' ? book.image : (book.image.url || cover);
    }

    const bestEdition = book.editions?.[0];

    return {
        hardcover_id: book.id,
        hardcover_slug: book.slug || '',
        title: book.title || 'Untitled',
        author: authors,
        publisher: bestEdition?.publisher?.name || '',
        year: book.release_year || '',
        isbn: bestEdition?.isbn_13 || bestEdition?.isbn_10 || '',
        pages: bestEdition?.pages || book.pages || 0,
        language: bestEdition?.language?.language || '',
        cover_image: cover,
        description: book.description || ''
    };
};

router.get('/add-book', requireAuth, requireAdmin, (req, res) => {
    res.render('add-book', { results: null, user: res.locals.user });
});


router.post('/search-books', requireAuth, requireAdmin, async (req, res) => {
    let query = req.body.query;
    const cleanQuery = query.replace(/[- ]/g, '');
    const isIsbn = /^\d{10,13}$/.test(cleanQuery);

    try {
        const apiKey = process.env.HARDCOVER_API_KEY;
        let graphqlQuery;
        let variables = {};

        if (isIsbn) {
            graphqlQuery = `
                query SearchByIsbn($isbn: String!) {
                    editions(where: { _or: [{ isbn_13: { _eq: $isbn } }, { isbn_10: { _eq: $isbn } }] }, limit: 5) {
                        book {
                            id
                            title
                            cached_contributors
                            release_year
                            pages
                            image { url }
                        }
                    }
                }
            `;
            variables = { isbn: cleanQuery };
        } else {
            graphqlQuery = `
                query SearchByTitle($searchTerm: String!) {
                    search(query: $searchTerm, query_type: "Book", per_page: 24) {
                        results
                    }
                }
            `;
            variables = { searchTerm: query };
        }

        const response = await axios.post(
            'https://api.hardcover.app/v1/graphql',
            { query: graphqlQuery, variables },
            { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' } }
        );

        const data = response.data.data;
        let rawResults = [];

        if (isIsbn) {
            const books = data?.editions?.map(e => e.book).filter(Boolean) || [];
            rawResults = Array.from(new Map(books.map(b => [b.id, b])).values());
        } else {
            const hits = data?.search?.results?.hits || [];
            rawResults = hits
                .map(hit => hit?.document)
                .filter(doc => doc && doc.id);
        }

        const results = rawResults.map(formatHardcoverBook).filter(Boolean);

        res.render('add-book', { 
            results, 
            user: res.locals.user 
        });

    } catch (err) {
        console.error("[ERR] Hardcover API Error:", err.message);
        res.render('add-book', { results: [], error: "Search error", user: res.locals.user });
    }
});

router.get('/confirm-book/:id', requireAuth, async (req, res) => {
    const bookId = req.params.id; 

    try {
        const apiKey = process.env.HARDCOVER_API_KEY;
        
        const graphqlQuery = `
            query GetBook($id: Int!) {
                books_by_pk(id: $id) {
                    id
                    slug
                    title
                    description
                    cached_contributors
                    release_year
                    pages
                    image { url }
                    editions(limit: 5, order_by: { users_count: desc }) {
                        isbn_13
                        isbn_10
                        publisher { name }
                        language { language }
                        pages
                        reading_format_id
                    }
                }
            }
        `;

        const response = await axios.post(
            'https://api.hardcover.app/v1/graphql',
            { query: graphqlQuery, variables: { id: parseInt(bookId) } },
            { headers: { 'Authorization': `Bearer ${apiKey}` } }
        );

        const bookData = formatHardcoverBook(response.data.data.books_by_pk);

        const adminId = await User.findOne({ isAdmin: true }).select('_id').lean();
        const locations = await Item.distinct('location', { owner: adminId, location: { $ne: "" } });
        const genres = await Book.distinct('genre', { owner: adminId, genre: { $ne: "" } });

        res.render('confirm-book', { book: bookData, user: res.locals.user, locations, genres });
    } catch (err) {
        console.error("[ERR] Hardcover API Error:", err?.response?.data || err.message);
        res.status(500).send(req.t('errors.generic_server_error'));
    } 
});

router.post('/save-book', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { 
            mongo_id, title, author, publisher, year, isbn, pages, language, 
            format, series, volume, cover_image, hardcover_id, hardcover_slug,
            in_wishlist, comments, location, genre, readingStatus, rating, quantity
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
            book.genre = genre || '';
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
                genre: genre || '',
                readingStatus: readingStatus || 'to_read',
                rating: rating || 0,
                quantity: quantity || 1,
                hardcover_slug: hardcover_slug || '',
                source: 'hardcover',
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
            return res.redirect('/collection?type=books');
        }

        const adminId = await getAdminId();
        const locations = await Item.distinct('location', { owner: adminId, location: { $ne: "" } });
        const genres = await Book.distinct('genre', { owner: adminId, genre: { $ne: "" } });
        
        res.render('edit-book', { book: book.toObject(), user: res.locals.user, locations, genres });
    } catch (err) {
        console.error(err);
        res.redirect('/collection?type=books');
    }
});

router.get('/book/:id', requireAuth, async (req, res) => {
    try {
        const book = await Item.findById(req.params.id);
        if (!book || book.kind !== 'Book') return res.redirect('/collection?type=books');

        res.render('book-detail', { book: book.toObject(), user: res.locals.user });
    } catch (err) {
        res.redirect('/collection?type=books');
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



router.post('/import/goodreads', requireAuth, requireAdmin, async (req, res) => {
    const { rss_url, default_format, default_language } = req.body;
    if (!rss_url || !rss_url.includes('goodreads.com')) {
        return res.status(400).json({ error: "Invalid GoodReads RSS URL" });
    }

    const userId          = req.user._id;
    const defaultFormat   = default_format   || 'paperback';
    const defaultLanguage = default_language || '';

    res.status(202).json({ success: true, message: "Import started" });

    try {
        let page          = 1;
        let totalImported = 0;
        let totalFetched  = 0;
        let hasMore       = true;

        while (hasMore) {
            const url      = `${rss_url}&shelf=%23ALL%23&per_page=200&page=${page}`;
            const response = await axios.get(url, { timeout: 15000 });
            const parsed   = await xml2js.parseStringPromise(response.data, { explicitArray: false });

            const items = parsed?.rss?.channel?.item;
            if (!items) break;
            const books = Array.isArray(items) ? items : [items];
            if (books.length === 0) break;
            totalFetched += books.length;

            for (const item of books) {
                const title  = item['title']?.trim();
                const author = item['author_name']?.trim() || '';
                if (!title || !author) continue;

                const existing = await Item.findOne({ owner: userId, title, author, kind: 'Book' });
                if (existing) continue;

                const isbn = item['isbn13']?.trim() || item['isbn']?.trim() || '';

                const shelf  = (item['user_shelves'] || '').toLowerCase();
                
                let readingStatus = 'read';
                if  (shelf.includes('currently')) readingStatus = 'reading';
                else if (shelf.includes('to-read'))   readingStatus = 'to_read';

                const hasAsianChars = /[\u3000-\u9fff\uac00-\ud7af]/.test(title);
                let format = hasAsianChars ? 'manga' : defaultFormat;

                if (shelf.includes('manga')) format = 'manga';
                else if (shelf.includes('comic') || shelf.includes('bd')) format = 'comic';
                else if (shelf.includes('graphic')) format = 'graphic_novel';
                else if (shelf.includes('hardcover') || shelf.includes('relié')) format = 'hardcover';
                else if (shelf.includes('paperback') || shelf.includes('broché')) format = 'paperback';

                const cover_image = item['book_large_image_url']?.trim() || item['book_medium_image_url']?.trim() || '/ressources/no_book.png';

                const pages = parseInt(item['book']?.num_pages) || 0;

                const dateAdded = item['user_date_added']?.trim()
                    ? new Date(item['user_date_added'].trim())
                    : new Date();

                const rating = parseFloat(item['user_rating']) || 0;
                const year   = item['book_published']?.trim() || '';

                let publisher = '';
                let language  = defaultLanguage;

                if (isbn) {
                    try {
                        const olRes  = await axios.get(
                            `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`,
                            { timeout: 4000 }
                        );
                        const olBook = olRes.data?.[`ISBN:${isbn}`];

                        if (olBook) {
                            publisher = olBook.publishers?.[0]?.name || '';

                            const langKey = (olBook.languages?.[0]?.key || '').split('/').pop();
                            const langMap = {
                                fre: 'fr', fra: 'fr',
                                eng: 'en',
                                spa: 'es',
                                deu: 'de',
                                ita: 'it',
                                jpn: 'ja',
                                por: 'pt',
                                nld: 'nl',
                                kor: 'ko',
                                zho: 'zh',
                            };
                            language = langMap[langKey] || langKey || defaultLanguage;

                            if (format === defaultFormat && !hasAsianChars) {
                                const pub = publisher.toLowerCase();
                                const mangaPublishers = [
                                    'viz', 'kana', 'glénat manga', 'glenat manga',
                                    'pika', 'ki-oon', 'kurokawa', 'delcourt manga',
                                    'tonkam', 'shueisha', 'kodansha', 'square enix'
                                ];
                                const comicPublishers = [
                                    'marvel', 'dc comics', 'image comics',
                                    'dark horse', 'urban comics', 'panini comics'
                                ];
                                if      (mangaPublishers.some(p => pub.includes(p))) format = 'manga';
                                else if (comicPublishers.some(p => pub.includes(p))) format = 'comic';
                            }
                        }
                    } catch (err) {
                        console.error("Error fetching Open Library data:", err.message);
                    }
                    await new Promise(resolve => setTimeout(resolve, 300));
                }

                await Book.create({
                    kind:        'Book',
                    media_type:  'book',
                    owner:       userId,
                    title,
                    author,
                    isbn,
                    publisher,
                    language,
                    year,
                    pages,
                    format,
                    rating,
                    readingStatus,
                    cover_image,
                    source:      'goodreads',
                    in_wishlist: false,
                    comments:    item['user_review']?.trim() || '',
                    added_at:    dateAdded,
                    genre:       '',
                });

                totalImported++;
                req.io.emit('import_progress', { current: totalImported, total: totalFetched });
            }

            if (books.length < 200) hasMore = false;
            else page++;
        }

        req.io.emit('import_finished', { count: totalImported });

    } catch (err) {
        console.error("[ERR] GoodReads RSS import:", err.message);
        req.io.emit('import_error', { message: err.message });
    }
});

module.exports = router;