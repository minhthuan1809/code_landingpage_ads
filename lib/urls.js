const { getPublicIpSync } = require("./server-ip");

const ADMIN_PORT = Number(process.env.ADMIN_PORT) || 4433;
const LANDING_PORT = Number(process.env.LANDING_PORT) || 4444;

function buildBaseUrl(port, publicIp, envUrl) {
  const serverUrl = String(envUrl || "").replace(/\/$/, "");
  if (serverUrl) return serverUrl;
  if (publicIp) return `http://${publicIp}:${port}`;
  return `http://127.0.0.1:${port}`;
}

function getServerConfig() {
  const publicIp = getPublicIpSync();
  const landingUrl = buildBaseUrl(
    LANDING_PORT,
    publicIp,
    process.env.LANDING_URL || process.env.SERVER_URL || process.env.PUBLIC_URL,
  );
  const adminUrl = buildBaseUrl(
    ADMIN_PORT,
    publicIp,
    process.env.ADMIN_URL,
  );

  return {
    adminPort: ADMIN_PORT,
    landingPort: LANDING_PORT,
    port: LANDING_PORT,
    publicIp,
    baseUrl: landingUrl,
    landingBaseUrl: landingUrl,
    adminBaseUrl: adminUrl,
    previewHost: landingUrl.replace(/^https?:\/\//, "").split("/")[0],
  };
}

function isLocalAccessHost(host) {
  const domain = (host || "").split(":")[0].toLowerCase();
  if (domain === "localhost" || domain === "127.0.0.1" || domain === "[::1]") {
    return true;
  }

  const publicIp = getPublicIpSync();
  if (publicIp && domain === publicIp.toLowerCase()) {
    return true;
  }

  try {
    const { getDefaultServerIp } = require("./db");
    const serverIp = getDefaultServerIp();
    if (serverIp && domain === serverIp.toLowerCase()) {
      return true;
    }
  } catch {
    // ignore
  }

  return false;
}

function buildPreviewUrl(domain, config = getServerConfig()) {
  const d = (domain || "localhost").toLowerCase();
  const base = config.landingBaseUrl.replace(/\/$/, "");
  if (d === "localhost" || d === "127.0.0.1") return `${base}/`;
  return `${base}/?preview=${encodeURIComponent(d)}`;
}

function buildProductionUrl(domain) {
  const d = (domain || "").toLowerCase();
  if (!d || d === "localhost" || d === "127.0.0.1") return "";
  return `https://${d}`;
}

function buildServerCheckUrl(config = getServerConfig()) {
  return config.landingBaseUrl.replace(/\/$/, "");
}

function buildCheckUrl(_domain, config = getServerConfig()) {
  return buildServerCheckUrl(config);
}

function buildSiteUrls(domain, config = getServerConfig()) {
  return {
    domain,
    preview_url: buildPreviewUrl(domain, config),
    production_url: buildProductionUrl(domain),
    check_url: buildPreviewUrl(domain, config),
    server_check_url: buildServerCheckUrl(config),
  };
}

function exportSites(sites, config = getServerConfig()) {
  return sites.map((site) => ({
    id: site.id,
    domain: site.domain,
    name: site.name,
    active: site.active,
    visit_count: site.visit_count,
    preview_url: buildPreviewUrl(site.domain, config),
    production_url: buildProductionUrl(site.domain),
    check_url: buildPreviewUrl(site.domain, config),
    server_check_url: buildServerCheckUrl(config),
  }));
}

module.exports = {
  getServerConfig,
  isLocalAccessHost,
  buildPreviewUrl,
  buildProductionUrl,
  buildServerCheckUrl,
  buildCheckUrl,
  buildSiteUrls,
  exportSites,
};
