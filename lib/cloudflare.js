function dnsNamesMatch(recordName, domain) {
  const a = String(recordName || "")
    .toLowerCase()
    .replace(/\.$/, "");
  const b = String(domain || "")
    .toLowerCase()
    .replace(/\.$/, "");
  return a === b;
}

function normalizeCnameTarget(target) {
  return String(target || "")
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");
}

async function cfRequest(token, path, options = {}) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    const msg =
      data.errors?.map((e) => e.message).join("; ") ||
      data.message ||
      `Cloudflare HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data.result;
}

async function listDnsRecords(token, zoneId, name) {
  const q = new URLSearchParams({ name, per_page: "20" });
  return cfRequest(token, `/zones/${zoneId}/dns_records?${q}`);
}

async function upsertDnsRecord({ token, zoneId, type, domain, content, proxied = true }) {
  const existing = await listDnsRecords(token, zoneId, domain);
  const match = existing.find(
    (r) => r.type === type && dnsNamesMatch(r.name, domain),
  );
  const body = { type, name: domain, content, proxied, ttl: 1 };
  if (match) {
    return cfRequest(token, `/zones/${zoneId}/dns_records/${match.id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }
  return cfRequest(token, `/zones/${zoneId}/dns_records`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function createDnsARecord({ token, zoneId, domain, ip, proxied = true }) {
  return upsertDnsRecord({
    token,
    zoneId,
    type: "A",
    domain,
    content: ip,
    proxied,
  });
}

async function createDnsCnameRecord({ token, zoneId, domain, target, proxied = true }) {
  const normalizedTarget = normalizeCnameTarget(target);
  if (!normalizedTarget) {
    throw new Error("Thiếu hostname đích CNAME");
  }
  return upsertDnsRecord({
    token,
    zoneId,
    type: "CNAME",
    domain,
    content: normalizedTarget,
    proxied,
  });
}

async function deleteDnsRecords({ token, zoneId, domain, types = ["A", "CNAME"] }) {
  const existing = await listDnsRecords(token, zoneId, domain);
  const matches = existing.filter(
    (r) => types.includes(r.type) && dnsNamesMatch(r.name, domain),
  );
  if (!matches.length) return { deleted: false, count: 0, types: [] };

  for (const record of matches) {
    await cfRequest(token, `/zones/${zoneId}/dns_records/${record.id}`, {
      method: "DELETE",
    });
  }

  return {
    deleted: true,
    count: matches.length,
    types: matches.map((r) => r.type),
  };
}

async function deleteDnsARecord(params) {
  return deleteDnsRecords({ ...params, types: ["A"] });
}

async function verifyToken(token) {
  return cfRequest(token, "/user/tokens/verify");
}

module.exports = {
  createDnsARecord,
  createDnsCnameRecord,
  deleteDnsRecords,
  deleteDnsARecord,
  verifyToken,
  normalizeCnameTarget,
};
