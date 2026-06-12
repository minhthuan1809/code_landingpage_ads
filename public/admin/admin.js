const API = "/api/admin";

let quill;
let productImages = [];
let detailImages = [];
let otherProducts = [];
let editingId = null;
let serverConfig = { port: 3000 };
let authCheckVersion = 0;
let accessToken = sessionStorage.getItem("accessToken") || null;
let refreshPromise = null;

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

function showView(name) {
  $("#listView").classList.toggle("hidden", name !== "list");
  $("#domainsView").classList.toggle("hidden", name !== "domains");
  $("#editView").classList.toggle("hidden", name !== "edit");
  $$(".nav-btn[data-view]").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === name);
  });
  if (name === "domains") loadDomains();
  if (typeof lucide !== "undefined") lucide.createIcons();
}

function switchDomainTab(tab) {
  $$("[data-domain-tab]").forEach((b) => {
    b.classList.toggle("active", b.dataset.domainTab === tab);
  });
  $("#domainChildrenPanel").classList.toggle("hidden", tab !== "children");
  $("#domainParentsPanel").classList.toggle("hidden", tab !== "parents");
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
}

function renderProductImages() {
  $("#productImages").innerHTML = productImages
    .map(
      (url, i) =>
        `<div class="img-item"><img src="${url}" alt=""><button type="button" data-rm-img="${i}">×</button></div>`,
    )
    .join("");
}

function renderDetailImages() {
  $("#detailImages").innerHTML = detailImages
    .map(
      (url, i) =>
        `<div class="img-item"><img src="${url}" alt=""><button type="button" data-rm-detail-img="${i}">×</button></div>`,
    )
    .join("");
}

function renderOtherProducts() {
  $("#otherProducts").innerHTML = otherProducts
    .map(
      (p, i) => `
    <div class="other-row" data-i="${i}">
      <img src="${p.img || ""}" alt="" onerror="this.style.background='#333'">
      <input type="text" placeholder="Tên SP" value="${esc(p.name)}" data-field="name">
      <input type="text" placeholder="Tag" value="${esc(p.tag)}" data-field="tag">
      <button type="button" class="btn btn-danger btn-sm" data-rm-other="${i}">×</button>
    </div>`,
    )
    .join("");
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

function buildPreviewUrl(domain) {
  const d = (domain || "").trim().toLowerCase();
  const port = serverConfig.port || 3000;
  const base = `http://127.0.0.1:${port}`;
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
    ...subdomains.map(
      (s) =>
        `<option value="${s.id}" data-domain="${esc(s.domain)}"${String(s.id) === String(selectedId) ? " selected" : ""}>${esc(s.domain)}${s.site_id && String(s.site_id) !== String(selectedId) ? " (đã gán)" : ""}</option>`,
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
  return [...$("#otherProducts").querySelectorAll(".other-row")].map((row, i) => ({
    name: row.querySelector('[data-field="name"]').value,
    tag: row.querySelector('[data-field="tag"]').value,
    img: otherProducts[i]?.img || "",
  }));
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
  otherProducts = [...(site?.other_products || [])];
  renderProductImages();
  renderDetailImages();
  renderOtherProducts();
  initEditor();
  quill.root.innerHTML = site?.detail_content || "";
  syncDomainPickUi();
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

async function loadParentDomains() {
  const parents = await api("/parent-domains");
  $("#childParentId").innerHTML = renderParentOptions(parents);

  $("#parentDomainsTableBody").innerHTML = parents.length
    ? parents
        .map(
          (p) => `
      <tr>
        <td><strong>${esc(p.domain)}</strong></td>
        <td><code>${esc(p.server_ip || "—")}</code></td>
        <td><span class="badge ${p.has_token ? "badge-on" : "badge-off"}">${p.has_token ? "OK" : "Thiếu"}</span></td>
        <td class="domain-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-parent-dns="${p.id}" data-parent-domain="${esc(p.domain)}">DNS</button>
          <button type="button" class="btn btn-ghost btn-sm" data-parent-verify="${p.id}">Test</button>
          <button type="button" class="btn btn-danger btn-sm" data-del-parent="${p.id}">Xóa</button>
        </td>
      </tr>`,
        )
        .join("")
    : `<tr><td colspan="4" style="color:var(--muted);text-align:center;padding:24px">Chưa có domain cha. Mở form phía trên để thêm token.</td></tr>`;

  $$("[data-parent-dns]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const domain = btn.dataset.parentDomain;
      if (!confirm(`Tạo DNS A cho ${domain} bằng token domain cha?`)) return;
      try {
        await api(`/parent-domains/${btn.dataset.parentDns}/dns`, {
          method: "POST",
          body: JSON.stringify({ domain }),
        });
        toast("Đã cấu hình DNS");
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
  const [subdomains] = await Promise.all([api("/subdomains"), loadParentDomains()]);

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
          <code class="url-code url-copy" data-copy-url="${esc(s.preview_url)}" title="Bấm để copy">${esc(s.preview_url)}</code>
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
      const site = await api(`/sites/${btn.dataset.editSite}`);
      await fillForm(site);
      showView("edit");
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
      if (!confirm(`Tạo/cập nhật bản ghi A cho ${domain} trên Cloudflare?`)) return;
      try {
        await api("/cloudflare/dns", { method: "POST", body: JSON.stringify({ domain }) });
        toast("Đã tạo DNS trên Cloudflare");
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
      const site = await api(`/sites/${btn.dataset.edit}`);
      await fillForm(site);
      showView("edit");
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
  await fillForm(null);
  showView("edit");
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

$("#domain")?.addEventListener("input", updateDomainUrlPreview);

$("#copyPreviewUrl")?.addEventListener("click", () => {
  copyText($("#previewUrlText").textContent);
});

$("#cfDnsBtn")?.addEventListener("click", async () => {
  const domain = $("#domain").value.trim();
  if (!domain || !confirm(`Tạo/cập nhật bản ghi A cho ${domain} trên Cloudflare?`)) return;
  try {
    await api("/cloudflare/dns", { method: "POST", body: JSON.stringify({ domain }) });
    toast("Đã tạo DNS trên Cloudflare");
  } catch (err) {
    alert(err.message);
  }
});

$("#parentDomainForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api("/parent-domains", {
      method: "POST",
      body: JSON.stringify({
        domain: $("#parentDomain").value.trim(),
        cf_api_token: $("#parentCfToken").value.trim(),
        cf_zone_id: $("#parentZoneId").value.trim(),
        server_ip: $("#parentServerIp").value.trim(),
        cf_proxied: $("#parentProxied").value === "1",
      }),
    });
    $("#parentDomainForm").reset();
    toast("Đã lưu domain cha");
    await loadDomains();
  } catch (err) {
    alert(err.message);
  }
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
      toast("Đã tạo subdomain + DNS");
    }
    await loadDomains();
  } catch (err) {
    alert(err.message);
  }
});

$("#subdomainPick")?.addEventListener("change", syncDomainPickUi);

$$("[data-domain-tab]").forEach((btn) => {
  btn.addEventListener("click", () => switchDomainTab(btn.dataset.domainTab));
});

$("#cancelBtn").addEventListener("click", () => showView("list"));

$$(".nav-btn[data-view]").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.dataset.view === "edit" && !editingId) void fillForm(null);
    showView(btn.dataset.view);
  });
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
  }
});

$("#addOtherBtn").addEventListener("click", () => {
  otherProducts = collectOtherProducts();
  otherProducts.push({ name: "", tag: "", img: productImages[0] || "" });
  renderOtherProducts();
});

$("#otherProducts").addEventListener("click", (e) => {
  if (e.target.dataset.rmOther !== undefined) {
    otherProducts = collectOtherProducts();
    otherProducts.splice(Number(e.target.dataset.rmOther), 1);
    renderOtherProducts();
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

checkAuth();
