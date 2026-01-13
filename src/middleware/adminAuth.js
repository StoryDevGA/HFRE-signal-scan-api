const {
  getSession,
  getSessionTokenFromRequest,
} = require("../services/adminAuthService");

function requireAdmin(req, res, next) {
  const token = getSessionTokenFromRequest(req);
  const session = getSession(token);
  if (!session) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  req.admin = { email: session.email };
  return next();
}

module.exports = { requireAdmin };
