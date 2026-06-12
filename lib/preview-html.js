function previewAssetBase(req) {
  const proto = String(req.get("x-forwarded-proto") || req.protocol || "http")
    .split(",")[0]
    .trim();
  const host = req.get("host") || "localhost";
  return `${proto}://${host}/`;
}

function absolutizePreviewAssetPaths(html, baseUrl) {
  const root = String(baseUrl || "/").replace(/\/$/, "");
  return html.replace(/\b(href|src)=(["'])\/(?!\/)/g, `$1=$2${root}/`);
}

function preparePreviewHtml(html, req) {
  const base = previewAssetBase(req);
  let prepared = absolutizePreviewAssetPaths(html, base);
  if (!/<base\s/i.test(prepared)) {
    prepared = prepared.replace(/<head([^>]*)>/i, `<head$1><base href="${base}">`);
  }
  return prepared;
}

module.exports = {
  previewAssetBase,
  absolutizePreviewAssetPaths,
  preparePreviewHtml,
};
