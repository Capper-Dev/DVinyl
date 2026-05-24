module.exports = {
  BASE_URL: process.env.BASE_URL
    ? (process.env.BASE_URL.startsWith('/') ? process.env.BASE_URL : `/${process.env.BASE_URL}`)
    : '',
};
