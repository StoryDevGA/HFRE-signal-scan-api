const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const SESSION_COOKIE = "admin_session";
const sessions = new Map();

function parseAdminEmails(value) {
  return (value || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function getAdminAllowlist() {
  const allowlist = parseAdminEmails(process.env.ADMIN_EMAILS);
  if (allowlist.length > 3) {
    throw new Error("ADMIN_EMAILS must contain at most 3 emails.");
  }
  return allowlist;
}

async function verifyAdminCredentials(email, password) {
  const allowlist = getAdminAllowlist();
  if (!allowlist.length) {
    throw new Error("ADMIN_EMAILS is not set.");
  }

  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!allowlist.includes(normalizedEmail)) {
    return false;
  }

  const hash = process.env.ADMIN_PASSWORD_HASH;
  if (!hash) {
    throw new Error("ADMIN_PASSWORD_HASH is not set.");
  }

  return bcrypt.compare(password, hash);
}

function createSession(email) {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, {
    email,
    createdAt: new Date(),
  });
  return token;
}

function revokeSession(token) {
  if (!token) {
    return;
  }
  sessions.delete(token);
}

function getSession(token) {
  if (!token) {
    return null;
  }
  return sessions.get(token) || null;
}

function parseCookies(headerValue) {
  if (!headerValue) {
    return {};
  }

  return headerValue.split(";").reduce((acc, part) => {
    const [rawKey, ...rest] = part.trim().split("=");
    const key = rawKey ? rawKey.trim() : "";
    if (!key) {
      return acc;
    }
    acc[key] = decodeURIComponent(rest.join("="));
    return acc;
  }, {});
}

function getSessionTokenFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie || "");
  return cookies[SESSION_COOKIE];
}

function getCookieOptions() {
  const isProduction = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    sameSite: isProduction ? "none" : "lax",
    secure: isProduction,
    path: "/",
  };
}

module.exports = {
  SESSION_COOKIE,
  createSession,
  getCookieOptions,
  getSessionTokenFromRequest,
  getSession,
  revokeSession,
  verifyAdminCredentials,
};
