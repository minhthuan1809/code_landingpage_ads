const { createDnsARecord, createDnsCnameRecord, deleteDnsRecords } = require("./cloudflare");
const {
  normalizeDomain,
  resolveCfForDomain,
  findParentForDomain,
  getDomainsForSite,
  shouldRemoveDnsForDomain,
  resolveSharedCnameTarget,
} = require("./db");

function isApexDomain(domain, parentDomain) {
  if (!parentDomain) return true;
  return normalizeDomain(domain) === normalizeDomain(parentDomain);
}

async function ensureOriginARecord(originHost) {
  const normalized = normalizeDomain(originHost);
  if (!normalized) return null;

  const originCf = findParentForDomain(normalized);
  if (!originCf?.token || !originCf?.zoneId || !originCf?.ip) {
    throw new Error(
      `Chưa cấu hình domain cha Cloudflare cho origin ${normalized}. Thêm domain cha chứa hostname này.`,
    );
  }

  const record = await createDnsARecord({
    token: originCf.token,
    zoneId: originCf.zoneId,
    domain: normalized,
    ip: originCf.ip,
    proxied: originCf.proxied,
  });
  return { record, recordType: "A", role: "origin", domain: normalized };
}

async function provisionDomainDns(domain) {
  const cf = resolveCfForDomain(domain);
  if (!cf) {
    throw new Error("Chưa cấu hình token Cloudflare cho domain này");
  }

  const normalized = normalizeDomain(domain);
  const parentDomain = cf.parentDomain || cf.domain;
  const apex = isApexDomain(normalized, parentDomain);
  const cnameTarget = resolveSharedCnameTarget();
  const source = cf.id ? "parent" : "global";

  if (!apex && !cnameTarget) {
    throw new Error("Chưa cấu hình domain origin chính (CNAME đích chung)");
  }

  if (cnameTarget && !apex) {
    await ensureOriginARecord(cnameTarget);
  }

  if (apex || !cnameTarget) {
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
    target: cnameTarget,
    proxied: cf.proxied,
  });

  return {
    record,
    recordType: "CNAME",
    cnameTarget,
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
