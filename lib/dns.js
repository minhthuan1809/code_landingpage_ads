const { createDnsARecord, createDnsCnameRecord, deleteDnsRecords } = require("./cloudflare");
const {
  normalizeDomain,
  resolveCfForDomain,
  getDomainsForSite,
  shouldRemoveDnsForDomain,
} = require("./db");

function isApexDomain(domain, parentDomain) {
  if (!parentDomain) return true;
  return normalizeDomain(domain) === normalizeDomain(parentDomain);
}

async function ensureOriginARecord(cf) {
  if (!cf?.cnameTarget || !cf?.ip) return null;
  const originHost = normalizeDomain(cf.cnameTarget);
  if (!originHost || originHost === normalizeDomain(cf.parentDomain)) {
    return null;
  }
  const record = await createDnsARecord({
    token: cf.token,
    zoneId: cf.zoneId,
    domain: originHost,
    ip: cf.ip,
    proxied: cf.proxied,
  });
  return { record, recordType: "A", role: "origin" };
}

async function provisionDomainDns(domain) {
  const cf = resolveCfForDomain(domain);
  if (!cf) {
    throw new Error("Chưa cấu hình token Cloudflare cho domain này");
  }

  const normalized = normalizeDomain(domain);
  const parentDomain = cf.parentDomain || cf.domain;
  const apex = isApexDomain(normalized, parentDomain);
  const source = cf.id ? "parent" : "global";

  if (cf.cnameTarget && parentDomain) {
    await ensureOriginARecord(cf);
  }

  if (apex || !cf.cnameTarget) {
    const record = await createDnsARecord({
      token: cf.token,
      zoneId: cf.zoneId,
      domain: normalized,
      ip: cf.ip,
      proxied: cf.proxied,
    });
    return {
      record,
      recordType: "A",
      source,
      domain: normalized,
    };
  }

  const record = await createDnsCnameRecord({
    token: cf.token,
    zoneId: cf.zoneId,
    domain: normalized,
    target: cf.cnameTarget,
    proxied: cf.proxied,
  });

  return {
    record,
    recordType: "CNAME",
    cnameTarget: cf.cnameTarget,
    source,
    domain: normalized,
  };
}

async function removeDomainDns(domain) {
  if (!shouldRemoveDnsForDomain(domain)) {
    return { domain, skipped: true, reason: "skip" };
  }

  const cf = resolveCfForDomain(domain);
  if (!cf) {
    return { domain, skipped: true, reason: "no_cf_config" };
  }

  const result = await deleteDnsRecords({
    token: cf.token,
    zoneId: cf.zoneId,
    domain,
    types: ["A", "CNAME"],
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

module.exports = { provisionDomainDns, removeDomainDns, removeDnsForSite, ensureOriginARecord };
