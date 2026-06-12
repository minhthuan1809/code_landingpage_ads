const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const {
  getAllSites,
  getSiteById,
  getAllParentDomains,
  getParentDomainById,
  createParentDomain,
  updateParentDomain,
  deleteParentDomain,
  getAllSubdomains,
  createSubdomain,
  deleteSubdomain,
  buildPreviewSite,
  createSite,
  updateSite,
  deleteSite,
  verifyAdmin,
  storeRefreshToken,
  getRefreshTokenRow,
  deleteRefreshToken,
  getCloudflareSettings,
  getPrimaryOriginDomain,
  getMainParentDomain,
  setMainParentDomain,
} = require("../lib/db");
const { getServerConfig, exportSites, buildSiteUrls } = require("../lib/urls");
const { verifyToken } = require("../lib/cloudflare");
const { provisionDomainDns, removeDomainDns, removeDnsForSite } = require("../lib/dns");
const { preparePreviewHtml } = require("../lib/preview-html");
const {
  generateNginxLandingConfig,
  syncNginxConfig,
  DEPLOY_PATH,
} = require("../lib/nginx-config");
const {
  ACCESS_TTL_SEC,
  signAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  refreshExpiresAt,
  refreshCookieOptions,
} = require("../lib/auth");

const router = express.Router();

const uploadDir = path.join(__dirname, "..", "public", "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".png";
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(new Error("Chỉ chấp nhận file ảnh"));
  },
});

function issueTokens(res, username) {
  const accessToken = signAccessToken(username);
  const rawRefresh = generateRefreshToken();
  storeRefreshToken(username, rawRefresh, refreshExpiresAt());
  res.cookie("refresh_token", rawRefresh, refreshCookieOptions());
  return { accessToken, expiresIn: ACCESS_TTL_SEC };
}

function requireAuth(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return res.status(401).json({ error: "Chưa đăng nhập", code: "NO_TOKEN" });

  try {
    const payload = verifyAccessToken(token);
    req.adminUser = payload.sub;
    return next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Access token hết hạn", code: "TOKEN_EXPIRED" });
    }
    return res.status(401).json({ error: "Token không hợp lệ", code: "INVALID_TOKEN" });
  }
}

router.post("/login", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  if (!verifyAdmin(username, password)) {
    return res.status(401).json({ error: "Sai tài khoản hoặc mật khẩu" });
  }

  const tokens = issueTokens(res, username);
  res.json({ ok: true, username, ...tokens });
});

router.post("/refresh", (req, res) => {
  const rawRefresh = req.cookies?.refresh_token;
  if (!rawRefresh) {
    return res.status(401).json({ error: "Không có refresh token", code: "NO_REFRESH" });
  }

  const row = getRefreshTokenRow(rawRefresh);
  if (!row) {
    res.clearCookie("refresh_token", { path: "/api/admin" });
    return res.status(401).json({ error: "Refresh token không hợp lệ", code: "INVALID_REFRESH" });
  }

  deleteRefreshToken(rawRefresh);
  const tokens = issueTokens(res, row.username);
  res.json({ ok: true, username: row.username, ...tokens });
});

router.post("/logout", (req, res) => {
  const rawRefresh = req.cookies?.refresh_token;
  if (rawRefresh) deleteRefreshToken(rawRefresh);
  res.clearCookie("refresh_token", { path: "/api/admin" });
  res.json({ ok: true });
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ loggedIn: true, username: req.adminUser });
});

router.get("/config", requireAuth, (_req, res) => {
  const config = getServerConfig();
  const cf = getCloudflareSettings();
  res.json({
    ...config,
    primary_origin_domain: getPrimaryOriginDomain(),
    main_parent_domain: getMainParentDomain()?.domain || "",
    cloudflare: {
      configured: Boolean(cf.api_token && cf.zone_id),
      has_public_ip: Boolean(cf.public_ip),
      proxied: cf.proxied,
    },
  });
});

router.get("/nginx/config", requireAuth, (_req, res) => {
  res.json({
    deployPath: DEPLOY_PATH,
    targetPath: process.env.NGINX_CONFIG_PATH || "",
    autoReload: process.env.NGINX_AUTO_RELOAD !== "0",
    content: generateNginxLandingConfig(),
  });
});

router.post("/nginx/sync", requireAuth, (req, res) => {
  try {
    const result = syncNginxConfig({
      reload: req.body.reload !== false,
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/parent-domains/:id/set-main", requireAuth, (req, res) => {
  try {
    const result = setMainParentDomain(Number(req.params.id));
    res.json({
      ok: true,
      parent: result,
      primary_origin_domain: result.primary_origin_domain,
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/sites/export", requireAuth, (_req, res) => {
  const config = getServerConfig();
  res.json({
    exported_at: new Date().toISOString(),
    server: config,
    sites: exportSites(getAllSites(), config),
  });
});

router.post("/cloudflare/verify", requireAuth, async (_req, res) => {
  const cf = getCloudflareSettings();
  if (!cf.api_token) return res.status(400).json({ error: "Chưa nhập API Token" });
  try {
    const result = await verifyToken(cf.api_token);
    res.json({ ok: true, status: result.status });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/cloudflare/dns", requireAuth, async (req, res) => {
  const domain = String(req.body.domain || "").trim().toLowerCase();
  if (!domain || domain === "localhost" || domain === "127.0.0.1") {
    return res.status(400).json({ error: "Domain không hợp lệ để tạo DNS" });
  }
  try {
    const dns = await provisionDomainDns(domain);
    res.json({ ok: true, ...dns });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/parent-domains", requireAuth, (_req, res) => {
  res.json(getAllParentDomains());
});

router.post("/parent-domains", requireAuth, (req, res) => {
  try {
    const parent = createParentDomain({
      domain: req.body.domain,
      name: req.body.name,
      cf_api_token: req.body.cf_api_token,
      cf_zone_id: req.body.cf_zone_id,
      server_ip: req.body.server_ip,
      cf_proxied: req.body.cf_proxied !== false,
      note: req.body.note,
      active: req.body.active !== false,
    });
    res.status(201).json(parent);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put("/parent-domains/:id", requireAuth, (req, res) => {
  try {
    const parent = updateParentDomain(Number(req.params.id), {
      domain: req.body.domain,
      name: req.body.name,
      cf_api_token: req.body.cf_api_token,
      cf_zone_id: req.body.cf_zone_id,
      server_ip: req.body.server_ip,
      cf_proxied: req.body.cf_proxied,
      note: req.body.note,
      active: req.body.active,
    });
    res.json(parent);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete("/parent-domains/:id", requireAuth, (req, res) => {
  try {
    deleteParentDomain(Number(req.params.id));
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/parent-domains/:id/verify", requireAuth, async (req, res) => {
  const row = getParentDomainById(Number(req.params.id), { includeSecrets: true });
  if (!row?.cf_api_token) return res.status(400).json({ error: "Chưa có API Token" });
  try {
    const result = await verifyToken(row.cf_api_token);
    res.json({ ok: true, status: result.status });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/parent-domains/:id/dns", requireAuth, async (req, res) => {
  const parent = getParentDomainById(Number(req.params.id));
  if (!parent) return res.status(404).json({ error: "Không tìm thấy" });
  const domain = String(req.body.domain || parent.domain).trim().toLowerCase();
  try {
    const dns = await provisionDomainDns(domain);
    res.json({ ok: true, ...dns, domain });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/parent-domains/:id/subdomains", requireAuth, async (req, res) => {
  const parentId = Number(req.params.id);
  if (!getParentDomainById(parentId)) return res.status(404).json({ error: "Không tìm thấy domain cha" });
  try {
    const subdomain = createSubdomain({
      parent_id: parentId,
      subdomain: req.body.subdomain,
      note: req.body.note,
      active: req.body.active !== false,
    });

    let dns = null;
    if (req.body.auto_dns !== false) {
      try {
        dns = await provisionDomainDns(subdomain.domain);
      } catch (e) {
        dns = { error: e.message };
      }
    }

    const config = getServerConfig();
    res.status(201).json({
      subdomain: {
        ...subdomain,
        ...buildSiteUrls(subdomain.domain, config),
      },
      dns,
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/subdomains", requireAuth, (req, res) => {
  const config = getServerConfig();
  const available = req.query.available === "1" || req.query.available === "true";
  const siteId = req.query.site_id ? Number(req.query.site_id) : undefined;
  const rows = getAllSubdomains({ available, siteId }).map((row) => ({
    ...row,
    ...buildSiteUrls(row.domain, config),
  }));
  res.json(rows);
});

router.delete("/subdomains/:id", requireAuth, async (req, res) => {
  try {
    const domain = deleteSubdomain(Number(req.params.id));
    let dns = null;
    try {
      dns = await removeDomainDns(domain);
    } catch (e) {
      dns = { domain, error: e.message };
    }
    res.json({ ok: true, dns });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/preview", requireAuth, (req, res) => {
  try {
    const site = buildPreviewSite(req.body);
    res.render("landing", { site }, (err, html) => {
      if (err) {
        return res.status(400).json({ error: err.message });
      }
      res.type("html").send(preparePreviewHtml(html, req));
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/sites", requireAuth, (_req, res) => {
  const config = getServerConfig();
  const sites = getAllSites().map((site) => ({
    ...site,
    ...buildSiteUrls(site.domain, config),
  }));
  res.json(sites);
});

router.get("/sites/:id", requireAuth, (req, res) => {
  const site = getSiteById(Number(req.params.id));
  if (!site) return res.status(404).json({ error: "Không tìm thấy" });
  res.json(site);
});

router.post("/sites", requireAuth, (req, res) => {
  try {
    const site = createSite(req.body);
    res.status(201).json(site);
  } catch (e) {
    res.status(400).json({ error: e.message.includes("UNIQUE") ? "Domain đã tồn tại" : e.message });
  }
});

router.put("/sites/:id", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!getSiteById(id)) return res.status(404).json({ error: "Không tìm thấy" });
  try {
    const site = updateSite(id, req.body);
    res.json(site);
  } catch (e) {
    res.status(400).json({ error: e.message.includes("UNIQUE") ? "Domain đã tồn tại" : e.message });
  }
});

router.delete("/sites/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!getSiteById(id)) return res.status(404).json({ error: "Không tìm thấy" });

  const dns = await removeDnsForSite(id);
  deleteSite(id);
  res.json({ ok: true, dns });
});

router.post("/upload-multiple", requireAuth, upload.array("files", 20), (req, res) => {
  const urls = (req.files || []).map((f) => `/uploads/${f.filename}`);
  res.json({ urls });
});

module.exports = router;
