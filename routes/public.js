const express = require("express");
const {
  getSiteByDomain,
  normalizeDomain,
  recordVisit,
  formatPublicSite,
} = require("../lib/db");
const { isLocalAccessHost } = require("../lib/urls");

const router = express.Router();

function normalizeIp(ip) {
  if (!ip) return "";
  const trimmed = String(ip).trim();
  return trimmed.startsWith("::ffff:") ? trimmed.slice(7) : trimmed;
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    const ip = normalizeIp(String(forwarded).split(",")[0]);
    if (ip) return ip;
  }

  const proxyIp = req.headers["cf-connecting-ip"] || req.headers["x-real-ip"];
  if (proxyIp) return normalizeIp(proxyIp);

  return normalizeIp(req.socket?.remoteAddress || req.ip || "");
}

function resolveRequestDomain(req) {
  const host = req.headers.host || "localhost";
  const preview = String(req.query.preview || "").trim();
  if (preview && isLocalAccessHost(host)) {
    return normalizeDomain(preview);
  }
  return normalizeDomain(host);
}

router.get("/api/site", (req, res) => {
  const domain = resolveRequestDomain(req);
  const site = getSiteByDomain(domain);
  if (!site) {
    return res.status(404).json({
      error: "Domain chưa được cấu hình",
      id: domain,
      domain,
    });
  }
  recordVisit(site.site_id, getClientIp(req));
  res.json(formatPublicSite(site));
});

router.get("/", (req, res) => {
  const domain = resolveRequestDomain(req);
  const site = getSiteByDomain(domain);

  if (!site) {
    return res.status(404).send(`
      <!DOCTYPE html>
      <html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Domain chưa được cấu hình</title>
      <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f4f4f5;color:#1a1a1a}
      .box{text-align:center;padding:32px;background:#fff;border-radius:16px}</style></head>
      <body><div class="box"><h2>Domain chưa được cấu hình</h2></div></body></html>
    `);
  }

  recordVisit(site.site_id, getClientIp(req));
  res.render("landing", { site });
});

router.get("/admin", (_req, res) => {
  res.redirect("/admin/");
});

module.exports = router;
