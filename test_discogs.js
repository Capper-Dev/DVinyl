const axios = require('axios');
require('dotenv').config();
const token = process.env.DISCOGS_TOKEN;

async function test() {
  try {
    const r1 = await axios.get(`https://api.discogs.com/database/search?q=thriller&type=release&format=SACD&token=${token}`);
    console.log('SACD count:', r1.data.pagination.items);
  } catch(e) { console.error('SACD err:', e.response?.data || e.message); }
  
  try {
    const r2 = await axios.get(`https://api.discogs.com/database/search?q=thriller&type=release&format=CD&token=${token}`);
    console.log('CD count:', r2.data.pagination.items);
  } catch(e) { console.error('CD err:', e.response?.data || e.message); }
}
test();
