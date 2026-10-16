// Minimal CDP harness: real Chromium + both extensions loaded, real downloads.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const PORT = Number(process.env.E2E_PORT || 8443);
const HOSTS = ["*.kci.go.kr", "*.riss.kr", "*.openlib.uos.ac.kr", "journal.example.org", "*.nrich.go.kr",
  "*.heritage.go.kr", "www.example-blog.com", "*.dbpia.co.kr", "libproxy.univ.ac.kr", "lib.opaque-univ.ac.kr", "scholar.google.co.kr", "viewer.publisher.example", "cdn.files.example"];

const sleep = ms => new Promise(r => setTimeout(r, ms));

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.listeners = [];
    ws.addEventListener("message", ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id); this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      } else if (msg.method) this.listeners.forEach(l => l(msg));
    });
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
    return new CDP(ws);
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`timeout ${method}`)); } }, 20000);
    });
  }
  on(fn) { this.listeners.push(fn); }
  close() { try { this.ws.close(); } catch (_e) {} }
}

async function launch({ extensions, downloadDir, hostRules }) {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-profile-"));
  fs.mkdirSync(path.join(userDir, "Default"), { recursive: true });
  fs.writeFileSync(path.join(userDir, "Default", "Preferences"), JSON.stringify({
    download: { default_directory: downloadDir, prompt_for_download: false, directory_upgrade: true },
    savefile: { default_directory: downloadDir }
  }));
  const port = 9300 + Math.floor(Math.random() * 600);
  const args = [
    "--headless=new", "--no-sandbox", "--ignore-certificate-errors", "--no-proxy-server", "--no-first-run", "--no-default-browser-check",
    `--remote-debugging-port=${port}`, `--user-data-dir=${userDir}`,
    ...(extensions.length ? [`--disable-extensions-except=${extensions.join(",")}`, `--load-extension=${extensions.join(",")}`] : []),
    `--host-resolver-rules=${hostRules || HOSTS.map(h => `MAP ${h} 127.0.0.1:${PORT}`).join(", ")}`,
    "--disable-features=HttpsUpgrades,HttpsFirstModeV2ForEngagedSites,HttpsFirstBalancedMode",
    "about:blank"
  ];
  const proc = spawn(CHROME, args, { stdio: ["ignore", "ignore", "pipe"], env: Object.assign({}, process.env, { LANG: "C.UTF-8", LC_ALL: "C.UTF-8" }) });
  let stderr = ""; proc.stderr.on("data", d => { stderr += d; });
  let version;
  for (let i = 0; i < 100; i++) {
    try { version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); break; } catch (_e) { await sleep(100); }
  }
  if (!version) throw new Error("chrome failed to start\n" + stderr.slice(-2000));
  const cdp = await CDP.connect(version.webSocketDebuggerUrl);
  await cdp.send("Target.setDiscoverTargets", { discover: true });
  const b = new Browser(cdp, proc, userDir, downloadDir);
  if (extensions.length) await b.waitForWorkers(extensions.length);
  return b;
}

class Browser {
  constructor(cdp, proc, userDir, downloadDir) {
    this.cdp = cdp; this.proc = proc; this.userDir = userDir; this.downloadDir = downloadDir;
  }
  async targets() { return (await this.cdp.send("Target.getTargets")).targetInfos; }
  async waitForWorkers(n) {
    for (let i = 0; i < 50; i++) {
      const sw = (await this.targets()).filter(t => t.type === "service_worker" && t.url.startsWith("chrome-extension://"));
      if (sw.length >= n) {
        this.extIds = {};
        for (const t of sw) {
          const id = t.url.split("/")[2];
          this.extIds[t.url.includes("src/background.js") ? id : id] = t.url;
        }
        return sw;
      }
      await sleep(100);
    }
    return [];
  }
  async extensionId(manifestNameFragment) {
    // Evaluate chrome.runtime.getManifest() in each worker.
    for (const t of (await this.targets()).filter(t => t.type === "service_worker")) {
      let r = ""; try { r = await this.evalIn(t.targetId, "chrome.runtime.getManifest().name"); } catch (_e) {}
      if (String(r).includes(manifestNameFragment)) return t.url.split("/")[2];
    }
    return null;
  }
  async attach(targetId) {
    const { sessionId } = await this.cdp.send("Target.attachToTarget", { targetId, flatten: true });
    return sessionId;
  }
  async evalIn(targetId, expression) {
    const s = await this.attach(targetId);
    try {
      await this.cdp.send("Runtime.enable", {}, s).catch(() => {});
      for (let i = 0; i < 30; i++) {
        const probe = await this.cdp.send("Runtime.evaluate", { expression: "typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.runtime.id", returnByValue: true }, s).catch(() => null);
        if (probe && probe.result && probe.result.value === true) break;
        await sleep(100);
      }
      const r = await this.cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, s);
      if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 500));
      return r.result.value;
    } finally { await this.cdp.send("Target.detachFromTarget", { sessionId: s }).catch(() => {}); }
  }
  async workerTarget(extId) {
    return (await this.targets()).find(t => t.type === "service_worker" && t.url.startsWith(`chrome-extension://${extId}/`));
  }
  // Evaluate inside an extension context. If the worker is asleep, wake it by opening an extension page.
  async evalExt(extId, expression) {
    let t = await this.workerTarget(extId);
    if (!t) {
      const page = await this.newPage(`chrome-extension://${extId}/manifest.json`);
      await sleep(300);
      const r = await this.evalPage(page, expression);
      await this.closePage(page);
      return r;
    }
    return this.evalIn(t.targetId, expression);
  }
  async stopWorkers() {
    for (const t of (await this.targets()).filter(t => t.type === "service_worker")) {
      await this.cdp.send("Target.closeTarget", { targetId: t.targetId }).catch(() => {});
    }
    for (let i = 0; i < 50; i++) {
      if (!(await this.targets()).some(t => t.type === "service_worker")) return true;
      await sleep(100);
    }
    return false;
  }
  async newPage(url) {
    const { targetId } = await this.cdp.send("Target.createTarget", { url: "about:blank" });
    const sessionId = await this.attach(targetId);
    await this.cdp.send("Page.enable", {}, sessionId);
    await this.cdp.send("Runtime.enable", {}, sessionId);
    const p = { targetId, sessionId };
    if (url !== "about:blank") await this.goto(p, url);
    return p;
  }
  async goto(p, url) {
    await this.cdp.send("Page.navigate", { url }, p.sessionId);
    // 다운로드로 끝나는 이동은 문서가 바뀌지 않는다. 문서 준비 상태를 직접 확인한다.
    const target = url.split("#")[0];
    for (let i = 0; i < 100; i++) {
      await sleep(100);
      const state = await this.cdp.send("Runtime.evaluate", { expression: "[document.readyState, location.href]", returnByValue: true }, p.sessionId).catch(() => null);
      const value = state && state.result && state.result.value;
      if (value && value[0] === "complete" && (value[1] === target || i > 30)) return;
    }
  }
  async evalPage(p, expression) {
    const r = await this.cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, p.sessionId);
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 500));
    return r.result.value;
  }
  async click(p, selector) {
    const box = await this.evalPage(p, `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; e.scrollIntoView({block:'center'}); const r = e.getBoundingClientRect(); return {x: r.x + r.width/2, y: r.y + r.height/2}; })()`);
    if (!box) throw new Error(`no element ${selector}`);
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
      await this.cdp.send("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 }, p.sessionId);
    }
  }
  async closePage(p) { await this.cdp.send("Target.closeTarget", { targetId: p.targetId }).catch(() => {}); }
  async pageTargets() { return (await this.targets()).filter(t => t.type === "page"); }
  async close() {
    this.cdp.close();
    this.proc.kill("SIGKILL");
    await sleep(200);
    fs.rmSync(this.userDir, { recursive: true, force: true });
  }
}

// 테스트용 자체 서명 인증서(없으면 만든다). 크로미움은 --ignore-certificate-errors로 띄운다.
function tlsOptions() {
  const key = path.join(__dirname, ".key.pem"), cert = path.join(__dirname, ".cert.pem");
  if (!fs.existsSync(key) || !fs.existsSync(cert)) {
    require("node:child_process").execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key,
      "-out", cert, "-days", "30", "-subj", "/CN=localhost"], { stdio: "ignore" });
  }
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}

module.exports = { launch, sleep, tlsOptions, PORT };
