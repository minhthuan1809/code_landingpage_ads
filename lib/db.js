const initSqlJs = require("sql.js");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");

const dataDir = path.join(__dirname, "..", "data");
const dbPath = path.join(dataDir, "shop.db");

let db;

function persist() {
  const buffer = Buffer.from(db.export());
  fs.writeFileSync(dbPath, buffer);
}

function getLastInsertRowid() {
  const result = db.exec("SELECT last_insert_rowid() AS id");
  return result[0]?.values[0][0];
}

function bindParams(stmt, params) {
  if (!params.length) return;
  const values = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
  stmt.bind(values);
}

function prepare(sql) {
  return {
    get(...params) {
      const stmt = db.prepare(sql);
      bindParams(stmt, params);
      const row = stmt.step() ? stmt.getAsObject() : undefined;
      stmt.free();
      return row;
    },
    all(...params) {
      const stmt = db.prepare(sql);
      bindParams(stmt, params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();
      return rows;
    },
    run(params) {
      const stmt = db.prepare(sql);
      if (params !== undefined) {
        if (Array.isArray(params)) stmt.bind(params);
        else stmt.bind(params);
      }
      stmt.step();
      stmt.free();
      persist();
      return { lastInsertRowid: getLastInsertRowid() };
    },
  };
}

async function initDb() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const SQL = await initSqlJs({
    locateFile: (file) =>
      path.join(__dirname, "..", "node_modules", "sql.js", "dist", file),
  });

  if (fs.existsSync(dbPath)) {
    db = new SQL.Database(fs.readFileSync(dbPath));
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS sites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL DEFAULT '',
      page_title TEXT NOT NULL DEFAULT '',
      shop_logo_main TEXT NOT NULL DEFAULT 'NARA',
      shop_logo_accent TEXT NOT NULL DEFAULT 'Shop',
      shop_badge TEXT NOT NULL DEFAULT '✓ Chính hãng',
      tag_new TEXT NOT NULL DEFAULT 'New 2026',
      tag_hot TEXT NOT NULL DEFAULT 'Bán chạy',
      product_title TEXT NOT NULL DEFAULT '',
      seller_avatar TEXT NOT NULL DEFAULT 'N',
      seller_name TEXT NOT NULL DEFAULT '',
      seller_meta TEXT NOT NULL DEFAULT '',
      seller_verified TEXT NOT NULL DEFAULT 'Uy tín',
      stat_chip_1 TEXT NOT NULL DEFAULT 'Giao hàng toàn quốc',
      stat_chip_2 TEXT NOT NULL DEFAULT 'Miễn phí vận chuyển',
      detail_title TEXT NOT NULL DEFAULT '',
      detail_content TEXT NOT NULL DEFAULT '',
      messenger_url TEXT NOT NULL DEFAULT '',
      product_images TEXT NOT NULL DEFAULT '[]',
      detail_images TEXT NOT NULL DEFAULT '[]',
      other_products TEXT NOT NULL DEFAULT '[]',
      brand_color TEXT NOT NULL DEFAULT '#8b5a2b',
      accent_color TEXT NOT NULL DEFAULT '#1a1a1a',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    )
  `);

  migrateDb();
  persist();
}

function migrateDb() {
  const info = db.exec("PRAGMA table_info(sites)");
  const columns = (info[0]?.values || []).map((row) => row[1]);
  if (!columns.includes("visit_count")) {
    db.run("ALTER TABLE sites ADD COLUMN visit_count INTEGER NOT NULL DEFAULT 0");
  }
  if (!columns.includes("detail_images")) {
    db.run("ALTER TABLE sites ADD COLUMN detail_images TEXT NOT NULL DEFAULT '[]'");
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS site_daily_visits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id INTEGER NOT NULL,
      visit_date TEXT NOT NULL,
      ip TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(site_id, visit_date, ip)
    )
  `);
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_site_daily_visits_site_date ON site_daily_visits(site_id, visit_date)",
  );

  db.run(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_refresh_tokens_username ON refresh_tokens(username)",
  );

  db.run(`
    CREATE TABLE IF NOT EXISTS domains (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain TEXT NOT NULL UNIQUE,
      site_id INTEGER NOT NULL,
      is_primary INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_domains_site_id ON domains(site_id)");

  const domainColumns = (db.exec("PRAGMA table_info(domains)")[0]?.values || []).map(
    (row) => row[1],
  );
  if (!domainColumns.includes("parent_id")) {
    db.run("ALTER TABLE domains ADD COLUMN parent_id INTEGER");
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS parent_domains (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL DEFAULT '',
      cf_api_token TEXT NOT NULL DEFAULT '',
      cf_zone_id TEXT NOT NULL DEFAULT '',
      server_ip TEXT NOT NULL DEFAULT '',
      cf_proxied INTEGER NOT NULL DEFAULT 1,
      active INTEGER NOT NULL DEFAULT 1,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS subdomains (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_id INTEGER NOT NULL,
      subdomain TEXT NOT NULL,
      domain TEXT NOT NULL UNIQUE,
      site_id INTEGER,
      active INTEGER NOT NULL DEFAULT 1,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(parent_id, subdomain)
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_subdomains_site_id ON subdomains(site_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_subdomains_parent_id ON subdomains(parent_id)");

  migrateSubdomainsFromDomains();

  const domainCount = prepare("SELECT COUNT(*) AS c FROM domains").get().c;
  if (Number(domainCount) === 0) {
    const sites = prepare("SELECT id, domain, active FROM sites").all();
    for (const site of sites) {
      prepare(
        "INSERT OR IGNORE INTO domains (domain, site_id, is_primary, active) VALUES (?, ?, 1, ?)",
      ).run([site.domain, site.id, site.active]);
    }
  }
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  try {
    const hashVerify = crypto.scryptSync(password, salt, 64).toString("hex");
    const a = Buffer.from(hash, "hex");
    const b = Buffer.from(hashVerify, "hex");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function verifyAdmin(username, password) {
  const row = prepare("SELECT password_hash FROM admins WHERE username = ?").get(username);
  if (!row) return false;
  return verifyPassword(password, row.password_hash);
}

const DEFAULT_ADMIN_USER = "admin";
const DEFAULT_ADMIN_PASS = "Thuan18092003";

function seedAdmin() {
  const hash = hashPassword(DEFAULT_ADMIN_PASS);
  const exists = prepare("SELECT id FROM admins WHERE username = ?").get(
    DEFAULT_ADMIN_USER,
  );

  if (exists) {
    prepare("UPDATE admins SET password_hash = ? WHERE username = ?").run([
      hash,
      DEFAULT_ADMIN_USER,
    ]);
    return;
  }

  prepare("INSERT INTO admins (username, password_hash) VALUES (?, ?)").run([
    DEFAULT_ADMIN_USER,
    hash,
  ]);
  console.log("✓ Đã tạo tài khoản admin trong SQLite");
}

function parseSite(row) {
  if (!row) return null;
  const requestDomain = row.request_domain;
  const numericId = row.id;

  const site = {
    ...row,
    active: Boolean(row.active),
    visit_count: Number(row.visit_count) || 0,
    product_images: JSON.parse(row.product_images || "[]"),
    detail_images: JSON.parse(row.detail_images || "[]"),
    other_products: JSON.parse(row.other_products || "[]"),
  };

  delete site.request_domain;
  site.site_id = numericId;

  if (requestDomain) {
    site.id = requestDomain;
    site.domain = requestDomain;
  }

  return site;
}

function getTodayLocal() {
  return new Date().toLocaleDateString("en-CA");
}

function recordVisit(siteId, clientIp) {
  if (!siteId || !clientIp) return;

  const visitDate = getTodayLocal();
  db.run(
    "INSERT OR IGNORE INTO site_daily_visits (site_id, visit_date, ip) VALUES (?, ?, ?)",
    [siteId, visitDate, clientIp],
  );

  const inserted = Number(db.exec("SELECT changes()")[0]?.values[0]?.[0] || 0);
  if (inserted > 0) {
    db.run("UPDATE sites SET visit_count = COALESCE(visit_count, 0) + 1 WHERE id = ?", [
      siteId,
    ]);
    persist();
  }
}

function normalizeDomain(host) {
  if (!host) return "localhost";
  return host.split(":")[0].toLowerCase().replace(/^www\./, "");
}

function isLocalDomain(domain) {
  return domain === "localhost" || domain === "127.0.0.1";
}

function getSiteByDomain(host) {
  const domain = normalizeDomain(host);

  let row = prepare(`
    SELECT s.*, d.domain AS request_domain
    FROM domains d
    JOIN sites s ON s.id = d.site_id
    WHERE d.domain = ? AND d.active = 1 AND s.active = 1
  `).get([domain]);

  if (!row) {
    const siteRow = prepare("SELECT * FROM sites WHERE domain = ? AND active = 1").get([domain]);
    if (siteRow) {
      row = { ...siteRow, request_domain: domain };
    }
  }

  if (!row && isLocalDomain(domain)) {
    row = prepare(`
      SELECT s.*, d.domain AS request_domain
      FROM domains d
      JOIN sites s ON s.id = d.site_id
      WHERE d.domain = 'localhost' AND d.active = 1 AND s.active = 1
    `).get();
    if (!row) {
      const siteRow = prepare("SELECT * FROM sites WHERE domain = ? AND active = 1").get([
        "localhost",
      ]);
      if (siteRow) {
        row = { ...siteRow, request_domain: "localhost" };
      }
    }
  }

  return parseSite(row);
}

function formatPublicSite(site) {
  if (!site) return null;
  const {
    site_id,
    id,
    domain,
    name,
    page_title,
    shop_logo_main,
    shop_logo_accent,
    shop_badge,
    tag_new,
    tag_hot,
    product_title,
    seller_avatar,
    seller_name,
    seller_meta,
    seller_verified,
    stat_chip_1,
    stat_chip_2,
    detail_title,
    detail_content,
    messenger_url,
    product_images,
    detail_images,
    other_products,
    brand_color,
    accent_color,
    active,
    visit_count,
  } = site;

  return {
    id,
    domain,
    site_id,
    name,
    page_title,
    shop_logo_main,
    shop_logo_accent,
    shop_badge,
    tag_new,
    tag_hot,
    product_title,
    seller_avatar,
    seller_name,
    seller_meta,
    seller_verified,
    stat_chip_1,
    stat_chip_2,
    detail_title,
    detail_content,
    messenger_url,
    product_images,
    detail_images,
    other_products,
    brand_color,
    accent_color,
    active,
    visit_count,
  };
}

function parseDomain(row) {
  if (!row) return null;
  return {
    ...row,
    is_primary: Boolean(row.is_primary),
    active: Boolean(row.active),
  };
}

function parseParentDomain(row, { includeSecrets = false } = {}) {
  if (!row) return null;
  const parsed = {
    ...row,
    active: Boolean(row.active),
    cf_proxied: Boolean(row.cf_proxied),
    has_token: Boolean(row.cf_api_token),
  };
  if (!includeSecrets) delete parsed.cf_api_token;
  return parsed;
}

function getAllParentDomains() {
  return prepare("SELECT * FROM parent_domains ORDER BY domain ASC")
    .all()
    .map((row) => parseParentDomain(row));
}

function getParentDomainById(id, { includeSecrets = false } = {}) {
  return parseParentDomain(prepare("SELECT * FROM parent_domains WHERE id = ?").get([id]), {
    includeSecrets,
  });
}

function getParentDomainCredentials(id) {
  const row = prepare("SELECT * FROM parent_domains WHERE id = ? AND active = 1").get([id]);
  if (!row?.cf_api_token || !row.cf_zone_id || !row.server_ip) return null;
  return {
    id: row.id,
    domain: row.domain,
    token: row.cf_api_token,
    zoneId: row.cf_zone_id,
    ip: row.server_ip,
    proxied: Boolean(row.cf_proxied),
  };
}

function findParentForDomain(domain) {
  const normalized = normalizeDomain(domain);
  const parents = prepare("SELECT * FROM parent_domains WHERE active = 1 ORDER BY LENGTH(domain) DESC").all();
  for (const row of parents) {
    const parent = normalizeDomain(row.domain);
    if (normalized === parent || normalized.endsWith(`.${parent}`)) {
      return getParentDomainCredentials(row.id);
    }
  }
  return null;
}

function resolveCfForDomain(domain) {
  const normalized = normalizeDomain(domain);
  const bound = prepare("SELECT parent_id FROM domains WHERE domain = ?").get([normalized]);
  if (bound?.parent_id) {
    const fromParent = getParentDomainCredentials(bound.parent_id);
    if (fromParent) return fromParent;
  }

  const matched = findParentForDomain(normalized);
  if (matched) return matched;

  const global = getCloudflareSettings();
  if (!global.api_token || !global.zone_id || !global.public_ip) return null;
  return {
    id: null,
    domain: null,
    token: global.api_token,
    zoneId: global.zone_id,
    ip: global.public_ip,
    proxied: global.proxied,
  };
}

function createParentDomain({
  domain,
  name = "",
  cf_api_token = "",
  cf_zone_id = "",
  server_ip = "",
  cf_proxied = true,
  note = "",
  active = true,
}) {
  const normalized = normalizeDomain(domain);
  if (!normalized || normalized === "localhost" || normalized === "127.0.0.1") {
    throw new Error("Domain cha không hợp lệ");
  }
  if (!cf_api_token) throw new Error("Cần Cloudflare API Token");
  if (!cf_zone_id) throw new Error("Cần Zone ID");
  if (!server_ip) throw new Error("Cần IP server");

  prepare(`
    INSERT INTO parent_domains (
      domain, name, cf_api_token, cf_zone_id, server_ip, cf_proxied, active, note
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run([
    normalized,
    name || normalized,
    cf_api_token,
    cf_zone_id,
    server_ip,
    cf_proxied ? 1 : 0,
    active ? 1 : 0,
    note || "",
  ]);
  const row = prepare("SELECT id FROM parent_domains WHERE domain = ?").get([normalized]);
  return getParentDomainById(row?.id);
}

function updateParentDomain(id, data) {
  const current = prepare("SELECT * FROM parent_domains WHERE id = ?").get([id]);
  if (!current) throw new Error("Domain cha không tồn tại");

  const nextToken =
    data.cf_api_token !== undefined && data.cf_api_token !== ""
      ? data.cf_api_token
      : current.cf_api_token;

  prepare(`
    UPDATE parent_domains SET
      domain = ?, name = ?, cf_api_token = ?, cf_zone_id = ?,
      server_ip = ?, cf_proxied = ?, active = ?, note = ?
    WHERE id = ?
  `).run([
    data.domain !== undefined ? normalizeDomain(data.domain) : current.domain,
    data.name !== undefined ? data.name : current.name,
    nextToken,
    data.cf_zone_id !== undefined ? data.cf_zone_id : current.cf_zone_id,
    data.server_ip !== undefined ? data.server_ip : current.server_ip,
    data.cf_proxied !== undefined ? (data.cf_proxied ? 1 : 0) : current.cf_proxied,
    data.active !== undefined ? (data.active ? 1 : 0) : current.active,
    data.note !== undefined ? data.note : current.note,
    id,
  ]);

  return getParentDomainById(id);
}

function deleteParentDomain(id) {
  const childCount = prepare("SELECT COUNT(*) AS c FROM subdomains WHERE parent_id = ?").get([id]).c;
  if (Number(childCount) > 0) {
    throw new Error("Không thể xóa domain cha đang có subdomain");
  }
  prepare("DELETE FROM parent_domains WHERE id = ?").run([id]);
}

function migrateSubdomainsFromDomains() {
  const rows = prepare(`
    SELECT d.domain, d.site_id, d.parent_id, p.domain AS parent_domain
    FROM domains d
    JOIN parent_domains p ON p.id = d.parent_id
    WHERE d.parent_id IS NOT NULL AND d.domain != p.domain
  `).all();

  for (const row of rows) {
    const parentDomain = normalizeDomain(row.parent_domain);
    const full = normalizeDomain(row.domain);
    if (full === parentDomain) continue;
    const exists = prepare("SELECT id FROM subdomains WHERE domain = ?").get([full]);
    if (exists) continue;
    const suffix = `.${parentDomain}`;
    const subdomain =
      full === parentDomain ? "@" : full.endsWith(suffix) ? full.slice(0, -suffix.length) : full;
    prepare(`
      INSERT OR IGNORE INTO subdomains (parent_id, subdomain, domain, site_id, active)
      VALUES (?, ?, ?, ?, 1)
    `).run([row.parent_id, subdomain, full, row.site_id || null]);
  }
}

function parseSubdomain(row) {
  if (!row) return null;
  return {
    ...row,
    active: Boolean(row.active),
    available: row.site_id == null,
  };
}

function getAllSubdomains({ available, siteId } = {}) {
  let sql = `
    SELECT s.*, p.domain AS parent_domain,
      st.name AS site_name, st.page_title
    FROM subdomains s
    JOIN parent_domains p ON p.id = s.parent_id
    LEFT JOIN sites st ON st.id = s.site_id
    WHERE 1=1
  `;
  const params = [];
  if (available) {
    sql += " AND s.site_id IS NULL";
  }
  if (siteId != null) {
    sql += " AND (s.site_id IS NULL OR s.site_id = ?)";
    params.push(siteId);
  }
  sql += " ORDER BY s.domain ASC";
  return prepare(sql).all(params).map(parseSubdomain);
}

function getSubdomainById(id) {
  return parseSubdomain(
    prepare(`
      SELECT s.*, p.domain AS parent_domain
      FROM subdomains s
      JOIN parent_domains p ON p.id = s.parent_id
      WHERE s.id = ?
    `).get([id]),
  );
}

function getSubdomainByDomain(domain) {
  return parseSubdomain(
    prepare(`
      SELECT s.*, p.domain AS parent_domain
      FROM subdomains s
      JOIN parent_domains p ON p.id = s.parent_id
      WHERE s.domain = ?
    `).get([normalizeDomain(domain)]),
  );
}

function getSubdomainForSite(siteId) {
  return parseSubdomain(
    prepare(`
      SELECT s.*, p.domain AS parent_domain
      FROM subdomains s
      JOIN parent_domains p ON p.id = s.parent_id
      WHERE s.site_id = ?
    `).get([siteId]),
  );
}

function createSubdomain({ parent_id, subdomain, note = "", active = true }) {
  const parent = getParentDomainById(parent_id);
  if (!parent) throw new Error("Domain cha không tồn tại");

  const { buildChildDomain } = require("./parent-domains");
  const childDomain = buildChildDomain(parent.domain, subdomain);

  const exists = prepare("SELECT id FROM subdomains WHERE domain = ?").get([childDomain]);
  if (exists) throw new Error("Subdomain đã tồn tại");

  const siteExists = prepare("SELECT id FROM sites WHERE domain = ?").get([childDomain]);
  if (siteExists) throw new Error("Domain đã được dùng cho trang khác");

  const label = childDomain === normalizeDomain(parent.domain)
    ? "@"
    : childDomain.replace(`.${normalizeDomain(parent.domain)}`, "");

  prepare(`
    INSERT INTO subdomains (parent_id, subdomain, domain, site_id, active, note)
    VALUES (?, ?, ?, NULL, ?, ?)
  `).run([parent_id, label, childDomain, active ? 1 : 0, note || ""]);

  const row = prepare("SELECT id FROM subdomains WHERE domain = ?").get([childDomain]);
  return getSubdomainById(row?.id);
}

function assignSubdomainToSite(subdomainId, siteId) {
  const sub = getSubdomainById(subdomainId);
  if (!sub) throw new Error("Subdomain không tồn tại");
  if (sub.site_id && Number(sub.site_id) !== Number(siteId)) {
    throw new Error("Subdomain đã được gán cho trang khác");
  }
  prepare("UPDATE subdomains SET site_id = ? WHERE id = ?").run([siteId, subdomainId]);
  return getSubdomainById(subdomainId);
}

function unlinkSubdomainsForSite(siteId) {
  prepare("UPDATE subdomains SET site_id = NULL WHERE site_id = ?").run([siteId]);
}

function deleteSubdomain(id) {
  const sub = getSubdomainById(id);
  if (!sub) throw new Error("Subdomain không tồn tại");
  if (sub.site_id) throw new Error("Subdomain đang gán cho trang. Hãy xóa hoặc đổi domain trang trước.");
  prepare("DELETE FROM subdomains WHERE id = ?").run([id]);
  return sub.domain;
}

function isManagedSubdomain(domain) {
  return Boolean(
    prepare("SELECT id FROM subdomains WHERE domain = ?").get([normalizeDomain(domain)]),
  );
}

function getAllDomains() {
  return prepare(`
    SELECT d.*, s.name AS site_name, s.page_title, s.product_title,
      p.domain AS parent_domain, p.name AS parent_name
    FROM domains d
    JOIN sites s ON s.id = d.site_id
    LEFT JOIN parent_domains p ON p.id = d.parent_id
    ORDER BY d.domain ASC
  `)
    .all()
    .map(parseDomain);
}

function getDomainById(id) {
  return parseDomain(
    prepare(`
      SELECT d.*, s.name AS site_name, s.page_title, s.product_title
      FROM domains d
      JOIN sites s ON s.id = d.site_id
      WHERE d.id = ?
    `).get([id]),
  );
}

function syncPrimaryDomain(siteId, domain, active = 1, parentId = null) {
  const normalized = normalizeDomain(domain);
  const existing = prepare("SELECT id, parent_id FROM domains WHERE site_id = ? AND is_primary = 1").get([
    siteId,
  ]);
  const resolvedParentId = parentId ?? existing?.parent_id ?? null;

  if (existing) {
    prepare("UPDATE domains SET domain = ?, active = ?, parent_id = ? WHERE id = ?").run([
      normalized,
      active ? 1 : 0,
      resolvedParentId,
      existing.id,
    ]);
    return;
  }

  const boundElsewhere = prepare("SELECT id FROM domains WHERE domain = ? AND site_id != ?").get([
    normalized,
    siteId,
  ]);
  if (boundElsewhere) {
    prepare("UPDATE domains SET site_id = ?, is_primary = 1, active = ? WHERE id = ?").run([
      siteId,
      active ? 1 : 0,
      boundElsewhere.id,
    ]);
    return;
  }

  prepare(
    "INSERT INTO domains (domain, site_id, is_primary, active, parent_id) VALUES (?, ?, 1, ?, ?)",
  ).run([normalized, siteId, active ? 1 : 0, resolvedParentId]);
}

function createDomain({ domain, site_id, note = "", active = true, parent_id = null }) {
  const normalized = normalizeDomain(domain);
  if (!normalized) throw new Error("Domain không hợp lệ");
  if (!getSiteById(site_id)) throw new Error("Trang web không tồn tại");

  let resolvedParentId = parent_id ? Number(parent_id) : null;
  if (resolvedParentId) {
    const parent = getParentDomainById(resolvedParentId);
    if (!parent) throw new Error("Domain cha không tồn tại");
    const { domainBelongsToParent } = require("./parent-domains");
    if (!domainBelongsToParent(normalized, parent.domain)) {
      throw new Error(`Domain phải thuộc ${parent.domain}`);
    }
  }

  const exists = prepare("SELECT id FROM domains WHERE domain = ?").get([normalized]);
  if (exists) throw new Error("Domain đã được liên kết");

  const result = prepare(
    "INSERT INTO domains (domain, site_id, is_primary, active, note, parent_id) VALUES (?, ?, 0, ?, ?, ?)",
  ).run([normalized, site_id, active ? 1 : 0, note || "", resolvedParentId]);
  return getDomainById(result.lastInsertRowid);
}

function updateDomain(id, { site_id, active, note }) {
  const current = getDomainById(id);
  if (!current) throw new Error("Domain không tồn tại");

  const nextSiteId = site_id ?? current.site_id;
  if (!getSiteById(nextSiteId)) throw new Error("Trang web không tồn tại");

  prepare(
    "UPDATE domains SET site_id = ?, active = ?, note = ? WHERE id = ?",
  ).run([
    nextSiteId,
    active === undefined ? (current.active ? 1 : 0) : active ? 1 : 0,
    note === undefined ? current.note : note,
    id,
  ]);

  return getDomainById(id);
}

function getDomainsForSite(siteId) {
  return prepare("SELECT domain FROM domains WHERE site_id = ?")
    .all([siteId])
    .map((row) => row.domain);
}

function shouldRemoveDnsForDomain(domain) {
  const normalized = normalizeDomain(domain);
  if (isLocalDomain(normalized)) return false;
  if (isManagedSubdomain(normalized)) return false;
  const parentRoot = prepare("SELECT id FROM parent_domains WHERE domain = ?").get([
    normalized,
  ]);
  return !parentRoot;
}

function deleteDomain(id) {
  const row = getDomainById(id);
  if (!row) throw new Error("Domain không tồn tại");
  if (row.is_primary) {
    throw new Error("Không thể xóa domain chính. Hãy xóa trang trong form sửa.");
  }
  prepare("DELETE FROM domains WHERE id = ?").run([id]);
  return row.domain;
}

function deleteSite(id) {
  const domains = getDomainsForSite(id);
  unlinkSubdomainsForSite(id);
  prepare("DELETE FROM site_daily_visits WHERE site_id = ?").run([id]);
  prepare("DELETE FROM domains WHERE site_id = ?").run([id]);
  prepare("DELETE FROM sites WHERE id = ?").run([id]);
  return domains;
}

function getAllSites() {
  return prepare("SELECT * FROM sites ORDER BY id DESC").all().map(parseSite);
}

function getSiteById(id) {
  const site = parseSite(prepare("SELECT * FROM sites WHERE id = ?").get(id));
  if (!site) return null;
  const sub = getSubdomainForSite(site.id);
  return { ...site, subdomain_id: sub?.id || null };
}

function siteValues(s) {
  return [
    s.domain,
    s.name,
    s.page_title,
    s.shop_logo_main,
    s.shop_logo_accent,
    s.shop_badge,
    s.tag_new,
    s.tag_hot,
    s.product_title,
    s.seller_avatar,
    s.seller_name,
    s.seller_meta,
    s.seller_verified,
    s.stat_chip_1,
    s.stat_chip_2,
    s.detail_title,
    s.detail_content,
    s.messenger_url,
    s.product_images,
    s.detail_images,
    s.other_products,
    s.brand_color,
    s.accent_color,
    s.active,
  ];
}

function createSite(data) {
  const subdomainId = data.subdomain_id ? Number(data.subdomain_id) : null;
  let parentId = data.parent_id ? Number(data.parent_id) : null;
  let payload = { ...data };

  if (subdomainId) {
    const sub = getSubdomainById(subdomainId);
    if (!sub) throw new Error("Subdomain không tồn tại");
    if (sub.site_id) throw new Error("Subdomain đã được gán cho trang khác");
    payload.domain = sub.domain;
    parentId = sub.parent_id;
  }

  const s = serializeSite(payload);
  prepare(`
    INSERT INTO sites (
      domain, name, page_title, shop_logo_main, shop_logo_accent, shop_badge,
      tag_new, tag_hot, product_title, seller_avatar, seller_name, seller_meta,
      seller_verified, stat_chip_1, stat_chip_2, detail_title, detail_content,
      messenger_url, product_images, detail_images, other_products, brand_color, accent_color, active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(siteValues(s));
  const site = parseSite(prepare("SELECT * FROM sites WHERE domain = ?").get([s.domain]));
  syncPrimaryDomain(site.id, site.domain, site.active, parentId);
  if (subdomainId) assignSubdomainToSite(subdomainId, site.id);
  return getSiteById(site.id);
}

function updateSite(id, data) {
  const existing = getSiteById(id);
  if (!existing) throw new Error("Trang không tồn tại");
  const { subdomain_id: _currentSubId, ...current } = existing;
  const currentSub = getSubdomainForSite(id);
  let parentId = currentSub?.parent_id || null;
  let payload = { ...current, ...data };

  if (data.subdomain_id !== undefined) {
    const nextId = data.subdomain_id ? Number(data.subdomain_id) : null;
    unlinkSubdomainsForSite(id);
    if (nextId) {
      const sub = getSubdomainById(nextId);
      if (!sub) throw new Error("Subdomain không tồn tại");
      if (sub.site_id && Number(sub.site_id) !== Number(id)) {
        throw new Error("Subdomain đã được gán cho trang khác");
      }
      payload.domain = sub.domain;
      parentId = sub.parent_id;
      assignSubdomainToSite(nextId, id);
    } else {
      parentId = null;
    }
  } else if (
    currentSub &&
    data.domain &&
    normalizeDomain(data.domain) !== normalizeDomain(currentSub.domain)
  ) {
    unlinkSubdomainsForSite(id);
    parentId = null;
  }

  const s = serializeSite(payload);
  prepare(`
    UPDATE sites SET
      domain = ?, name = ?, page_title = ?,
      shop_logo_main = ?, shop_logo_accent = ?,
      shop_badge = ?, tag_new = ?, tag_hot = ?,
      product_title = ?, seller_avatar = ?,
      seller_name = ?, seller_meta = ?,
      seller_verified = ?, stat_chip_1 = ?,
      stat_chip_2 = ?, detail_title = ?,
      detail_content = ?, messenger_url = ?,
      product_images = ?, detail_images = ?, other_products = ?,
      brand_color = ?, accent_color = ?,
      active = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run([...siteValues(s), id]);
  const site = getSiteById(id);
  syncPrimaryDomain(site.id, site.domain, site.active, parentId);
  return site;
}

function serializeSite(data) {
  return {
    domain: normalizeDomain(data.domain || "localhost"),
    name: data.name || "",
    page_title: data.page_title || "",
    shop_logo_main: data.shop_logo_main || "NARA",
    shop_logo_accent: data.shop_logo_accent || "Shop",
    shop_badge: data.shop_badge || "✓ Chính hãng",
    tag_new: data.tag_new || "",
    tag_hot: data.tag_hot || "",
    product_title: data.product_title || "",
    seller_avatar: data.seller_avatar || "N",
    seller_name: data.seller_name || "",
    seller_meta: data.seller_meta || "",
    seller_verified: data.seller_verified || "Uy tín",
    stat_chip_1: data.stat_chip_1 || "",
    stat_chip_2: data.stat_chip_2 || "",
    detail_title: data.detail_title || "",
    detail_content: data.detail_content || "",
    messenger_url: data.messenger_url || "",
    product_images: JSON.stringify(data.product_images || []),
    detail_images: JSON.stringify(data.detail_images || []),
    other_products: JSON.stringify(data.other_products || []),
    brand_color: data.brand_color || "#8b5a2b",
    accent_color: data.accent_color || "#1a1a1a",
    active: data.active === false || data.active === 0 ? 0 : 1,
  };
}

function seedIfEmpty() {
  const count = prepare("SELECT COUNT(*) as c FROM sites").get().c;
  if (count > 0) return;

  const carouselImages = [
    "/uploads/1781246588896-dc5ccfb5.png",
    "/uploads/1781246588927-12bdf961.png",
    "/uploads/1781246588954-4853f5e8.png",
  ];
  const detailImages = [
    "/uploads/1781246593511-dec201cb.png",
    "/uploads/1781246593551-d6b3ffa2.png",
    "/uploads/1781246593580-3e1067c5.png",
  ];

  createSite({
    domain: "localhost",
    name: "NARA Shop Demo",
    page_title: "NARA Shop - Quần ống rộng APQ41 New 2026",
    product_title: "Quần ống rộng họa tiết caro APQ41 – Vải cotton co giãn",
    seller_name: "Xưởng may APQ41",
    seller_meta: "65,2K đã bán · Phản hồi trong 1 giờ",
    detail_title:
      "Quần ống rộng họa tiết caro cạp cao – Chất vải cotton pha co giãn New 2026, form chuẩn tôn dáng nữ APQ41",
    detail_content: `<p class="rich-heading">Thông tin sản phẩm</p>
<p><strong>Màu sắc:</strong> Nâu caro, Đen caro, Kem, Be</p>
<p>Chất liệu cotton pha co giãn nhẹ, mặc mát, thoáng khí, thấm hút mồ hôi tốt. Form ống rộng tôn dáng, phù hợp mọi vóc dáng.</p>
<p>Phối cùng áo thun, áo len tăm, áo hai dây — thích hợp đi làm, đi chơi, đi biển hoặc mặc ở nhà.</p>`,
    messenger_url: "https://m.me/61581534346825",
    product_images: carouselImages,
    detail_images: detailImages,
    other_products: [
      { name: "Quần ống rộng họa tiết caro", tag: "Bán chạy", img: carouselImages[0] },
      { name: "Áo len tăm sát nách", tag: "Mới về", img: carouselImages[1] },
      { name: "Set đồ đi biển thanh lịch", tag: "Combo", img: carouselImages[2] },
      { name: "Quần suông caro cạp cao", tag: "Yêu thích", img: detailImages[0] },
    ],
  });

  console.log("✓ Đã tạo dữ liệu mẫu (domain: localhost)");
}

function getSetting(key, fallback = "") {
  const row = prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row?.value ?? fallback;
}

function setSetting(key, value) {
  prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run([key, value ?? ""]);
}

function getCloudflareSettings() {
  return {
    api_token: getSetting("cf_api_token") || process.env.CLOUDFLARE_API_TOKEN || "",
    zone_id: getSetting("cf_zone_id") || process.env.CLOUDFLARE_ZONE_ID || "",
    public_ip: getSetting("public_ip") || process.env.PUBLIC_IP || process.env.SERVER_IP || "",
    proxied: getSetting("cf_proxied", "1") !== "0",
  };
}

function storeRefreshToken(username, rawToken, expiresAt) {
  const { hashToken } = require("./auth");
  prepare(
    "INSERT INTO refresh_tokens (username, token_hash, expires_at) VALUES (?, ?, ?)",
  ).run([username, hashToken(rawToken), expiresAt]);
}

function getRefreshTokenRow(rawToken) {
  const { hashToken } = require("./auth");
  return prepare(
    "SELECT * FROM refresh_tokens WHERE token_hash = ? AND CAST(expires_at AS INTEGER) > ?",
  ).get([hashToken(rawToken), Date.now()]);
}

function deleteRefreshToken(rawToken) {
  const { hashToken } = require("./auth");
  prepare("DELETE FROM refresh_tokens WHERE token_hash = ?").run([hashToken(rawToken)]);
}

function deleteRefreshTokensForUser(username) {
  prepare("DELETE FROM refresh_tokens WHERE username = ?").run([username]);
}

function saveCloudflareSettings({ api_token, zone_id, public_ip, proxied }) {
  if (api_token !== undefined && api_token !== "") setSetting("cf_api_token", api_token);
  if (zone_id !== undefined) setSetting("cf_zone_id", zone_id);
  if (public_ip !== undefined) setSetting("public_ip", public_ip);
  if (proxied !== undefined) setSetting("cf_proxied", proxied ? "1" : "0");
  return getCloudflareSettings();
}

module.exports = {
  initDb,
  seedIfEmpty,
  seedAdmin,
  verifyAdmin,
  normalizeDomain,
  isLocalDomain,
  getSiteByDomain,
  formatPublicSite,
  getAllSites,
  getSiteById,
  getAllDomains,
  getDomainById,
  getAllParentDomains,
  getParentDomainById,
  getParentDomainCredentials,
  resolveCfForDomain,
  createParentDomain,
  updateParentDomain,
  deleteParentDomain,
  getAllSubdomains,
  getSubdomainById,
  getSubdomainForSite,
  createSubdomain,
  deleteSubdomain,
  isManagedSubdomain,
  createDomain,
  updateDomain,
  deleteDomain,
  getDomainsForSite,
  shouldRemoveDnsForDomain,
  createSite,
  updateSite,
  deleteSite,
  recordVisit,
  storeRefreshToken,
  getRefreshTokenRow,
  deleteRefreshToken,
  deleteRefreshTokensForUser,
  getCloudflareSettings,
  saveCloudflareSettings,
};
