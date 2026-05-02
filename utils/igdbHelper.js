const axios = require('axios');

/**
 * utils/igdbHelper.js
 *
 * Helper module for IGDB API authentication and requests.
 * Uses Twitch Client Credentials Grant to obtain and cache
 * an access token, refreshing it automatically when expired.
 */

let cachedToken = null;
let tokenExpiresAt = 0;

/**
 * Obtain a valid Twitch access token for IGDB.
 * Caches the token in memory and refreshes only when expired.
 * @returns {Promise<string>} The access token
 */
async function getAccessToken() {
    const now = Date.now();
    if (cachedToken && now < tokenExpiresAt) {
        return cachedToken;
    }

    const clientId = process.env.TWITCH_CLIENT_ID;
    const clientSecret = process.env.TWITCH_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        throw new Error('TWITCH_CLIENT_ID or TWITCH_CLIENT_SECRET missing from .env');
    }

    const response = await axios.post('https://id.twitch.tv/oauth2/token', null, {
        params: {
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: 'client_credentials'
        }
    });

    cachedToken = response.data.access_token;
    // Refresh 5 minutes before actual expiry
    tokenExpiresAt = now + (response.data.expires_in * 1000) - 300000;

    console.log('🎮 IGDB/Twitch token obtained, expires in', Math.round(response.data.expires_in / 3600), 'hours');
    return cachedToken;
}

/**
 * Make a request to the IGDB API.
 * @param {string} endpoint - IGDB endpoint (e.g. 'games', 'platforms', 'covers')
 * @param {string} body - APICalypse query body
 * @returns {Promise<Array>} The response data
 */
async function igdbRequest(endpoint, body) {
    const token = await getAccessToken();
    const clientId = process.env.TWITCH_CLIENT_ID;

    const response = await axios.post(
        `https://api.igdb.com/v4/${endpoint}`,
        body,
        {
            headers: {
                'Client-ID': clientId,
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json',
                'Content-Type': 'text/plain'
            }
        }
    );

    return response.data;
}

module.exports = { getAccessToken, igdbRequest };
