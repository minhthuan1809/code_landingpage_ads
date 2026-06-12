const { getPublicIpSync } = require("./server-ip");

function getServerConfig() {
  const port = Number(process.env.PORT) || 4433;
  const publicIp = getPublicIpSync();
  const serverUrl = String(process.env.SERVER_URL || process.env.PUBLIC_URL || "").replace(/\/$/, "");

  let baseUrl = serverUrl;
  if (!baseUrl && publicIp) baseUrl = `http://${publicIp}:${port}`;
  if (!baseUrl) baseUrl = `http://127.0.0.1:${port}`;

  return {
    port,
    publicIp,
    baseUrl,
    previewHost: baseUrl.replace(/^https?:\/\//, "").split("/")[0],
  };
}

function isLocalAccessHost(host) {
  const domain = (host || "").split(":")[0].toLowerCase();
  return domain === "localhost" || domain === "127.0.0.1" || domain === "[::1]";
}

function buildPreviewUrl(domain, config = getServerConfig()) {
  const d = (domain || "localhost").toLowerCase();
  const base = config.baseUrl.replace(/\/$/, "");
  if (d === "localhost" || d === "127.0.0.1") return `${base}/`;
  return `${base}/?preview=${encodeURIComponent(d)}`;
}

function buildProductionUrl(domain) {
  const d = (domain || "").toLowerCase();
  if (!d || d === "localhost" || d === "127.0.0.1") return "";
  return `https://${d}`;
}

function buildServerCheckUrl(config = getServerConfig()) {
  return config.baseUrl.replace(/\/$/, "");
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
