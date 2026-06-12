const API = "/api/admin";

let quill;
let productImages = [];
let detailImages = [];
let otherProducts = [];
let editingId = null;
let serverConfig = { port: 4433 };
let siteListCache = [];
let subdomainListCache = [];
let authCheckVersion = 0;
let accessToken = sessionStorage.getItem("accessToken") || null;
let refreshPromise = null;
let previewTimer = null;
let previewRequestId = 0;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function setAccessToken(token) {
  accessToken = token || null;
  if (accessToken) sessionStorage.setItem("accessToken", accessToken);
  else sessionStorage.removeItem("accessToken");
}

function authHeaders(extra = {}) {
  const headers = { ...extra };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
}

async function refreshAccessToken() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const res = await fetch(`${API}/refresh`, {
      method: "POST",
      credentials: "same-origin",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Phiên đăng nhập hết hạn");
    setAccessToken(data.accessToken);
    return data;
  })().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

async function api(path, options = {}, allowRetry = true) {
  const isFormData = options.body instanceof FormData;
  const headers = authHeaders(options.headers || {});
  if (!isFormData && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`${API}${path}`, {
    ...options,
    headers,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));

  if (
    res.status === 401 &&
    allowRetry &&
    path !== "/login" &&
    path !== "/refresh" &&
    (data.code === "TOKEN_EXPIRED" || data.code === "NO_TOKEN" || data.code === "INVALID_TOKEN")
  ) {
    await refreshAccessToken();
    return api(path, options, false);
  }

  if (!res.ok) throw new Error(data.error || "Lỗi máy chủ");
  return data;
}

function toast(msg) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

const ADMIN_VIEWS = new Set(["list", "domains", "edit"]);
const DOMAIN_TABS = new Set(["children", "parents"]);
let applyingAdminUrl = false;

function getActiveDomainTab() {
  const active = document.querySelector("[data-domain-tab].active");
  return active?.dataset.domainTab || "children";
}

function getAdminUrlState() {
  const params = new URLSearchParams(location.search);
  return {
    view: params.get("view") || "list",
    tab: params.get("tab") || "children",
    siteId: params.get("id") || null,
  };
}

function buildAdminUrlState(view, tab) {
  const state = { view: view || "list", tab: tab || "children", siteId: null };
  if (state.view === "edit" && editingId) state.siteId = String(editingId);
  if (state.view === "domains") state.tab = tab || getActiveDomainTab();
  return state;
}

function syncAdminUrl(state, { replace = false } = {}) {
  const view = ADMIN_VIEWS.has(state.view) ? state.view : "list";
  const params = new URLSearchParams();
  params.set("view", view);
  if (view === "domains") {
    params.set("tab", DOMAIN_TABS.has(state.tab) ? state.tab : "children");
  }
  if (view === "edit" && state.siteId) params.set("id", String(state.siteId));
  const url = `${location.pathname}?${params.toString()}`;
  const historyState = {
    view,
    tab: view === "domains" ? params.get("tab") : "children",
    siteId: view === "edit" ? state.siteId || null : null,
  };
  if (replace) history.replaceState(historyState, "", url);
  else history.pushState(historyState, "", url);
}

function showView(name, { syncUrl = true, replace = false, tab } = {}) {
  const view = ADMIN_VIEWS.has(name) ? name : "list";
  $("#listView").classList.toggle("hidden", view !== "list");
  $("#domainsView").classList.toggle("hidden", view !== "domains");
  $("#editView").classList.toggle("hidden", view !== "edit");
  $("#app")?.classList.toggle("edit-mode", view === "edit");
  $$(".nav-btn[data-view]").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === view);
  });
  if (view === "edit") {
    bindPreviewListeners();
    schedulePreviewUpdate();
  }
  if (view === "domains") {
    switchDomainTab(tab || getActiveDomainTab(), { syncUrl: false });
    loadDomains();
  }
  if (typeof lucide !== "undefined") lucide.createIcons();
  if (syncUrl && !applyingAdminUrl) {
    syncAdminUrl(buildAdminUrlState(view, tab), { replace });
  }
}

function switchDomainTab(tab, { syncUrl = true } = {}) {
  const nextTab = DOMAIN_TABS.has(tab) ? tab : "children";
  $$("[data-domain-tab]").forEach((b) => {
    b.classList.toggle("active", b.dataset.domainTab === nextTab);
  });
  $("#domainChildrenPanel").classList.toggle("hidden", nextTab !== "children");
  $("#domainParentsPanel").classList.toggle("hidden", nextTab !== "parents");
  if (syncUrl && !applyingAdminUrl && !$("#domainsView")?.classList.contains("hidden")) {
    syncAdminUrl({ view: "domains", tab: nextTab });
  }
}

async function openEditView(siteId = null) {
  if (siteId) {
    const site = await api(`/sites/${siteId}`);
    await fillForm(site);
  } else {
    await fillForm(null);
  }
  showView("edit");
}

async function applyAdminUrlState(state, { replace = false } = {}) {
  applyingAdminUrl = true;
  try {
    const view = ADMIN_VIEWS.has(state.view) ? state.view : "list";
    const tab = DOMAIN_TABS.has(state.tab) ? state.tab : "children";

    if (view === "edit") {
      if (state.siteId) {
        try {
          await openEditView(state.siteId);
        } catch {
          toast("Không tìm thấy trang");
          showView("list", { syncUrl: false });
          syncAdminUrl({ view: "list" }, { replace: true });
          return;
        }
      } else {
        await openEditView(null);
      }
      syncAdminUrl(buildAdminUrlState("edit"), { replace });
      return;
    }

    showView(view, { syncUrl: false, tab });
    syncAdminUrl({ view, tab: view === "domains" ? tab : "children" }, { replace });
  } finally {
    applyingAdminUrl = false;
  }
}

function initEditor() {
  if (quill) return;
  quill = new Quill("#detailEditor", {
    theme: "snow",
    modules: {
      toolbar: [
        ["bold", "italic", "underline"],
        [{ list: "ordered" }, { list: "bullet" }],
        [{ header: [2, 3, false] }],
        ["clean"],
      ],
    },
  });
  quill.on("text-change", schedulePreviewUpdate);
}

function renderProductImages() {
  $("#productImages").innerHTML = productImages
    .map(
      (url, i) =>
        `<div class="img-item"><img src="${url}" alt=""><button type="button" data-rm-img="${i}">×</button></div>`,
    )
    .join("");
  schedulePreviewUpdate();
}

function renderDetailImages() {
  $("#detailImages").innerHTML = detailImages
    .map(
      (url, i) =>
        `<div class="img-item"><img src="${url}" alt=""><button type="button" data-rm-detail-img="${i}">×</button></div>`,
    )
    .join("");
  schedulePreviewUpdate();
}

function buildOtherSiteOptions(selectedSiteId = "", excludeSiteId = null) {
  const sites = siteListCache.filter((s) => String(s.id) !== String(excludeSiteId));
  return [
    '<option value="">— Nhập thủ công / URL riêng —</option>',
    ...sites.map((s) => {
      const label = `${s.domain} — ${s.product_title || s.name || "Trang"}`;
      const link = s.check_url || s.production_url || s.preview_url || "";
      const thumb = (s.product_images && s.product_images[0]) || "";
      return `<option value="${s.id}" data-url="${esc(link)}" data-name="${esc(s.product_title || s.name || "")}" data-img="${esc(thumb)}" data-tag="${esc(s.tag_hot || "")}"${String(s.id) === String(selectedSiteId) ? " selected" : ""}>${esc(label)}</option>`;
    }),
  ].join("");
}

function renderOtherProducts() {
  $("#otherProducts").innerHTML = otherProducts
    .map(
      (p, i) => `
    <div class="other-row" data-i="${i}">
      <img src="${p.img || ""}" alt="" onerror="this.style.background='#333'">
      <div class="other-row-fields">
        <select class="other-site-pick" data-field="site_id" title="Chọn landing page khác">
          ${buildOtherSiteOptions(p.site_id || "", editingId)}
        </select>
        <div class="other-row-inline">
          <input type="text" placeholder="Tên sản phẩm" value="${esc(p.name)}" data-field="name">
          <input type="text" placeholder="Tag" value="${esc(p.tag)}" data-field="tag">
        </div>
        <input type="url" placeholder="Link (URL landing page hoặc messenger)" value="${esc(p.url || "")}" data-field="url">
      </div>
      <button type="button" class="btn btn-danger btn-sm" data-rm-other="${i}">×</button>
    </div>`,
    )
    .join("");
  schedulePreviewUpdate();
}

function formatVisits(n) {
  return Number(n || 0).toLocaleString("vi-VN");
}

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function getClientBaseUrl() {
  const port = serverConfig.port || 4433;
  const base = serverConfig.baseUrl || `http://127.0.0.1:${port}`;
  return base.replace(/\/?$/, "/");
}

function injectPreviewBase(html) {
  const base = getClientBaseUrl();
  if (/<base\s/i.test(html)) return html;
  return html.replace(/<head([^>]*)>/i, `<head$1><base href="${base}">`);
}

async function fetchPreviewHtml(payload) {
  const res = await fetch(`${API}/preview`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    credentials: "same-origin",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Không tạo được bản xem trước");
  }
  return res.text();
}

function schedulePreviewUpdate() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    void updateLandingPreview();
  }, 280);
}

async function updateLandingPreview() {
  const iframe = $("#landingPreview");
  if (!iframe || $("#editView")?.classList.contains("hidden")) return;

  const requestId = ++previewRequestId;
  try {
    const payload = getFormData();
    if (editingId) payload.id = editingId;
    const html = injectPreviewBase(await fetchPreviewHtml(payload));
    if (requestId !== previewRequestId) return;
    iframe.srcdoc = html;
  } catch (err) {
    if (requestId !== previewRequestId) return;
    iframe.srcdoc = `<!doctype html><html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font-family:sans-serif;padding:20px;color:#64748b;line-height:1.5"><p>${esc(err.message)}</p></body></html>`;
  }
}

function bindPreviewListeners() {
  const form = $("#siteForm");
  if (!form || form.dataset.previewBound) return;
  form.dataset.previewBound = "1";
  form.addEventListener("input", schedulePreviewUpdate);
  form.addEventListener("change", schedulePreviewUpdate);
}

function buildPreviewUrl(domain) {
  const d = (domain || "").trim().toLowerCase();
  const base = getClientBaseUrl().replace(/\/$/, "");
  if (!d || d === "localhost" || d === "127.0.0.1") return `${base}/`;
  return `${base}/?preview=${encodeURIComponent(d)}`;
}

function buildProductionUrl(domain) {
  const d = (domain || "").trim().toLowerCase();
  if (!d || d === "localhost" || d === "127.0.0.1") return "";
  return `https://${d}`;
}

function renderSubdomainOptions(subdomains, selectedId = "") {
  return [
    '<option value="">— Nhập domain thủ công —</option>',
    ...subdomains
      .filter((s) => !s.site_id || String(s.site_id) === String(selectedId))
      .map(
        (s) =>
          `<option value="${s.id}" data-domain="${esc(s.domain)}"${String(s.id) === String(selectedId) ? " selected" : ""}>${esc(s.domain)}</option>`,
      ),
  ].join("");
}

async function loadSubdomainOptionsForForm(siteId = null) {
  const qs = siteId ? `?site_id=${siteId}` : "?available=1";
  const subdomains = await api(`/subdomains${qs}`);
  const pick = $("#subdomainPick");
  if (!pick) return subdomains;

  const current = siteId ? subdomains.find((s) => Number(s.site_id) === Number(siteId)) : null;
  pick.innerHTML = renderSubdomainOptions(subdomains, current?.id || "");
  pick.value = current ? String(current.id) : "";
  syncDomainPickUi();
  return subdomains;
}

function syncDomainPickUi() {
  const pick = $("#subdomainPick");
  const domainInput = $("#domain");
  const manualGroup = $("#manualDomainGroup");
  if (!pick || !domainInput) return;

  const option = pick.selectedOptions[0];
  const picked = pick.value;
  if (picked && option?.dataset.domain) {
    domainInput.value = option.dataset.domain;
    domainInput.readOnly = true;
    manualGroup?.classList.add("domain-pick-active");
  } else {
    domainInput.readOnly = false;
    manualGroup?.classList.remove("domain-pick-active");
  }
  updateDomainUrlPreview();
}

function updateDomainUrlPreview() {
  const domain = $("#domain")?.value.trim() || "";
  const preview = buildPreviewUrl(domain);
  const production = buildProductionUrl(domain);
  const previewEl = $("#previewUrlText");
  const prodEl = $("#productionUrlText");
  const openEl = $("#openPreviewUrl");
  const cfBtn = $("#cfDnsBtn");
  if (!previewEl) return;
  previewEl.textContent = preview;
  prodEl.textContent = production || "— (chỉ dùng khi có domain thật)";
  if (openEl) {
    openEl.href = preview;
    openEl.classList.toggle("hidden", !domain);
  }
  if (cfBtn) {
    const canCf = domain && domain !== "localhost" && domain !== "127.0.0.1";
    cfBtn.classList.toggle("hidden", !canCf);
  }
}

async function copyText(text) {
  await navigator.clipboard.writeText(text);
  toast("Đã copy");
}

function bindCopyUrlClicks() {
  $$("[data-copy-url]").forEach((el) => {
    el.addEventListener("click", () => copyText(el.dataset.copyUrl));
  });
}

async function loadServerConfig() {
  serverConfig = await api("/config");
}

function collectOtherProducts() {
  return [...$("#otherProducts").querySelectorAll(".other-row")].map((row, i) => {
    const sitePick = row.querySelector('[data-field="site_id"]');
    const siteId = sitePick?.value ? Number(sitePick.value) : null;
    return {
      name: row.querySelector('[data-field="name"]')?.value || "",
      tag: row.querySelector('[data-field="tag"]')?.value || "",
      url: row.querySelector('[data-field="url"]')?.value.trim() || "",
      site_id: siteId,
      img: otherProducts[i]?.img || "",
    };
  });
}

async function fillForm(site) {
  editingId = site?.id || null;
  $("#editTitle").textContent = site ? `Sửa: ${site.domain}` : "Thêm trang mới";
  $("#deleteBtn").classList.toggle("hidden", !site);
  $("#siteId").value = site?.id || "";
  $("#visit_count").value = formatVisits(site?.visit_count ?? 0);

  await loadSubdomainOptionsForForm(site?.id || null);

  const fields = [
    "domain", "name", "page_title", "shop_logo_main", "shop_logo_accent",
    "shop_badge", "messenger_url", "tag_new", "tag_hot", "product_title",
    "seller_avatar", "seller_name", "seller_meta", "seller_verified",
    "stat_chip_1", "stat_chip_2", "detail_title", "brand_color", "accent_color",
  ];
  fields.forEach((f) => {
    const el = $(`#${f}`);
    if (el) el.value = site?.[f] ?? el.defaultValue ?? "";
  });

  $("#active").value = site?.active === false ? "0" : "1";
  productImages = [...(site?.product_images || [])];
  detailImages = [...(site?.detail_images || [])];
  otherProducts = (site?.other_products || []).map((p) => ({
    name: p.name || "",
    tag: p.tag || "",
    img: p.img || "",
    url: p.url || "",
    site_id: p.site_id || null,
  }));
  renderProductImages();
  renderDetailImages();
  renderOtherProducts();
  initEditor();
  quill.root.innerHTML = site?.detail_content || "";
  syncDomainPickUi();
  schedulePreviewUpdate();
}

function getFormData() {
  const subdomainPick = $("#subdomainPick")?.value || "";
  const data = {
    domain: $("#domain").value.trim(),
    name: $("#name").value.trim(),
    page_title: $("#page_title").value.trim(),
    shop_logo_main: $("#shop_logo_main").value.trim(),
    shop_logo_accent: $("#shop_logo_accent").value.trim(),
    shop_badge: $("#shop_badge").value.trim(),
    messenger_url: $("#messenger_url").value.trim(),
    tag_new: $("#tag_new").value.trim(),
    tag_hot: $("#tag_hot").value.trim(),
    product_title: $("#product_title").value.trim(),
    seller_avatar: $("#seller_avatar").value.trim(),
    seller_name: $("#seller_name").value.trim(),
    seller_meta: $("#seller_meta").value.trim(),
    seller_verified: $("#seller_verified").value.trim(),
    stat_chip_1: $("#stat_chip_1").value.trim(),
    stat_chip_2: $("#stat_chip_2").value.trim(),
    detail_title: $("#detail_title").value.trim(),
    detail_content: quill.root.innerHTML,
    brand_color: $("#brand_color").value,
    accent_color: $("#accent_color").value,
    active: $("#active").value === "1",
    product_images: productImages,
    detail_images: detailImages,
    other_products: collectOtherProducts(),
  };
  if (subdomainPick) data.subdomain_id = Number(subdomainPick);
  else if (editingId) data.subdomain_id = null;
  return data;
}

function renderParentOptions(parents, selectedId = "") {
  return [
    '<option value="">— Chọn domain cha —</option>',
    ...parents.map(
      (p) =>
        `<option value="${p.id}"${String(p.id) === String(selectedId) ? " selected" : ""}>${esc(p.domain)}</option>`,
    ),
  ].join("");
}

function defaultCnameTargetForParent(domain) {
  const normalized = String(domain || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .replace(/\.$/, "");
  return normalized ? `origin.${normalized}` : "";
}

function formatDnsToast(result) {
  if (!result) return "Đã cấu hình DNS";
  if (result.recordType === "CNAME") {
    return `Đã tạo CNAME → ${result.cnameTarget || result.record?.content || "origin"}`;
  }
  if (result.recordType === "A") return "Đã tạo/cập nhật bản ghi A trỏ IP server";
  return "Đã cấu hình DNS trên Cloudflare";
}

function resetParentDomainForm() {
  $("#parentEditId").value = "";
  $("#parentDomainForm").reset();
  $("#parentCfToken").required = true;
  $("#parentCfToken").placeholder = "Nhập Zone.DNS Edit API Token...";
  $("#parentCnameTarget").placeholder = "Mặc định: origin.tenmiencha.com";
  $("#parentFormSummary").textContent = "Thêm Domain Cha mới (Cấu hình API Cloudflare)";
  $("#parentFormSubmitLabel").textContent = "Lưu domain cha";
  $("#parentFormCancelBtn")?.classList.add("hidden");
}

function startEditParentDomain(parent) {
  $("#parentEditId").value = String(parent.id);
  $("#parentDomain").value = parent.domain || "";
  $("#parentCfToken").value = "";
  $("#parentCfToken").required = false;
  $("#parentCfToken").placeholder = "Để trống nếu không đổi token";
  $("#parentZoneId").value = parent.cf_zone_id || "";
  $("#parentServerIp").value = parent.server_ip || "";
  $("#parentCnameTarget").value = parent.cname_target || "";
  $("#parentCnameTarget").placeholder = defaultCnameTargetForParent(parent.domain);
  $("#parentProxied").value = parent.cf_proxied ? "1" : "0";
  $("#parentFormSummary").textContent = `Sửa domain cha: ${parent.domain}`;
  $("#parentFormSubmitLabel").textContent = "Cập nhật domain cha";
  $("#parentFormCancelBtn")?.classList.remove("hidden");
  $("#parentDomainDetails")?.setAttribute("open", "");
  $("#parentDomain").focus();
  if (typeof lucide !== "undefined") lucide.createIcons();
}

async function loadParentDomains() {
  const parents = await api("/parent-domains");
  $("#childParentId").innerHTML = renderParentOptions(parents);

  $("#parentDomainsTableBody").innerHTML = parents.length
    ? parents
        .map(
          (p) => `
      <tr>
        <td><strong>${esc(p.domain)}</strong></td>
        <td><code>${esc(p.cname_target || defaultCnameTargetForParent(p.domain))}</code></td>
        <td><code>${esc(p.server_ip || "—")}</code></td>
        <td><span class="badge ${p.has_token ? "badge-on" : "badge-off"}">${p.has_token ? "OK" : "Thiếu"}</span></td>
        <td class="domain-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-edit-parent="${p.id}">Sửa</button>
          <button type="button" class="btn btn-ghost btn-sm" data-parent-dns="${p.id}" data-parent-domain="${esc(p.domain)}">DNS</button>
          <button type="button" class="btn btn-ghost btn-sm" data-parent-verify="${p.id}">Test</button>
          <button type="button" class="btn btn-danger btn-sm" data-del-parent="${p.id}">Xóa</button>
        </td>
      </tr>`,
        )
        .join("")
    : `<tr><td colspan="5" style="color:var(--muted);text-align:center;padding:24px">Chưa có domain cha. Mở form phía trên để thêm token.</td></tr>`;

  $$("[data-edit-parent]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const parent = parents.find((p) => String(p.id) === btn.dataset.editParent);
      if (parent) startEditParentDomain(parent);
    });
  });

  $$("[data-parent-dns]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const domain = btn.dataset.parentDomain;
      if (!confirm(`Tạo DNS (CNAME hoặc A) cho ${domain} bằng token domain cha?`)) return;
      try {
        const result = await api(`/parent-domains/${btn.dataset.parentDns}/dns`, {
          method: "POST",
          body: JSON.stringify({ domain }),
        });
        toast(formatDnsToast(result));
      } catch (err) {
        alert(err.message);
      }
    });
  });

  $$("[data-parent-verify]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await api(`/parent-domains/${btn.dataset.parentVerify}/verify`, { method: "POST" });
        toast("Token hợp lệ");
      } catch (err) {
        alert(err.message);
      }
    });
  });

  $$("[data-del-parent]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Xóa domain cha này?")) return;
      try {
        await api(`/parent-domains/${btn.dataset.delParent}`, { method: "DELETE" });
        toast("Đã xóa domain cha");
        await loadDomains();
      } catch (err) {
        alert(err.message);
      }
    });
  });

  if (typeof lucide !== "undefined") lucide.createIcons();
  return parents;
}

async function loadDomains() {
  const [subdomains, config] = await Promise.all([
    api("/subdomains"),
    loadParentDomains().then(() => api("/config")),
  ]);

  const hint = $("#serverIpHint");
  if (hint) {
    hint.innerHTML = config.publicIp
      ? `IP public server: <strong>${esc(config.publicIp)}</strong> · <code>${esc(config.baseUrl)}</code>`
      : "Chưa lấy được IP public server. Nhập IP trong Domain cha hoặc khởi động lại server.";
  }

  $("#subdomainsTableBody").innerHTML = subdomains.length
    ? subdomains
        .map(
          (s) => `
      <tr>
        <td>
          <strong>${esc(s.domain)}</strong>
          <div class="domain-note">thuộc ${esc(s.parent_domain)}</div>
        </td>
        <td>
          ${
            s.site_id
              ? `<span class="badge badge-on">Đã gán</span> ${esc(s.site_name || s.page_title || "Trang #" + s.site_id)}`
              : `<span class="badge badge-off">Chưa gán</span>`
          }
        </td>
        <td class="url-cell">
          <code class="url-code url-copy" data-copy-url="${esc(s.server_check_url || config.baseUrl)}" title="IP public server — bấm để copy">${esc(s.server_check_url || config.baseUrl)}</code>
        </td>
        <td class="domain-actions">
          ${s.site_id ? `<button type="button" class="btn btn-ghost btn-sm" data-edit-site="${s.site_id}">Sửa trang</button>` : ""}
          <a class="btn btn-ghost btn-sm" href="${esc(s.preview_url)}" target="_blank" rel="noopener">Xem</a>
          <button type="button" class="btn btn-ghost btn-sm" data-cf-dns="${esc(s.domain)}">DNS</button>
          ${s.site_id ? "" : `<button type="button" class="btn btn-danger btn-sm" data-del-subdomain="${s.id}">Xóa</button>`}
        </td>
      </tr>`,
        )
        .join("")
    : `<tr><td colspan="4" style="color:var(--muted);text-align:center;padding:32px">Chưa có subdomain. Tạo ở form trên (cần domain cha trước).</td></tr>`;

  bindCopyUrlClicks();

  $$("[data-edit-site]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await openEditView(btn.dataset.editSite);
      } catch (err) {
        alert(err.message);
      }
    });
  });

  $$("[data-del-subdomain]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Xóa subdomain này và bản ghi DNS trên Cloudflare?")) return;
      try {
        const result = await api(`/subdomains/${btn.dataset.delSubdomain}`, { method: "DELETE" });
        const dnsFailed = result.dns?.error;
        toast(dnsFailed ? "Đã xóa subdomain. DNS trên Cloudflare chưa xóa được." : "Đã xóa subdomain và DNS");
        await loadDomains();
      } catch (err) {
        alert(err.message);
      }
    });
  });

  $$("[data-cf-dns]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const domain = btn.dataset.cfDns;
      if (!confirm(`Tạo/cập nhật DNS (CNAME → origin hoặc A) cho ${domain} trên Cloudflare?`)) return;
      try {
        const result = await api("/cloudflare/dns", { method: "POST", body: JSON.stringify({ domain }) });
        toast(formatDnsToast(result));
      } catch (err) {
        alert(err.message);
      }
    });
  });

  if (typeof lucide !== "undefined") lucide.createIcons();
}

function inlineSubdomainOptions(subdomains, siteId, selectedId) {
  return subdomains
    .filter((sub) => !sub.site_id || Number(sub.site_id) === Number(siteId))
    .map(
      (sub) =>
        `<option value="${sub.id}" data-domain="${esc(sub.domain)}"${String(sub.id) === String(selectedId) ? " selected" : ""}>${esc(sub.domain)}</option>`,
    )
    .join("");
}

function syncInlineDomainRow(row) {
  const pick = row.querySelector("[data-inline-sub-pick]");
  const input = row.querySelector("[data-inline-domain]");
  const manualWrap = row.querySelector("[data-inline-manual-wrap]");
  if (!pick || !input) return;
  const option = pick.selectedOptions[0];
  if (pick.value && option?.dataset.domain) {
    input.value = option.dataset.domain;
    manualWrap?.classList.add("hidden");
  } else {
    manualWrap?.classList.remove("hidden");
  }
}

function updateSiteOverview(sites) {
  const activeCount = sites.filter((site) => site.active).length;
  const visitTotal = sites.reduce((sum, site) => sum + Number(site.visit_count || 0), 0);
  $("#siteTotalCount").textContent = formatVisits(sites.length);
  $("#siteActiveCount").textContent = formatVisits(activeCount);
  $("#siteInactiveCount").textContent = formatVisits(sites.length - activeCount);
  $("#siteVisitTotal").textContent = formatVisits(visitTotal);
}

function getFilteredSites() {
  const q = ($("#siteSearchInput")?.value || "").trim().toLowerCase();
  const status = $("#siteStatusFilter")?.value || "all";
  return siteListCache.filter((site) => {
    const haystack = [
      site.domain,
      site.name,
      site.page_title,
      site.product_title,
      site.preview_url,
    ].join(" ").toLowerCase();
    const matchesSearch = !q || haystack.includes(q);
    const matchesStatus =
      status === "all" ||
      (status === "active" && site.active) ||
      (status === "inactive" && !site.active);
    return matchesSearch && matchesStatus;
  });
}

function bindSiteCardActions() {
  $$("[data-site-row]").forEach((row) => syncInlineDomainRow(row));

  $$("[data-inline-sub-pick]").forEach((pick) => {
    pick.addEventListener("change", () => {
      syncInlineDomainRow(pick.closest("[data-site-row]"));
    });
  });

  $$("[data-save-domain]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const row = btn.closest("[data-site-row]");
      void saveInlineDomain(btn.dataset.saveDomain, row);
    });
  });

  bindCopyUrlClicks();

  $$("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await openEditView(btn.dataset.edit);
      } catch (err) {
        alert(err.message);
      }
    });
  });

  $$("[data-toggle-active]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const siteId = btn.dataset.toggleActive;
      const isActive = btn.dataset.active === "1";
      const nextActive = !isActive;
      if (!confirm(`${isActive ? "Tắt" : "Bật"} hoạt động trang này? Trang sẽ ${isActive ? "không" : ""} hiển thị công khai.`)) return;
      try {
        btn.disabled = true;
        await api(`/sites/${siteId}`, {
          method: "PUT",
          body: JSON.stringify({ active: nextActive }),
        });
        toast(nextActive ? "Đã bật hoạt động" : "Đã tắt hoạt động");
        await loadSites();
      } catch (err) {
        alert(err.message);
        btn.disabled = false;
      }
    });
  });

  $$("[data-delete-site]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("XÃ³a trang nÃ y? Subdomain sáº½ Ä‘Æ°á»£c giáº£i phÃ³ng Ä‘á»ƒ gÃ¡n láº¡i.")) return;
      try {
        await api(`/sites/${btn.dataset.deleteSite}`, { method: "DELETE" });
        toast("Đã xóa trang");
        await loadSites();
        await loadDomains();
      } catch (err) {
        alert(err.message);
      }
    });
  });

  if (typeof lucide !== "undefined") lucide.createIcons();
}

function renderSiteCards() {
  const filteredSites = getFilteredSites();
  const listEl = $("#sitesTableBody");

  if (!siteListCache.length) {
    listEl.innerHTML = `
      <div class="site-empty-state">
        <i data-lucide="layout-template"></i>
        <strong>Chưa có trang nào</strong>
        <span>Bấm "Thêm domain mới" để tạo landing page đầu tiên.</span>
      </div>`;
    bindSiteCardActions();
    return;
  }

  if (!filteredSites.length) {
    listEl.innerHTML = `
      <div class="site-empty-state">
        <i data-lucide="search-x"></i>
        <strong>Không tìm thấy trang phù hợp</strong>
        <span>Thử đổi từ khóa hoặc bộ lọc trạng thái.</span>
      </div>`;
    bindSiteCardActions();
    return;
  }

  listEl.innerHTML = filteredSites
    .map((s) => {
      const currentSub = subdomainListCache.find((sub) => Number(sub.site_id) === Number(s.id));
      const subOptions = inlineSubdomainOptions(subdomainListCache, s.id, currentSub?.id || "");
      const title = s.name || s.product_title || s.page_title || "Chưa đặt tên";
      return `
      <article class="site-card" data-site-row="${s.id}">
        <div class="site-card-main">
          <div class="site-card-heading">
            <span class="site-status-dot ${s.active ? "is-active" : "is-inactive"}"></span>
            <div>
              <h3>${esc(s.domain)}</h3>
              <p>${esc(title)}</p>
            </div>
          </div>
          <span class="badge ${s.active ? "badge-on" : "badge-off"}">${s.active ? "Hoạt động" : "Tắt"}</span>
        </div>

        <div class="site-card-meta">
          <button type="button" class="site-url-pill url-copy" data-copy-url="${esc(s.check_url || s.production_url || s.preview_url)}" title="Bấm để copy URL">
            <i data-lucide="copy"></i>
            <span>${esc(s.check_url || s.production_url || s.preview_url)}</span>
          </button>
          <div class="site-visit-pill">
            <i data-lucide="mouse-pointer-click"></i>
            <strong>${formatVisits(s.visit_count)}</strong>
            <span>lượt truy cập</span>
          </div>
        </div>

        <div class="site-domain-toolbar">
          <select class="inline-domain-select" data-inline-sub-pick data-site-id="${s.id}" title="Chọn subdomain">
            <option value="">Thủ công</option>
            ${subOptions}
          </select>
          <span class="inline-domain-manual${currentSub ? " hidden" : ""}" data-inline-manual-wrap>
            <input type="text" class="inline-domain-input" data-inline-domain data-site-id="${s.id}" value="${esc(s.domain)}" placeholder="domain.com" />
          </span>
          <button type="button" class="btn btn-primary btn-sm" data-save-domain="${s.id}">
            <i data-lucide="save"></i> Lưu
          </button>
        </div>

        <div class="site-actions">
          <button type="button" class="btn btn-ghost btn-sm site-toggle-btn${s.active ? " is-on" : ""}" data-toggle-active="${s.id}" data-active="${s.active ? "1" : "0"}" title="${s.active ? "Tắt trang tạm thời" : "Bật lại trang"}">
            <i data-lucide="${s.active ? "pause-circle" : "play-circle"}"></i>
            ${s.active ? "Tắt hoạt động" : "Bật hoạt động"}
          </button>
          <button type="button" class="btn btn-ghost btn-sm" data-edit="${s.id}">
            <i data-lucide="pencil"></i> Sửa
          </button>
          <a class="btn btn-ghost btn-sm" href="${esc(s.check_url || s.production_url || s.preview_url)}" target="_blank" rel="noopener">
            <i data-lucide="external-link"></i> Xem
          </a>
          <button type="button" class="btn btn-danger btn-sm" data-delete-site="${s.id}">
            <i data-lucide="trash-2"></i> Xóa
          </button>
        </div>
      </article>`;
    })
    .join("");

  bindSiteCardActions();
}

async function loadSitesOptimized() {
  const [sites, subdomains] = await Promise.all([api("/sites"), api("/subdomains")]);
  siteListCache = sites;
  subdomainListCache = subdomains;
  updateSiteOverview(sites);
  renderSiteCards();
}

async function saveInlineDomain(siteId, row) {
  const pick = row.querySelector("[data-inline-sub-pick]");
  const input = row.querySelector("[data-inline-domain]");
  const domain = input?.value.trim();
  if (!domain) {
    alert("Nhập domain hoặc chọn subdomain");
    return;
  }
  const body = pick?.value
    ? { subdomain_id: Number(pick.value) }
    : { subdomain_id: null, domain };
  try {
    await api(`/sites/${siteId}`, { method: "PUT", body: JSON.stringify(body) });
    toast("Đã lưu domain");
    await loadSites();
  } catch (err) {
    alert(err.message);
  }
}

async function loadSites() {
  return loadSitesOptimized();
  const [sites, subdomains] = await Promise.all([api("/sites"), api("/subdomains")]);
  $("#sitesTableBody").innerHTML = sites.length
    ? sites
        .map((s) => {
          const currentSub = subdomains.find((sub) => Number(sub.site_id) === Number(s.id));
          const subOptions = inlineSubdomainOptions(subdomains, s.id, currentSub?.id || "");
          return `
      <tr data-site-row="${s.id}">
        <td class="site-domain-cell">
          <div class="site-domain-current">${esc(s.domain)}</div>
          <div class="site-domain-toolbar">
            <select class="inline-domain-select" data-inline-sub-pick data-site-id="${s.id}" title="Chọn subdomain">
              <option value="">Thủ công</option>
              ${subOptions}
            </select>
            <span class="inline-domain-manual${currentSub ? " hidden" : ""}" data-inline-manual-wrap>
              <input type="text" class="inline-domain-input" data-inline-domain data-site-id="${s.id}" value="${esc(s.domain)}" placeholder="domain.com" />
            </span>
            <button type="button" class="btn btn-primary btn-sm" data-save-domain="${s.id}">Lưu</button>
          </div>
        </td>
        <td class="url-cell">
          <code class="url-code url-copy" data-copy-url="${esc(s.preview_url)}" title="Bấm để copy">${esc(s.preview_url)}</code>
        </td>
        <td class="site-name-cell">${esc(s.name || s.product_title?.slice(0, 30) || "—")}</td>
        <td class="site-visits-cell"><strong>${formatVisits(s.visit_count)}</strong></td>
        <td class="site-status-cell">
          <span class="badge ${s.active ? "badge-on" : "badge-off"}">${s.active ? "Hoạt động" : "Tắt"}</span>
        </td>
        <td class="site-actions-cell">
          <div class="site-actions">
            <button type="button" class="btn btn-ghost btn-sm" data-edit="${s.id}">Sửa</button>
            <a class="btn btn-ghost btn-sm" href="${esc(s.preview_url)}" target="_blank" rel="noopener">Xem</a>
            <button type="button" class="btn btn-danger btn-sm" data-delete-site="${s.id}">Xóa</button>
          </div>
        </td>
      </tr>`;
        })
        .join("")
    : `<tr><td colspan="6" style="color:var(--muted);text-align:center;padding:32px">Chưa có trang nào. Bấm "Thêm domain mới".</td></tr>`;

  $$("[data-site-row]").forEach((row) => syncInlineDomainRow(row));

  $$("[data-inline-sub-pick]").forEach((pick) => {
    pick.addEventListener("change", () => {
      syncInlineDomainRow(pick.closest("[data-site-row]"));
    });
  });

  $$("[data-save-domain]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const row = btn.closest("[data-site-row]");
      void saveInlineDomain(btn.dataset.saveDomain, row);
    });
  });

  bindCopyUrlClicks();

  $$("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await openEditView(btn.dataset.edit);
      } catch (err) {
        alert(err.message);
      }
    });
  });

  $$("[data-toggle-active]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const siteId = btn.dataset.toggleActive;
      const isActive = btn.dataset.active === "1";
      const nextActive = !isActive;
      if (!confirm(`${isActive ? "Tắt" : "Bật"} hoạt động trang này? Trang sẽ ${isActive ? "không" : ""} hiển thị công khai.`)) return;
      try {
        btn.disabled = true;
        await api(`/sites/${siteId}`, {
          method: "PUT",
          body: JSON.stringify({ active: nextActive }),
        });
        toast(nextActive ? "Đã bật hoạt động" : "Đã tắt hoạt động");
        await loadSites();
      } catch (err) {
        alert(err.message);
        btn.disabled = false;
      }
    });
  });

  $$("[data-delete-site]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Xóa trang này? Subdomain sẽ được giải phóng để gán lại.")) return;
      try {
        await api(`/sites/${btn.dataset.deleteSite}`, { method: "DELETE" });
        toast("Đã xóa trang");
        await loadSites();
        await loadDomains();
      } catch (err) {
        alert(err.message);
      }
    });
  });

  if (typeof lucide !== "undefined") lucide.createIcons();
}

async function uploadFiles(files) {
  const fd = new FormData();
  [...files].forEach((f) => fd.append("files", f));

  async function doUpload(retry = true) {
    const res = await fetch(`${API}/upload-multiple`, {
      method: "POST",
      body: fd,
      headers: authHeaders(),
      credentials: "same-origin",
    });
    const data = await res.json().catch(() => ({}));
    if (
      res.status === 401 &&
      retry &&
      (data.code === "TOKEN_EXPIRED" || data.code === "NO_TOKEN" || data.code === "INVALID_TOKEN")
    ) {
      await refreshAccessToken();
      return doUpload(false);
    }
    if (!res.ok) throw new Error(data.error || "Upload lỗi");
    return data.urls;
  }

  return doUpload();
}

function showApp(loggedIn) {
  $("#loginView").style.display = loggedIn ? "none" : "flex";
  $("#loginThemeBtn").style.display = loggedIn ? "none" : "flex";
  $("#app").classList.toggle("is-open", loggedIn);
  if (typeof lucide !== "undefined") lucide.createIcons();
}

async function checkAuth() {
  const version = ++authCheckVersion;
  try {
    if (!accessToken) await refreshAccessToken();
    if (version !== authCheckVersion) return;
    await api("/me");
    if (version !== authCheckVersion) return;
    showApp(true);
    await loadServerConfig();
    if (version !== authCheckVersion) return;
    await loadSites();
    if (version !== authCheckVersion) return;
    const urlState = getAdminUrlState();
    if (urlState.view !== "list" || urlState.siteId) {
      await applyAdminUrlState(urlState, { replace: true });
    } else {
      showView("list", { replace: true });
    }
  } catch {
    if (version !== authCheckVersion) return;
    setAccessToken(null);
    showApp(false);
  }
}

$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const version = ++authCheckVersion;
  try {
    const data = await api("/login", {
      method: "POST",
      body: JSON.stringify({
        username: $("#username").value.trim(),
        password: $("#password").value,
      }),
    }, false);
    if (version !== authCheckVersion) return;
    setAccessToken(data.accessToken);
    $("#loginError").style.display = "none";
    showApp(true);
    await loadServerConfig();
    if (version !== authCheckVersion) return;
    await loadSites();
    if (version !== authCheckVersion) return;
    const urlState = getAdminUrlState();
    if (urlState.view !== "list" || urlState.siteId) {
      await applyAdminUrlState(urlState, { replace: true });
    } else {
      showView("list", { replace: true });
    }
  } catch (err) {
    if (version !== authCheckVersion) return;
    $("#loginError").textContent = err.message;
    $("#loginError").style.display = "block";
  }
});

$("#logoutBtn").addEventListener("click", async () => {
  try {
    await api("/logout", { method: "POST" });
  } finally {
    setAccessToken(null);
    location.reload();
  }
});

$("#addSiteBtn").addEventListener("click", async () => {
  await openEditView(null);
});

$("#exportSitesBtn")?.addEventListener("click", async () => {
  const data = await api("/sites/export");
  const text = JSON.stringify(data, null, 2);
  const blob = new Blob([text], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `domains-export-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast("Đã xuất file JSON");
});

$("#siteSearchInput")?.addEventListener("input", renderSiteCards);
$("#siteStatusFilter")?.addEventListener("change", renderSiteCards);

$("#domain")?.addEventListener("input", updateDomainUrlPreview);

$("#copyPreviewUrl")?.addEventListener("click", () => {
  copyText($("#previewUrlText").textContent);
});

$("#cfDnsBtn")?.addEventListener("click", async () => {
  const domain = $("#domain").value.trim();
  if (!domain || !confirm(`Tạo/cập nhật DNS (CNAME → origin hoặc A) cho ${domain} trên Cloudflare?`)) return;
  try {
    const result = await api("/cloudflare/dns", { method: "POST", body: JSON.stringify({ domain }) });
    toast(formatDnsToast(result));
  } catch (err) {
    alert(err.message);
  }
});

$("#parentDomainForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const editId = $("#parentEditId").value.trim();
  const payload = {
    domain: $("#parentDomain").value.trim(),
    cf_zone_id: $("#parentZoneId").value.trim(),
    server_ip: $("#parentServerIp").value.trim(),
    cname_target: $("#parentCnameTarget").value.trim(),
    cf_proxied: $("#parentProxied").value === "1",
  };
  const token = $("#parentCfToken").value.trim();
  if (token) payload.cf_api_token = token;
  try {
    if (editId) {
      await api(`/parent-domains/${editId}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      toast("Đã cập nhật domain cha");
    } else {
      if (!token) {
        alert("Cần nhập Cloudflare API Token");
        return;
      }
      payload.cf_api_token = token;
      await api("/parent-domains", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      toast("Đã lưu domain cha");
    }
    resetParentDomainForm();
    await loadDomains();
  } catch (err) {
    alert(err.message);
  }
});

$("#parentFormCancelBtn")?.addEventListener("click", () => {
  resetParentDomainForm();
});

$("#subdomainForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const parentId = $("#childParentId").value;
  if (!parentId) {
    switchDomainTab("parents");
    alert("Thêm domain cha (API Token) trước khi tạo subdomain.");
    return;
  }
  try {
    const result = await api(`/parent-domains/${parentId}/subdomains`, {
      method: "POST",
      body: JSON.stringify({
        subdomain: $("#childSubdomain").value.trim(),
        auto_dns: true,
      }),
    });
    $("#childSubdomain").value = "";
    if (result.dns?.error) {
      toast(`Đã tạo subdomain. DNS: ${result.dns.error}`);
    } else {
      toast(`Đã tạo subdomain + ${formatDnsToast(result.dns)}`);
    }
    await loadDomains();
  } catch (err) {
    alert(err.message);
  }
});

$("#subdomainPick")?.addEventListener("change", () => {
  syncDomainPickUi();
  schedulePreviewUpdate();
});

$$("[data-domain-tab]").forEach((btn) => {
  btn.addEventListener("click", () => switchDomainTab(btn.dataset.domainTab));
});

$("#cancelBtn").addEventListener("click", () => showView("list"));

$$(".nav-btn[data-view]").forEach((btn) => {
  btn.addEventListener("click", () => {
    showView(btn.dataset.view);
  });
});

window.addEventListener("popstate", async (event) => {
  if (!$("#app")?.classList.contains("is-open")) return;
  const state = event.state || getAdminUrlState();
  await applyAdminUrlState(state, { replace: true });
});

$("#siteForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = getFormData();
  try {
    if (editingId) {
      await api(`/sites/${editingId}`, { method: "PUT", body: JSON.stringify(data) });
      toast("Đã cập nhật trang");
    } else {
      await api("/sites", { method: "POST", body: JSON.stringify(data) });
      toast("Đã tạo trang mới");
    }
    await loadSites();
    showView("list");
  } catch (err) {
    alert(err.message);
  }
});

$("#deleteBtn").addEventListener("click", async () => {
  if (!editingId || !confirm("Xóa trang này? Subdomain sẽ được giải phóng để gán lại.")) return;
  try {
    await api(`/sites/${editingId}`, { method: "DELETE" });
    toast("Đã xóa trang");
    editingId = null;
    await loadSites();
    await loadDomains();
    showView("list");
  } catch (err) {
    alert(err.message);
  }
});

$("#productUpload").addEventListener("change", async (e) => {
  if (!e.target.files.length) return;
  try {
    const urls = await uploadFiles(e.target.files);
    productImages.push(...urls);
    renderProductImages();
    e.target.value = "";
  } catch (err) {
    alert(err.message);
  }
});

$("#productImages").addEventListener("click", (e) => {
  const i = e.target.dataset.rmImg;
  if (i !== undefined) {
    productImages.splice(Number(i), 1);
    renderProductImages();
    schedulePreviewUpdate();
  }
});

$("#detailUpload").addEventListener("change", async (e) => {
  if (!e.target.files.length) return;
  try {
    const urls = await uploadFiles(e.target.files);
    detailImages.push(...urls);
    renderDetailImages();
    e.target.value = "";
  } catch (err) {
    alert(err.message);
  }
});

$("#detailImages").addEventListener("click", (e) => {
  const i = e.target.dataset.rmDetailImg;
  if (i !== undefined) {
    detailImages.splice(Number(i), 1);
    renderDetailImages();
    schedulePreviewUpdate();
  }
});

$("#addOtherBtn").addEventListener("click", () => {
  otherProducts = collectOtherProducts();
  otherProducts.push({ name: "", tag: "", img: productImages[0] || "", url: "", site_id: null });
  renderOtherProducts();
});

$("#otherProducts").addEventListener("change", (e) => {
  if (e.target.dataset.field !== "site_id") return;
  const row = e.target.closest(".other-row");
  if (!row) return;
  const opt = e.target.selectedOptions[0];
  if (!opt?.value) return;
  const nameEl = row.querySelector('[data-field="name"]');
  const tagEl = row.querySelector('[data-field="tag"]');
  const urlEl = row.querySelector('[data-field="url"]');
  if (nameEl && opt.dataset.name) nameEl.value = opt.dataset.name;
  if (tagEl && opt.dataset.tag) tagEl.value = opt.dataset.tag;
  if (urlEl && opt.dataset.url) urlEl.value = opt.dataset.url;
  if (opt.dataset.img) {
    const i = Number(row.dataset.i);
    const thumb = opt.dataset.img;
    otherProducts[i] = { ...(otherProducts[i] || {}), img: thumb };
    const imgEl = row.querySelector("img");
    if (imgEl) imgEl.src = thumb;
  }
  schedulePreviewUpdate();
});

$("#otherProducts").addEventListener("click", (e) => {
  if (e.target.dataset.rmOther !== undefined) {
    otherProducts = collectOtherProducts();
    otherProducts.splice(Number(e.target.dataset.rmOther), 1);
    renderOtherProducts();
    schedulePreviewUpdate();
  }
});

const THEME_KEY = "admin-theme";

function getTheme() {
  return document.documentElement.dataset.theme || "dark";
}

function updateThemeUi() {
  const isDark = getTheme() === "dark";
  const label = isDark ? "Giao diện sáng" : "Giao diện tối";
  const icon = isDark ? "☀️" : "🌙";
  ["themeLabel", "loginThemeLabel"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.textContent = label;
  });
  ["themeIcon", "loginThemeIcon"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.textContent = icon;
  });
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
  updateThemeUi();
}

function toggleTheme() {
  setTheme(getTheme() === "dark" ? "light" : "dark");
}

function initTheme() {
  setTheme(localStorage.getItem(THEME_KEY) || "dark");
}

$("#themeToggle")?.addEventListener("click", toggleTheme);
$("#loginThemeBtn")?.addEventListener("click", toggleTheme);
initTheme();

$("#parentDomain")?.addEventListener("input", () => {
  const target = defaultCnameTargetForParent($("#parentDomain").value);
  if (target) $("#parentCnameTarget").placeholder = target;
});

checkAuth();
