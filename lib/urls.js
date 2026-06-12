function getServerConfig() {
  const port = Number(process.env.PORT) || 4433;
  return {
    port,
    publicIp: process.env.PUBLIC_IP || process.env.SERVER_IP || "",
    previewHost: `127.0.0.1:${port}`,
  };
}

function isLocalAccessHost(host) {
  const domain = (host || "").split(":")[0].toLowerCase();
  return domain === "localhost" || domain === "127.0.0.1" || domain === "[::1]";
}

function buildPreviewUrl(domain, config = getServerConfig()) {
  const d = (domain || "localhost").toLowerCase();
  const base = `http://127.0.0.1:${config.port}`;
  if (d === "localhost" || d === "127.0.0.1") return `${base}/`;
  return `${base}/?preview=${encodeURIComponent(d)}`;
}

function buildProductionUrl(domain) {
  const d = (domain || "").toLowerCase();
  if (!d || d === "localhost" || d === "127.0.0.1") return "";
  return `https://${d}`;
}

function buildSiteUrls(domain, config = getServerConfig()) {
  return {
    domain,
    preview_url: buildPreviewUrl(domain, config),
    production_url: buildProductionUrl(domain),
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
  }));
}

module.exports = {
  getServerConfig,
  isLocalAccessHost,
  buildPreviewUrl,
  buildProductionUrl,
  buildSiteUrls,
  exportSites,
};
