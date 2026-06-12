const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET || process.env.SESSION_SECRET || "nara-shop-access-secret";
const ACCESS_TTL_SEC = Number(process.env.JWT_ACCESS_TTL_SEC || 15 * 60);
const REFRESH_TTL_DAYS = Number(process.env.JWT_REFRESH_TTL_DAYS || 7);

function signAccessToken(username) {
  return jwt.sign({ sub: username, type: "access" }, ACCESS_SECRET, {
    expiresIn: ACCESS_TTL_SEC,
  });
}

function verifyAccessToken(token) {
  const payload = jwt.verify(token, ACCESS_SECRET);
  if (payload.type !== "access" || !payload.sub) {
    throw new Error("Token không hợp lệ");
  }
  return payload;
}

function generateRefreshToken() {
  return crypto.randomBytes(48).toString("base64url");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function refreshExpiresAt() {
  return String(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
}

function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000,
    path: "/api/admin",
  };
}

module.exports = {
  ACCESS_TTL_SEC,
  signAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  hashToken,
  refreshExpiresAt,
  refreshCookieOptions,
};
