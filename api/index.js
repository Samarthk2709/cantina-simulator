// Vercel entry: every /api/* request goes to the same handler the local server uses (server.cjs).
module.exports = require('../server.cjs').handler;
