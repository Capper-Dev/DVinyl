# 🔑 API Configuration

DVinyl relies on external APIs to fetch album data and visuals. Follow these steps to get your Discogs & Google Books & TMDB API keys.
> You can have every key for **free**. 

## 🎵 Discogs API (Required)

*Used for fetching album metadata, tracklists, and market value.*

1.  Log in to [Discogs.com](https://www.discogs.com/).
2.  Go to **Settings > Developers**.
3.  Click **Generate new token**.
4.  Copy this token and paste it into your `.env` file as `DISCOGS_TOKEN`.

## 📚 Google Books *(Optional if you don't want to add books to your collection)*

### Get an API Key
1.  Go to the [Google Cloud Console](https://console.cloud.google.com/).
2.  Create a new project and go to **APIs & Services**
3.  Search for **Books API** and then <u>activate</u>.
4.  Go to **Credentials** and **Create credentials** -> **API Key**.
5.  Paste it into `.env` as `GOOGLE_BOOKS_API_KEY`.

## 📀 TMDB API *(Optional if you don't want to add DVDs to your collection)*

1. Go to [The Movie DataBase website](https://www.themoviedb.org/) and **create an account**.
2. Then, you can find your API key (not 'token') in [this page](https://www.themoviedb.org/settings/api)
3. Paste it into `.env` as `TMDB_API_KEY`

---

⚠️ **Security Note:** Never commit your `.env` file to GitHub. It contains sensitive credentials that should remain private.

[← Back to README](../README.md)  
