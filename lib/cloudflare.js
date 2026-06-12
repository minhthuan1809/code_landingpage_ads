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
  const q = new URLSearchParams({ name, per_page: "5" });
  return cfRequest(token, `/zones/${zoneId}/dns_records?${q}`);
}

async function createDnsARecord({ token, zoneId, domain, ip, proxied = true }) {
  const existing = await listDnsRecords(token, zoneId, domain);
  const match = existing.find(
    (r) => r.type === "A" && r.name.toLowerCase() === domain.toLowerCase(),
  );
  if (match) {
    return cfRequest(token, `/zones/${zoneId}/dns_records/${match.id}`, {
      method: "PATCH",
      body: JSON.stringify({ type: "A", name: domain, content: ip, proxied, ttl: 1 }),
    });
  }
  return cfRequest(token, `/zones/${zoneId}/dns_records`, {
    method: "POST",
    body: JSON.stringify({ type: "A", name: domain, content: ip, proxied, ttl: 1 }),
  });
}

function dnsNamesMatch(recordName, domain) {
  const a = String(recordName || "")
    .toLowerCase()
    .replace(/\.$/, "");
  const b = String(domain || "")
    .toLowerCase()
    .replace(/\.$/, "");
  return a === b;
}

async function deleteDnsARecord({ token, zoneId, domain }) {
  const existing = await listDnsRecords(token, zoneId, domain);
  const matches = existing.filter(
    (r) => r.type === "A" && dnsNamesMatch(r.name, domain),
  );
  if (!matches.length) return { deleted: false, count: 0 };

  for (const record of matches) {
    await cfRequest(token, `/zones/${zoneId}/dns_records/${record.id}`, {
      method: "DELETE",
    });
  }

  return { deleted: true, count: matches.length };
}

async function verifyToken(token) {
  return cfRequest(token, "/user/tokens/verify");
}

module.exports = {
  createDnsARecord,
  deleteDnsARecord,
  verifyToken,
};
