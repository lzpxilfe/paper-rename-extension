// node run.js [--paper DIR] [--report DIR] [--only name] [--order paper-first|report-first] [--repeat N]
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { server } = require("./server.js");
const { launch, sleep } = require("./harness.js");

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const PAPER = path.resolve(arg("--paper", path.join(__dirname, "../..")));
const REPORT = path.resolve(arg("--report", path.join(__dirname, "../../../archreport")));
const ORDER = arg("--order", "paper-first");
const ONLY = arg("--only", "");
const REPEAT = Number(arg("--repeat", "1"));
const SOLO = arg("--solo", ""); // "paper" or "report" to load just one
// 압축해제 설치는 웹스토어 ID가 아니라서, 국가유산 페이지를 한 번 열어 서로를 찾게 한다.
const DISCOVER = argv.includes("--discover");

const KCI = id => `https://www.kci.go.kr/kciportal/ci/sereArticleSearch/ciSereArtiView.kci?sereArticleSearchBean.artiId=${id}`;
const T1 = "백제 한성기 토기의 편년";
const T2 = "고구려 산성의 축조 기법";
const has = s => name => name.includes(s);
const hasNot = (...ss) => name => ss.every(s => !name.includes(s));
const eq = s => name => name === s;


async function clickOpensPage(b, p, selector, urlFragment) {
  const before = new Set((await b.pageTargets()).map(t => t.targetId));
  await b.click(p, selector);
  let found;
  for (let i = 0; i < 60 && !found; i++) { await sleep(100); found = (await b.pageTargets()).find(t => !before.has(t.targetId) && t.url.includes(urlFragment)); }
  if (!found) throw new Error(`no new page for ${urlFragment}`);
  const sessionId = await b.attach(found.targetId);
  await b.cdp.send("Runtime.enable", {}, sessionId);
  return { targetId: found.targetId, sessionId };
}
const RISS = id => `https://www.riss.kr/search/detail/DetailView.do?p_mat_type=1a0202e37d52c72d&control_no=${id}`;

// Each scenario: steps(b) performs the user's actions; expect(name) checks the saved filename.
const SCENARIOS = [
  { name: "kci-same-tab-link", run: async b => { const p = await b.newPage(KCI("ART1")); await sleep(700); await b.click(p, "#dl-same"); return p; }, expect: has(T1) },
  { name: "kci-same-tab-link-immediate", run: async b => { const p = await b.newPage(KCI("ART1")); await b.click(p, "#dl-same"); return p; }, expect: has(T1) },
  { name: "kci-same-tab-after-long-read", run: async b => { const p = await b.newPage(KCI("ART1")); await sleep(6500); await b.click(p, "#dl-same"); return p; }, expect: has(T1) },
  { name: "kci-new-tab-link", run: async b => { const p = await b.newPage(KCI("ART1")); await sleep(700); await b.click(p, "#dl-blank"); return p; }, expect: has(T1) },
  { name: "kci-popup-viewer-then-download", run: async b => {
      const p = await b.newPage(KCI("ART1")); await sleep(700);
      const before = new Set((await b.pageTargets()).map(t => t.targetId));
      await b.click(p, "#dl-popup");
      let popup;
      for (let i = 0; i < 50 && !popup; i++) { await sleep(100); popup = (await b.pageTargets()).find(t => !before.has(t.targetId) && t.url.includes("OrteView")); }
      if (!popup) throw new Error("popup not opened");
      const s = await b.attach(popup.targetId); const pp = { targetId: popup.targetId, sessionId: s };
      await b.cdp.send("Runtime.enable", {}, s);
      await sleep(1500);
      await b.click(pp, "#viewer-dl"); return p;
    }, expect: has(T1) },
  { name: "kci-js-delayed-navigation", run: async b => { const p = await b.newPage(KCI("ART1")); await sleep(700); await b.click(p, "#dl-js"); return p; }, expect: has(T1) },
  { name: "kci-hidden-iframe", run: async b => { const p = await b.newPage(KCI("ART1")); await sleep(700); await b.click(p, "#dl-iframe"); return p; }, expect: has(T1) },
  { name: "kci-blob-download", run: async b => { const p = await b.newPage(KCI("ART1")); await sleep(700); await b.click(p, "#dl-blob"); return p; }, expect: has(T1) },
  { name: "kci-form-post", run: async b => { const p = await b.newPage(KCI("ART1")); await sleep(700); await b.click(p, "#dl-form"); return p; }, expect: has(T1) },
  { name: "kci-direct-pdf-url-typed", run: async b => {
      const p = await b.newPage(KCI("ART1")); await sleep(1500);
      await b.goto(p, "https://www.kci.go.kr/kciportal/ci/sereArticleSearch/ciSereArtiOrteDown.kci?sereArticleSearchBean.artiId=ART1"); return p;
    }, expect: has(T1) },
  { name: "kci-two-tabs-download-from-background-one", run: async b => {
      const p1 = await b.newPage(KCI("ART1")); await sleep(700);
      const p2 = await b.newPage(KCI("ART2")); await sleep(700);
      await b.click(p1, "#dl-same"); return p1;
    }, expect: has(T1) },
  { name: "kci-two-tabs-download-second", run: async b => {
      const p1 = await b.newPage(KCI("ART1")); await sleep(700);
      const p2 = await b.newPage(KCI("ART2")); await sleep(700);
      await b.click(p2, "#dl-same"); return p2;
    }, expect: has(T2) },
  { name: "kci-navigate-between-papers-same-tab", run: async b => {
      const p = await b.newPage(KCI("ART1")); await sleep(700);
      await b.click(p, "#nav-other"); await sleep(1500);
      await b.click(p, "#dl-same"); return p;
    }, expect: has(T2) },
  { name: "kci-worker-asleep-before-click", run: async b => {
      const p = await b.newPage(KCI("ART1")); await sleep(1500);
      await b.stopWorkers(); await sleep(300);
      await b.click(p, "#dl-same"); return p;
    }, expect: has(T1) },
  { name: "kci-worker-asleep-immediate-click", run: async b => {
      await b.stopWorkers();
      const p = await b.newPage(KCI("ART1"));
      await b.stopWorkers();
      await b.click(p, "#dl-same"); return p;
    }, expect: has(T1) },
  { name: "riss-search-list-row1", run: async b => { const p = await b.newPage("https://www.riss.kr/search/Search.do?query=x"); await sleep(700); await b.click(p, "#riss-dl-0"); return p; }, expect: has(T1) },
  { name: "riss-search-list-row2", run: async b => { const p = await b.newPage("https://www.riss.kr/search/Search.do?query=x"); await sleep(700); await b.click(p, "#riss-dl-1"); return p; }, expect: has(T2) },
  { name: "riss-school-proxy-row2", run: async b => { const p = await b.newPage("https://www-riss-kr-ssl.openlib.uos.ac.kr/search/Search.do?query=x"); await sleep(700); await b.click(p, "#riss-dl-1"); return p; }, expect: has(T2) },
  { name: "unknown-journal-with-citation-meta", run: async b => { const p = await b.newPage("https://journal.example.org/article/ART2"); await sleep(1500); await b.click(p, "#j-dl"); return p; }, expect: has(T2) },
  { name: "nrich-report", run: async b => { const p = await b.newPage("https://portal.nrich.go.kr/kor/originalUsrView.do?menuIdx=1046"); await sleep(1500); await b.click(p, "#nrich-dl"); return p; }, expect: name => name.includes("경주 월성 발굴조사 보고서") && !name.startsWith("download") },
  { name: "nrich-report-worker-asleep", run: async b => { const p = await b.newPage("https://portal.nrich.go.kr/kor/originalUsrView.do?menuIdx=1046"); await sleep(1500); await b.stopWorkers(); await b.click(p, "#nrich-dl"); return p; }, expect: name => name.includes("경주 월성 발굴조사 보고서") && !name.startsWith("download") },
  { name: "heritage-report", run: async b => { const p = await b.newPage("https://www.heritage.go.kr/heri/cul/culSelectDetail.do"); await sleep(1500); await b.click(p, "#heri-dl"); return p; }, expect: name => name.includes("경주 월성") && name.includes("2021") },
  { name: "riss-detail-provider-popup-download", run: async b => {
      const p = await b.newPage(RISS("ART2")); await sleep(6000);
      const pp = await clickOpensPage(b, p, "#riss-provider", "pdfView.do"); await sleep(1500);
      await b.click(pp, "#dbpia-viewer-dl"); return p;
    }, expect: has(T2) },
  { name: "riss-detail-direct-download", run: async b => { const p = await b.newPage(RISS("ART1")); await sleep(1000); await b.click(p, "#riss-detail-dl"); return p; }, expect: has(T1) },
  { name: "riss-detail-provider-popup-worker-asleep", run: async b => {
      const p = await b.newPage(RISS("ART1")); await sleep(1500);
      const pp = await clickOpensPage(b, p, "#riss-provider", "pdfView.do"); await sleep(1500);
      await b.stopWorkers(); await sleep(300);
      await b.click(pp, "#dbpia-viewer-dl"); return p;
    }, expect: has(T1) },
  { name: "path-wrapper-proxy-kci", run: async b => {
      const p = await b.newPage("https://libproxy.univ.ac.kr/_Lib_Proxy_Url/https://www.kci.go.kr/kciportal/ci/sereArticleSearch/ciSereArtiView.kci?sereArticleSearchBean.artiId=ART2");
      await sleep(1000); await b.click(p, "#dl-same"); return p;
    }, expect: has(T2) },
  { name: "opaque-proxy-riss-detail", run: async b => {
      const p = await b.newPage("https://lib.opaque-univ.ac.kr/search/detail/DetailView.do?control_no=ART2"); await sleep(1500);
      await b.click(p, "#riss-detail-dl"); return p;
    }, expect: has(T2) },
  { name: "google-scholar-pdf-link", run: async b => {
      const p = await b.newPage("https://scholar.google.co.kr/scholar?q=x"); await sleep(1000);
      await b.click(p, "#gs-pdf-1"); return p;
    }, expect: has(T2) },
  { name: "same-tab-wandered-to-blog", run: async b => {
      const p = await b.newPage(KCI("ART1")); await sleep(1500);
      await b.goto(p, "https://www.example-blog.com/post"); await sleep(700);
      await b.click(p, "#blog-dl"); return p;
    }, expect: eq("manual.pdf") },
  { name: "child-tab-wandered-to-blog", run: async b => {
      const p = await b.newPage(RISS("ART1")); await sleep(1500);
      const c = await clickOpensPage(b, p, "#riss-wander", "example-blog"); await sleep(1000);
      await b.click(c, "#blog-dl"); return p;
    }, expect: eq("manual.pdf") },
  { name: "heritage-tab-open-then-kci-download", run: async b => {
      await b.newPage("https://portal.nrich.go.kr/kor/originalUsrView.do?menuIdx=1046"); await sleep(1500);
      const p = await b.newPage(KCI("ART1")); await sleep(1000); await b.click(p, "#dl-same"); return p;
    }, expect: has(T1) },
  { name: "kci-tab-open-then-heritage-download", run: async b => {
      await b.newPage(KCI("ART1")); await sleep(1000);
      const p = await b.newPage("https://portal.nrich.go.kr/kor/originalUsrView.do?menuIdx=1046"); await sleep(1500); await b.click(p, "#nrich-dl"); return p;
    }, expect: name => name.includes("경주 월성 발굴조사 보고서") && !name.startsWith("download") },
  { name: "riss-popup-to-unknown-viewer-host", run: async b => {
      const p = await b.newPage(RISS("ART2")); await sleep(5000);
      const pp = await clickOpensPage(b, p, "#riss-ext-viewer", "viewer.publisher.example"); await sleep(1500);
      await b.click(pp, "#ext-viewer-dl"); return p;
    }, expect: has(T2) },
  { name: "kci-no-referrer-navigation-to-cdn", run: async b => {
      const p = await b.newPage(KCI("ART2")); await sleep(1500); await b.click(p, "#dl-cdn-noref"); return p;
    }, expect: has(T2) },
  { name: "unrelated-blog-untouched", run: async b => { const p = await b.newPage("https://www.example-blog.com/post"); await sleep(700); await b.click(p, "#blog-dl"); return p; }, expect: eq("manual.pdf") },
  { name: "unrelated-after-paper-tab-open", run: async b => {
      await b.newPage(KCI("ART1")); await sleep(1000);
      const p = await b.newPage("https://www.example-blog.com/post"); await sleep(700); await b.click(p, "#blog-dl"); return p;
    }, expect: eq("manual.pdf") }
];

async function waitForDownload(dir, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const files = fs.readdirSync(dir).filter(f => !f.endsWith(".crdownload") && !f.startsWith("."));
    if (files.length) { await new Promise(r => setTimeout(r, 300)); return fs.readdirSync(dir).filter(f => !f.endsWith(".crdownload") && !f.startsWith(".")); }
    await new Promise(r => setTimeout(r, 100));
  }
  return fs.readdirSync(dir);
}

async function main() {
  await new Promise(r => server.listen(require("./harness.js").PORT, r));
  const exts = SOLO === "paper" ? [PAPER] : SOLO === "report" ? [REPORT] : ORDER === "paper-first" ? [PAPER, REPORT] : [REPORT, PAPER];
  const results = [];
  const scenarios = SCENARIOS.filter(s => !ONLY || s.name.includes(ONLY))
    .filter(s => !SOLO || (SOLO === "paper" ? !/nrich|heritage/.test(s.name) : /nrich|heritage|unrelated/.test(s.name)));
  for (let rep = 0; rep < REPEAT; rep++) {
    for (const sc of scenarios) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-dl-"));
      const b = await launch({ extensions: exts, downloadDir: dir });
      let name = "", ok = false, err = "";
      try {
        await sleep(500);
        if (DISCOVER && !SOLO) {
          const warm = await b.newPage("https://portal.nrich.go.kr/kor/originalUsrView.do?menuIdx=1046");
          await sleep(1500); await b.closePage(warm); await sleep(300);
          // 워밍업 페이지가 남긴 보고서 정보는 지우지 않는다(실제 사용과 같게).
        }
        await sc.run(b);
        const t0 = Date.now(); const files = await waitForDownload(dir, 15000); const took = Date.now() - t0;
        name = files.join(" | ") + `  [${took}ms]`;
        ok = files.length === 1 && sc.expect(files[0]);
        if (!files.length) {
          // 진단: 크롬이 다운로드를 시작했는지, 어디서 멈췄는지 본다.
          try {
            const sw = (await b.targets()).find(t => t.type === "service_worker");
            const items = sw ? await b.evalIn(sw.targetId, "new Promise(r => chrome.downloads.search({}, r))") : "no worker";
            err += " downloads=" + JSON.stringify(items && items.map ? items.map(i => ({ s: i.state, f: i.filename, e: i.error, u: (i.url || "").slice(0, 60) })) : items);
            const pages = (await b.pageTargets()).map(t => t.url.slice(0, 80));
            err += " pages=" + JSON.stringify(pages);
          } catch (e2) { err += " diag-failed " + e2.message; }
        }
      } catch (e) { err = e.message; }
      await b.close();
      fs.rmSync(dir, { recursive: true, force: true });
      results.push({ sc: sc.name, ok, name, err });
      console.log(`${ok ? "PASS" : "FAIL"}  ${sc.name.padEnd(42)} ${name || "(no file)"} ${err}`);
    }
  }
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed (${ORDER}${SOLO ? ", solo " + SOLO : ""})`);
  server.close();
  process.exit(failed ? 1 : 0);
}
main();
