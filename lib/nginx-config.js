const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { getAllParentDomains, getPrimaryOriginDomain, normalizeDomain } = require("./db");
const { LANDING_PORT } = require("./urls");

const DEPLOY_PATH = path.join(__dirname, "..", "deploy", "nginx-landing.conf");

function buildServerNameList() {
  const names = new Set();
  const origin = getPrimaryOriginDomain();
  if (origin) names.add(origin);

  for (const parent of getAllParentDomains()) {
    if (!parent.active) continue;
    const domain = normalizeDomain(parent.domain);
    if (!domain) continue;
    names.add(domain);
    names.add(`.${domain}`);
  }

  if (!names.size) {
    names.add("_");
  }

  return [...names].sort();
}

function getSslPaths() {
  return {
    cert: process.env.NGINX_SSL_CERT || "/etc/ssl/cloudflare/origin.pem",
    key: process.env.NGINX_SSL_KEY || "/etc/ssl/cloudflare/origin.key",
    options: process.env.NGINX_SSL_OPTIONS || "/etc/letsencrypt/options-ssl-nginx.conf",
    dhparam: process.env.NGINX_SSL_DHPARAM || "/etc/letsencrypt/ssl-dhparams.pem",
  };
}

function getNginxTargetPath() {
  const fromEnv = String(process.env.NGINX_CONFIG_PATH || "").trim();
  if (fromEnv) return fromEnv;
  if (process.platform === "linux") {
    return "/etc/nginx/sites-available/landing-cms.conf";
  }
  return "";
}

function shouldAutoReloadNginx() {
  if (process.env.NGINX_AUTO_RELOAD === "0") return false;
  if (process.env.NGINX_AUTO_RELOAD === "1") return true;
  return process.platform === "linux";
}

function buildProxyLocation(landingPort) {
  return `    location / {
        proxy_pass http://127.0.0.1:${landingPort};

        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }`;
}

function generateNginxLandingConfig(options = {}) {
  const landingPort = options.landingPort || Number(process.env.LANDING_PORT) || LANDING_PORT || 4444;
  const serverNameLine = buildServerNameList().join(" ");
  const generatedAt = new Date().toISOString();
  const ssl = getSslPaths();
  const proxyBlock = buildProxyLocation(landingPort);

  return `# Tự động sinh bởi Landing Page CMS — ${generatedAt}
# Domain cha thay đổi → file cập nhật + tự reload nginx (Linux).

server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name ${serverNameLine};
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;
    server_name ${serverNameLine};

    ssl_certificate ${ssl.cert};
    ssl_certificate_key ${ssl.key};
    include ${ssl.options};
    ssl_dhparam ${ssl.dhparam};

${proxyBlock}
}
`;
}

function writeNginxConfig(content) {
  const deployDir = path.dirname(DEPLOY_PATH);
  if (!fs.existsSync(deployDir)) {
    fs.mkdirSync(deployDir, { recursive: true });
  }
  fs.writeFileSync(DEPLOY_PATH, content, "utf8");

  const target = getNginxTargetPath();
  let targetWritten = false;
  let targetError = "";

  if (target) {
    try {
      const targetDir = path.dirname(target);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      fs.writeFileSync(target, content, "utf8");
      targetWritten = true;
    } catch (err) {
      targetError = err.message;
      console.warn(`[nginx-config] không ghi được ${target}:`, err.message);
    }
  }

  return { deployPath: DEPLOY_PATH, targetPath: target || null, targetWritten, targetError };
}

function reloadNginx() {
  const testCmd = process.env.NGINX_TEST_CMD || "sudo nginx -t";
  const reloadCmd = process.env.NGINX_RELOAD_CMD || "sudo systemctl reload nginx";
  execSync(testCmd, { stdio: "pipe" });
  execSync(reloadCmd, { stdio: "pipe" });
  return { reloaded: true, testCmd, reloadCmd };
}

function reloadNginxIfEnabled() {
  if (!shouldAutoReloadNginx()) {
    return { reloaded: false, reason: "NGINX_AUTO_RELOAD tắt hoặc không phải Linux" };
  }
  return reloadNginx();
}

function syncNginxConfig(options = {}) {
  const content = generateNginxLandingConfig(options);
  const paths = writeNginxConfig(content);
  const serverNames = buildServerNameList();
  const ssl = getSslPaths();

  const wantsReload =
    options.reload === true || (options.reload !== false && shouldAutoReloadNginx());

  let reload = { reloaded: false, reason: "skipped" };
  if (wantsReload) {
    try {
      reload = reloadNginxIfEnabled();
      if (reload.reloaded) {
        console.log("[nginx-config] đã reload nginx");
      }
    } catch (err) {
      reload = { reloaded: false, error: err.message };
      console.warn("[nginx-config] reload thất bại:", err.message);
    }
  }

  return {
    ok: true,
    serverNames,
    primaryOrigin: getPrimaryOriginDomain(),
    landingPort: options.landingPort || Number(process.env.LANDING_PORT) || LANDING_PORT || 4444,
    autoReload: shouldAutoReloadNginx(),
    ssl,
    ...paths,
    reload,
    content,
  };
}

function syncNginxConfigSafe(options = {}) {
  try {
    return syncNginxConfig(options);
  } catch (err) {
    console.warn("[nginx-config] sync failed:", err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = {
  buildServerNameList,
  generateNginxLandingConfig,
  shouldAutoReloadNginx,
  reloadNginx,
  syncNginxConfig,
  syncNginxConfigSafe,
  DEPLOY_PATH,
};
