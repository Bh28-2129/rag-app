const app = require("../backend/server");

module.exports = (req, res) => {
  if (req.url.startsWith("/api")) {
    req.url = req.url.replace(/^\/api/, "") || "/";
  }

  return app(req, res);
};
