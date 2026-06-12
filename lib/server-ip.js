const https = require("https");
const os = require("os");

let cachedPublicIp = "";
let detecting = null;

function isValidPublicIpv4(ip) {
  if (!ip || typeof ip !== "string") return false;
  const parts = ip.trim().split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return false;
  if (parts[0] === 10 || parts[0] === 127) return false;
  if (parts[0] === 192 && parts[1] === 168) return false;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return false;
  return true;
}

function fetchJson(url, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(null);
        }
      });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}

async function fetchPublicIpFromInternet() {
  const providers = [
    "https://api.ipify.org?format=json",
    "https://api64.ipify.org?format=json",
  ];
  for (const url of providers) {
    const data = await fetchJson(url);
    if (data?.ip && isValidPublicIpv4(data.ip)) return data.ip;
  }
  return "";
}

function getParentDomainServerIp() {
  try {
    const { getDefaultServerIp } = require("./db");
    const ip = getDefaultServerIp();
    return ip && isValidPublicIpv4(ip) ? ip : "";
  } catch {
    return "";
  }
}

function getLocalNetworkPublicIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family !== "IPv4" && net.family !== 4) continue;
      if (net.internal) continue;
      if (isValidPublicIpv4(net.address)) return net.address;
    }
  }
  return "";
}

function readStoredPublicIp() {
  const fromParent = getParentDomainServerIp();
  if (fromParent) return fromParent;
  try {
    const { getSetting } = require("./db");
    const fromSetting = getSetting("public_ip");
    if (fromSetting && isValidPublicIpv4(fromSetting)) return fromSetting;
  } catch {
    return "";
  }
  return "";
}

function persistPublicIp(ip) {
  if (!isValidPublicIpv4(ip)) return;
  cachedPublicIp = ip;
  try {
    const { setSetting } = require("./db");
    setSetting("public_ip", ip);
  } catch {
    // ignore
  }
}

async function detectPublicIp() {
  const fromEnv = process.env.PUBLIC_IP || process.env.SERVER_IP || "";
  if (fromEnv && isValidPublicIpv4(fromEnv)) {
    cachedPublicIp = fromEnv;
    return fromEnv;
  }

  const fromParent = getParentDomainServerIp();
  if (fromParent) {
    persistPublicIp(fromParent);
    return fromParent;
  }

  const fromLocal = getLocalNetworkPublicIp();
  if (fromLocal) {
    persistPublicIp(fromLocal);
    return fromLocal;
  }

  const fromApi = await fetchPublicIpFromInternet();
  if (fromApi) {
    persistPublicIp(fromApi);
    return fromApi;
  }

  const stored = readStoredPublicIp();
  if (stored) {
    cachedPublicIp = stored;
    return stored;
  }

  return "";
}

function getPublicIpSync() {
  const fromEnv = process.env.PUBLIC_IP || process.env.SERVER_IP || "";
  if (fromEnv && isValidPublicIpv4(fromEnv)) return fromEnv;
  if (cachedPublicIp) return cachedPublicIp;

  const fromParent = getParentDomainServerIp();
  if (fromParent) return fromParent;

  const fromLocal = getLocalNetworkPublicIp();
  if (fromLocal) return fromLocal;

  try {
    const { getSetting } = require("./db");
    const fromSetting = getSetting("public_ip");
    if (fromSetting && isValidPublicIpv4(fromSetting)) return fromSetting;
  } catch {
    return "";
  }

  return "";
}

function startPublicIpDetection() {
  if (!detecting) {
    detecting = detectPublicIp()
      .catch(() => "")
      .finally(() => {
        detecting = null;
      });
  }
  return detecting;
}

function rememberPublicIp(ip) {
  if (!isValidPublicIpv4(ip)) return;
  persistPublicIp(ip);
}

module.exports = {
  detectPublicIp,
  getPublicIpSync,
  startPublicIpDetection,
  rememberPublicIp,
  isValidPublicIpv4,
};
