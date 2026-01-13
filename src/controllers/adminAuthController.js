const { adminAuthSchema } = require("../validators/schemas");
const {
  createSession,
  getCookieOptions,
  getSessionTokenFromRequest,
  revokeSession,
  verifyAdminCredentials,
  SESSION_COOKIE,
} = require("../services/adminAuthService");

function formatZodErrors(error) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

async function login(req, res) {
  const parsed = adminAuthSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ errors: formatZodErrors(parsed.error) });
  }

  try {
    const { email, password } = parsed.data;
    const ok = await verifyAdminCredentials(email, password);
    if (!ok) {
      return res.status(401).json({ error: "Invalid credentials." });
    }

    const sessionToken = createSession(email);
    res.cookie(SESSION_COOKIE, sessionToken, getCookieOptions());
    return res.status(200).json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Auth failed." });
  }
}

async function logout(req, res) {
  const token = getSessionTokenFromRequest(req);
  revokeSession(token);
  res.clearCookie(SESSION_COOKIE, getCookieOptions());
  return res.status(200).json({ ok: true });
}

module.exports = { login, logout };
