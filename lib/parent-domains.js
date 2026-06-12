function normalizeDomain(host) {
  if (!host) return "localhost";
  return host.split(":")[0].toLowerCase().replace(/^www\./, "");
}

function buildChildDomain(parentDomain, subdomain) {
  const parent = normalizeDomain(parentDomain);
  const sub = String(subdomain || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "");

  if (!sub) throw new Error("Nhập subdomain hoặc domain con");
  if (sub === parent) return parent;

  const full = sub.includes(".") ? normalizeDomain(sub) : `${sub}.${parent}`;
  if (full !== parent && !full.endsWith(`.${parent}`)) {
    throw new Error(`Domain con phải thuộc ${parent}`);
  }
  return full;
}

function domainBelongsToParent(domain, parentDomain) {
  const child = normalizeDomain(domain);
  const parent = normalizeDomain(parentDomain);
  return child === parent || child.endsWith(`.${parent}`);
}

module.exports = {
  buildChildDomain,
  domainBelongsToParent,
};
