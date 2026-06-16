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
    CREATE TABLE IF NOT EXISTS site_buy_clicks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id INTEGER NOT NULL,
      ip TEXT NOT NULL,
      clicked_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_site_buy_clicks_site_id ON site_buy_clicks(site_id)",
  );
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_site_buy_clicks_site_ip ON site_buy_clicks(site_id, ip)",
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

  const parentColumns = (db.exec("PRAGMA table_info(parent_domains)")[0]?.values || []).map(
    (row) => row[1],
  );
  if (!parentColumns.includes("cname_target")) {
    db.run("ALTER TABLE parent_domains ADD COLUMN cname_target TEXT NOT NULL DEFAULT ''");
  }
  if (!parentColumns.includes("is_main")) {
    db.run("ALTER TABLE parent_domains ADD COLUMN is_main INTEGER NOT NULL DEFAULT 0");
  }
  const hasMainParent = prepare("SELECT id FROM parent_domains WHERE is_main = 1 LIMIT 1").get();
  if (!hasMainParent) {
    const preferred = prepare("SELECT id FROM parent_domains WHERE domain = ?").get([
      "shopacc24h.shop",
    ]);
    const seedParent =
      preferred || prepare("SELECT id FROM parent_domains ORDER BY id ASC LIMIT 1").get();
    if (seedParent?.id) {
      prepare("UPDATE parent_domains SET is_main = 1 WHERE id = ?").run([seedParent.id]);
    }
  }
  const mainParentRow = prepare("SELECT domain FROM parent_domains WHERE is_main = 1 LIMIT 1").get();
  if (mainParentRow?.domain) {
    setSetting("primary_origin_domain", buildOriginHostname(mainParentRow.domain));
  }

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
  const exists = prepare("SELECT id FROM admins WHERE username = ?").get(
    DEFAULT_ADMIN_USER,
  );
  if (exists) return;

  prepare("INSERT INTO admins (username, password_hash) VALUES (?, ?)").run([
    DEFAULT_ADMIN_USER,
    hashPassword(DEFAULT_ADMIN_PASS),
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

function recordBuyClick(siteId, clientIp) {
  if (!siteId || !clientIp) {
    return { click_count_for_ip: 0 };
  }

  prepare("INSERT INTO site_buy_clicks (site_id, ip) VALUES (?, ?)").run([siteId, clientIp]);
  const row = prepare(
    "SELECT COUNT(*) AS click_count_for_ip FROM site_buy_clicks WHERE site_id = ? AND ip = ?",
  ).get([siteId, clientIp]);
  return { click_count_for_ip: Number(row?.click_count_for_ip || 0) };
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function eachIsoDateDesc(fromDate, toDate) {
  const dates = [];
  const current = new Date(`${toDate}T00:00:00Z`);
  const end = new Date(`${fromDate}T00:00:00Z`);
  while (current >= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() - 1);
  }
  return dates;
}

function getVisitAnalytics({ from, to } = {}) {
  const today = getTodayLocal();
  let fromDate = isIsoDate(from) ? from : today;
  let toDate = isIsoDate(to) ? to : fromDate;
  if (fromDate > toDate) {
    [fromDate, toDate] = [toDate, fromDate];
  }

  const byDate = prepare(`
    SELECT visit_date, COUNT(*) AS visits
    FROM site_daily_visits
    WHERE visit_date BETWEEN ? AND ?
    GROUP BY visit_date
    ORDER BY visit_date DESC
  `).all([fromDate, toDate]);

  const bySite = prepare(`
    SELECT
      s.id AS site_id,
      s.domain,
      s.name,
      s.page_title,
      s.product_title,
      COUNT(v.id) AS visits
    FROM sites s
    LEFT JOIN site_daily_visits v
      ON v.site_id = s.id
      AND v.visit_date BETWEEN ? AND ?
    GROUP BY s.id
    ORDER BY visits DESC, s.id DESC
  `).all([fromDate, toDate]);

  const total = byDate.reduce((sum, row) => sum + Number(row.visits || 0), 0);
  const visitsByDate = new Map(
    byDate.map((row) => [row.visit_date, Number(row.visits || 0)]),
  );

  return {
    from: fromDate,
    to: toDate,
    total,
    by_date: eachIsoDateDesc(fromDate, toDate).map((date) => ({
      date,
      visits: visitsByDate.get(date) || 0,
    })),
    by_site: bySite.map((row) => ({
      site_id: Number(row.site_id),
      domain: row.domain,
      name: row.name || "",
      page_title: row.page_title || "",
      product_title: row.product_title || "",
      visits: Number(row.visits || 0),
    })),
  };
}

function getSiteVisitCountsByDate(date = getTodayLocal()) {
  const visitDate = isIsoDate(date) ? date : getTodayLocal();
  const rows = prepare(`
    SELECT site_id, COUNT(*) AS visits
    FROM site_daily_visits
    WHERE visit_date = ?
    GROUP BY site_id
  `).all([visitDate]);
  return new Map(rows.map((row) => [Number(row.site_id), Number(row.visits || 0)]));
}

function normalizeDomain(host) {
  if (!host) return "localhost";
  return host.split(":")[0].toLowerCase().replace(/^www\./, "");
}

function isLocalDomain(domain) {
  return domain === "localhost" || domain === "127.0.0.1";
}

function findSiteRowByDomain(host) {
  const domain = normalizeDomain(host);

  let row = prepare(`
    SELECT s.*, d.domain AS request_domain
    FROM domains d
    JOIN sites s ON s.id = d.site_id
    WHERE d.domain = ?
    ORDER BY d.is_primary DESC, d.id ASC
    LIMIT 1
  `).get([domain]);

  if (!row) {
    const siteRow = prepare("SELECT * FROM sites WHERE domain = ?").get([domain]);
    if (siteRow) {
      row = { ...siteRow, request_domain: domain };
    }
  }

  if (!row && isLocalDomain(domain)) {
    row = prepare(`
      SELECT s.*, d.domain AS request_domain
      FROM domains d
      JOIN sites s ON s.id = d.site_id
      WHERE d.domain = 'localhost'
      ORDER BY d.is_primary DESC, d.id ASC
      LIMIT 1
    `).get();
    if (!row) {
      const siteRow = prepare("SELECT * FROM sites WHERE domain = ?").get(["localhost"]);
      if (siteRow) {
        row = { ...siteRow, request_domain: "localhost" };
      }
    }
  }

  return row || null;
}

function isSiteRowActive(row) {
  return Boolean(row && Number(row.active) === 1);
}

function getSiteByDomain(host) {
  const row = findSiteRowByDomain(host);
  if (!isSiteRowActive(row)) return null;
  return parseSite(row);
}

function getInactiveSiteByDomain(host) {
  const row = findSiteRowByDomain(host);
  if (!row || isSiteRowActive(row)) return null;
  return parseSite(row);
}

function syncAllDomainsActive(siteId, active) {
  prepare("UPDATE domains SET active = ? WHERE site_id = ?").run([active ? 1 : 0, siteId]);
}

function buildOriginHostname(parentDomain) {
  const parent = normalizeDomain(parentDomain);
  return parent ? `origin.${parent}` : "";
}

function syncPrimaryOriginFromMainParent() {
  const main = prepare("SELECT domain FROM parent_domains WHERE is_main = 1 LIMIT 1").get();
  if (main?.domain) {
    setSetting("primary_origin_domain", buildOriginHostname(main.domain));
    return buildOriginHostname(main.domain);
  }
  return "";
}

function getMainParentDomain() {
  return parseParentDomain(prepare("SELECT * FROM parent_domains WHERE is_main = 1 LIMIT 1").get());
}

function setMainParentDomain(id) {
  const row = prepare("SELECT * FROM parent_domains WHERE id = ?").get([id]);
  if (!row) throw new Error("Không tìm thấy domain cha");
  prepare("UPDATE parent_domains SET is_main = 0").run();
  prepare("UPDATE parent_domains SET is_main = 1 WHERE id = ?").run([id]);
  const origin = syncPrimaryOriginFromMainParent();
  const updated = getParentDomainById(id);
  return { ...updated, primary_origin_domain: origin };
}

function getPrimaryOriginDomain() {
  const fromMain = prepare("SELECT domain FROM parent_domains WHERE is_main = 1 AND active = 1 LIMIT 1").get();
  if (fromMain?.domain) return buildOriginHostname(fromMain.domain);
  const fromSetting =
    getSetting("primary_origin_domain") || process.env.PRIMARY_ORIGIN_DOMAIN || "";
  return normalizeDomain(fromSetting);
}

function setPrimaryOriginDomain(domain) {
  const normalized = normalizeDomain(domain);
  if (!normalized || normalized === "localhost" || normalized === "127.0.0.1") {
    throw new Error("Domain origin chính không hợp lệ");
  }
  setSetting("primary_origin_domain", normalized);
  return normalized;
}

function resolveSharedCnameTarget() {
  return getPrimaryOriginDomain();
}

function resolveParentCnameTarget(row) {
  return resolveSharedCnameTarget();
}

function parseParentDomain(row, { includeSecrets = false } = {}) {
  if (!row) return null;
  const parsed = {
    ...row,
    active: Boolean(row.active),
    cf_proxied: Boolean(row.cf_proxied),
    is_main: Boolean(row.is_main),
    has_token: Boolean(row.cf_api_token),
    origin_hostname: buildOriginHostname(row.domain),
    cname_target: resolveSharedCnameTarget(),
  };
  if (!includeSecrets) delete parsed.cf_api_token;
  return parsed;
}

function getAllParentDomains() {
  return prepare("SELECT * FROM parent_domains ORDER BY is_main DESC, domain ASC")
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
  const parentDomain = normalizeDomain(row.domain);
  return {
    id: row.id,
    domain: parentDomain,
    parentDomain,
    token: row.cf_api_token,
    zoneId: row.cf_zone_id,
    ip: row.server_ip,
    proxied: Boolean(row.cf_proxied),
    cnameTarget: resolveSharedCnameTarget(),
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
    parentDomain: null,
    token: global.api_token,
    zoneId: global.zone_id,
    ip: global.public_ip,
    proxied: global.proxied,
    cnameTarget: getPrimaryOriginDomain() || global.cname_target || null,
  };
}

function createParentDomain({
  domain,
  name = "",
  cf_api_token = "",
  cf_zone_id = "",
  server_ip = "",
  cname_target = "",
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
      domain, name, cf_api_token, cf_zone_id, server_ip, cname_target, cf_proxied, active, note
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run([
    normalized,
    name || normalized,
    cf_api_token,
    cf_zone_id,
    server_ip,
    resolveSharedCnameTarget(),
    cf_proxied ? 1 : 0,
    active ? 1 : 0,
    note || "",
  ]);
  const row = prepare("SELECT id FROM parent_domains WHERE domain = ?").get([normalized]);
  const mainCount = prepare("SELECT COUNT(*) AS c FROM parent_domains WHERE is_main = 1").get().c;
  if (Number(mainCount) === 0 && row?.id) {
    prepare("UPDATE parent_domains SET is_main = 1 WHERE id = ?").run([row.id]);
    syncPrimaryOriginFromMainParent();
  }
  return getParentDomainById(row?.id);
}

function updateParentDomain(
  id,
  {
    domain,
    name,
    cf_api_token,
    cf_zone_id,
    server_ip,
    cname_target,
    cf_proxied,
    note,
    active,
  } = {},
) {
  const existing = getParentDomainById(id, { includeSecrets: true });
  if (!existing) throw new Error("Không tìm thấy domain cha");

  const normalized = domain !== undefined ? normalizeDomain(domain) : existing.domain;
  if (!normalized || normalized === "localhost" || normalized === "127.0.0.1") {
    throw new Error("Domain cha không hợp lệ");
  }

  const nextToken =
    cf_api_token !== undefined && String(cf_api_token).trim()
      ? String(cf_api_token).trim()
      : existing.cf_api_token;
  const nextZoneId =
    cf_zone_id !== undefined ? String(cf_zone_id).trim() : existing.cf_zone_id;
  const nextServerIp =
    server_ip !== undefined ? String(server_ip).trim() : existing.server_ip;
  const nextCnameTarget = resolveSharedCnameTarget();
  const nextName = name !== undefined ? String(name).trim() : existing.name;
  const nextNote = note !== undefined ? String(note).trim() : existing.note;
  const nextProxied = cf_proxied !== undefined ? Boolean(cf_proxied) : existing.cf_proxied;
  const nextActive = active !== undefined ? Boolean(active) : existing.active;

  if (!nextToken) throw new Error("Cần Cloudflare API Token");
  if (!nextZoneId) throw new Error("Cần Zone ID");
  if (!nextServerIp) throw new Error("Cần IP server");

  if (normalized !== existing.domain) {
    const dup = prepare("SELECT id FROM parent_domains WHERE domain = ? AND id != ?").get([
      normalized,
      id,
    ]);
    if (dup) throw new Error("Domain cha đã tồn tại");

    const { buildChildDomain } = require("./parent-domains");
    const children = prepare("SELECT * FROM subdomains WHERE parent_id = ?").all([id]);
    for (const child of children) {
      const newChildDomain =
        child.subdomain === "@"
          ? normalized
          : buildChildDomain(normalized, child.subdomain);
      const conflict = prepare("SELECT id FROM subdomains WHERE domain = ? AND id != ?").get([
        newChildDomain,
        child.id,
      ]);
      if (conflict) {
        throw new Error(`Không thể đổi domain cha: ${newChildDomain} đã tồn tại`);
      }
      if (child.site_id) {
        prepare("UPDATE sites SET domain = ? WHERE id = ?").run([newChildDomain, child.site_id]);
        prepare("UPDATE domains SET domain = ? WHERE site_id = ? AND is_primary = 1").run([
          newChildDomain,
          child.site_id,
        ]);
      }
      prepare("UPDATE subdomains SET domain = ? WHERE id = ?").run([newChildDomain, child.id]);
    }
  }

  prepare(`
    UPDATE parent_domains
    SET domain = ?, name = ?, cf_api_token = ?, cf_zone_id = ?, server_ip = ?,
        cname_target = ?, cf_proxied = ?, active = ?, note = ?
    WHERE id = ?
  `).run([
    normalized,
    nextName || normalized,
    nextToken,
    nextZoneId,
    nextServerIp,
    nextCnameTarget,
    nextProxied ? 1 : 0,
    nextActive ? 1 : 0,
    nextNote || "",
    id,
  ]);

  if (existing.is_main) {
    syncPrimaryOriginFromMainParent();
  }

  return getParentDomainById(id);
}

function deleteParentDomain(id) {
  const existing = prepare("SELECT is_main FROM parent_domains WHERE id = ?").get([id]);
  if (existing?.is_main) {
    throw new Error("Không thể xóa domain chính. Đặt domain khác làm chính trước.");
  }
  const childCount = prepare("SELECT COUNT(*) AS c FROM subdomains WHERE parent_id = ?").get([id]).c;
  if (Number(childCount) > 0) {
    throw new Error("Không thể xóa domain cha đang có subdomain");
  }
  prepare("DELETE FROM parent_domains WHERE id = ?").run([id]);
  if (existing?.is_main) {
    const next = prepare("SELECT id FROM parent_domains ORDER BY id ASC LIMIT 1").get();
    if (next?.id) {
      prepare("UPDATE parent_domains SET is_main = 1 WHERE id = ?").run([next.id]);
    }
    syncPrimaryOriginFromMainParent();
  }
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
  assertDomainAvailable(sub.domain, siteId);
  prepare("UPDATE subdomains SET site_id = NULL WHERE site_id = ? AND id != ?").run([
    siteId,
    subdomainId,
  ]);
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

function assertDomainAvailable(domain, excludeSiteId = null) {
  const normalized = normalizeDomain(domain);
  if (!normalized) throw new Error("Domain không hợp lệ");

  const siteRow = prepare("SELECT id FROM sites WHERE domain = ?").get([normalized]);
  if (siteRow && Number(siteRow.id) !== Number(excludeSiteId)) {
    throw new Error(`Domain "${normalized}" đã được dùng cho trang khác`);
  }

  const subRow = prepare("SELECT site_id FROM subdomains WHERE domain = ?").get([normalized]);
  if (subRow?.site_id && Number(subRow.site_id) !== Number(excludeSiteId)) {
    throw new Error(`Domain "${normalized}" đã được gán cho trang khác`);
  }

  const domainRow = prepare("SELECT site_id FROM domains WHERE domain = ?").get([normalized]);
  if (domainRow && Number(domainRow.site_id) !== Number(excludeSiteId)) {
    throw new Error(`Domain "${normalized}" đã được dùng cho trang khác`);
  }
}

function syncPrimaryDomain(siteId, domain, active = 1, parentId = null) {
  const normalized = normalizeDomain(domain);
  assertDomainAvailable(normalized, siteId);

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

  prepare(
    "INSERT INTO domains (domain, site_id, is_primary, active, parent_id) VALUES (?, ?, 1, ?, ?)",
  ).run([normalized, siteId, active ? 1 : 0, resolvedParentId]);
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

function deleteSite(id) {
  const domains = getDomainsForSite(id);
  unlinkSubdomainsForSite(id);
  prepare("DELETE FROM site_daily_visits WHERE site_id = ?").run([id]);
  prepare("DELETE FROM site_buy_clicks WHERE site_id = ?").run([id]);
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
  assertDomainAvailable(s.domain);
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
  syncAllDomainsActive(site.id, site.active);
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
  assertDomainAvailable(s.domain, id);
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
  syncAllDomainsActive(site.id, site.active);
  return site;
}

function buildPreviewSite(data) {
  const s = serializeSite(data);
  return {
    domain: s.domain,
    name: s.name,
    page_title: s.page_title || s.product_title || "Xem trước landing page",
    shop_logo_main: s.shop_logo_main,
    shop_logo_accent: s.shop_logo_accent,
    shop_badge: s.shop_badge,
    tag_new: s.tag_new,
    tag_hot: s.tag_hot,
    product_title: s.product_title || "Tên sản phẩm",
    seller_avatar: s.seller_avatar,
    seller_name: s.seller_name,
    seller_meta: s.seller_meta,
    seller_verified: s.seller_verified,
    stat_chip_1: s.stat_chip_1,
    stat_chip_2: s.stat_chip_2,
    detail_title: s.detail_title,
    detail_content: s.detail_content,
    messenger_url: s.messenger_url || "#",
    product_images: JSON.parse(s.product_images),
    detail_images: JSON.parse(s.detail_images),
    other_products: JSON.parse(s.other_products),
    brand_color: s.brand_color,
    accent_color: s.accent_color,
    active: Boolean(s.active),
    site_id: Number(data.id) || 0,
  };
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
    name: "LANDING PAGE Demo",
    page_title: "LANDING PAGE - Quần ống rộng APQ41 New 2026",
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
  ).run([key, String(value ?? "")]);
  persist();
}

function getDefaultServerIp() {
  const row = prepare(
    "SELECT server_ip FROM parent_domains WHERE server_ip != '' ORDER BY id DESC LIMIT 1",
  ).get();
  return row?.server_ip ? String(row.server_ip).trim() : "";
}

function getCloudflareSettings() {
  const { getPublicIpSync } = require("./server-ip");
  return {
    api_token: getSetting("cf_api_token") || process.env.CLOUDFLARE_API_TOKEN || "",
    zone_id: getSetting("cf_zone_id") || process.env.CLOUDFLARE_ZONE_ID || "",
    public_ip: getPublicIpSync(),
    cname_target: getSetting("cf_cname_target") || process.env.CLOUDFLARE_CNAME_TARGET || "",
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

module.exports = {
  initDb,
  seedIfEmpty,
  seedAdmin,
  verifyAdmin,
  normalizeDomain,
  isLocalDomain,
  getSiteByDomain,
  getInactiveSiteByDomain,
  getAllSites,
  getSiteById,
  getVisitAnalytics,
  getSiteVisitCountsByDate,
  getAllParentDomains,
  getParentDomainById,
  buildOriginHostname,
  getMainParentDomain,
  setMainParentDomain,
  syncPrimaryOriginFromMainParent,
  getPrimaryOriginDomain,
  setPrimaryOriginDomain,
  resolveSharedCnameTarget,
  resolveParentCnameTarget,
  getParentDomainCredentials,
  findParentForDomain,
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
  getDomainsForSite,
  shouldRemoveDnsForDomain,
  buildPreviewSite,
  createSite,
  updateSite,
  deleteSite,
  recordVisit,
  recordBuyClick,
  storeRefreshToken,
  getRefreshTokenRow,
  deleteRefreshToken,
  getSetting,
  setSetting,
  getDefaultServerIp,
  getCloudflareSettings,
};
