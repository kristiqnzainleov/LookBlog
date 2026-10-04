// Vercel runs the LookBlog server as one function. Vercel itself serves the static files in public/.
const { handle } = require("../server.js");

module.exports = (req, res) => handle(req, res);
