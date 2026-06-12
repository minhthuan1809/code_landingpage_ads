const { createDnsARecord, deleteDnsARecord } = require("./cloudflare");
const {
  resolveCfForDomain,
  getDomainsForSite,
  shouldRemoveDnsForDomain,
} = require("./db");

async function provisionDomainDns(domain) {
  const cf = resolveCfForDomain(domain);
  if (!cf) {
    throw new Error("Chưa cấu hình token Cloudflare cho domain này");
  }

  const record = await createDnsARecord({
    token: cf.token,
    zoneId: cf.zoneId,
    domain,
    ip: cf.ip,
    proxied: cf.proxied,
  });

  return { record, source: cf.id ? "parent" : "global" };
}

async function removeDomainDns(domain) {
  if (!shouldRemoveDnsForDomain(domain)) {
    return { domain, skipped: true, reason: "skip" };
  }

  const cf = resolveCfForDomain(domain);
  if (!cf) {
    return { domain, skipped: true, reason: "no_cf_config" };
  }

  const result = await deleteDnsARecord({
    token: cf.token,
    zoneId: cf.zoneId,
    domain,
  });

  return { domain, ...result };
}

async function removeDnsForSite(siteId) {
  const domains = getDomainsForSite(siteId);
  const results = [];

  for (const domain of domains) {
    try {
      results.push(await removeDomainDns(domain));
    } catch (err) {
      results.push({ domain, error: err.message });
    }
  }

  return results;
}

module.exports = { provisionDomainDns, removeDomainDns, removeDnsForSite };
