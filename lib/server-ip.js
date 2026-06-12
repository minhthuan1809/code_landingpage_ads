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

function isPrivateOrLocalIpv4(ip) {
  if (!ip || typeof ip !== "string") return false;
  const parts = ip.trim().split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return false;
  if (parts[0] === 10 || parts[0] === 127) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  return false;
}

function getLocalMachineIpv4s() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family !== "IPv4" && net.family !== 4) continue;
      if (net.internal && net.address === "127.0.0.1") continue;
      if (!net.address) continue;
      ips.push(net.address);
    }
  }
  return [...new Set(ips)];
}

function getLocalMachineIpv4() {
  const ips = getLocalMachineIpv4s();
  return ips.find((ip) => isValidPublicIpv4(ip)) || ips.find((ip) => !ip.startsWith("127.")) || ips[0] || "";
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

function readStoredMachineIp() {
  try {
    const { getSetting } = require("./db");
    const fromSetting = getSetting("machine_ip") || getSetting("public_ip");
    if (fromSetting && (isValidPublicIpv4(fromSetting) || isPrivateOrLocalIpv4(fromSetting))) {
      return fromSetting;
    }
  } catch {
    return "";
  }
  return "";
}

function persistMachineIp(ip) {
  if (!ip || (!isValidPublicIpv4(ip) && !isPrivateOrLocalIpv4(ip))) return;
  cachedPublicIp = ip;
  try {
    const { setSetting } = require("./db");
    setSetting("machine_ip", ip);
    setSetting("public_ip", ip);
  } catch {
    // ignore
  }
}

async function detectPublicIp() {
  const fromEnv = process.env.PUBLIC_IP || process.env.SERVER_IP || "";
  if (fromEnv && (isValidPublicIpv4(fromEnv) || isPrivateOrLocalIpv4(fromEnv))) {
    cachedPublicIp = fromEnv;
    return fromEnv;
  }

  const fromLocal = getLocalMachineIpv4();
  if (fromLocal) {
    persistMachineIp(fromLocal);
    return fromLocal;
  }

  const fromApi = await fetchPublicIpFromInternet();
  if (fromApi) {
    persistMachineIp(fromApi);
    return fromApi;
  }

  const stored = readStoredMachineIp();
  if (stored) {
    cachedPublicIp = stored;
    return stored;
  }

  return "";
}

function getPublicIpSync() {
  const fromEnv = process.env.PUBLIC_IP || process.env.SERVER_IP || "";
  if (fromEnv && (isValidPublicIpv4(fromEnv) || isPrivateOrLocalIpv4(fromEnv))) return fromEnv;
  if (cachedPublicIp) return cachedPublicIp;

  const fromLocal = getLocalMachineIpv4();
  if (fromLocal) return fromLocal;

  return readStoredMachineIp();
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
  persistMachineIp(ip);
}

function hostMatchesMachine(host) {
  const normalized = String(host || "").split(":")[0].toLowerCase();
  if (!normalized) return false;
  if (normalized === "localhost" || normalized === "127.0.0.1" || normalized === "[::1]") return true;

  const machineIp = getPublicIpSync();
  if (machineIp && normalized === machineIp.toLowerCase()) return true;

  return getLocalMachineIpv4s().some((ip) => ip.toLowerCase() === normalized);
}

module.exports = {
  detectPublicIp,
  getPublicIpSync,
  getLocalMachineIpv4s,
  hostMatchesMachine,
  startPublicIpDetection,
  rememberPublicIp,
  isValidPublicIpv4,
  isPrivateOrLocalIpv4,
};
