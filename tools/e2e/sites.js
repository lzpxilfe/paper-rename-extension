// 지원 학술 사이트 전체 × (직접 접속 / 학교 프록시 호스트 인코딩 / 경로 감싸기 프록시) E2E.
// node sites.js [--paper DIR] [--report DIR] [--order paper-first|report-first] [--only key]
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const https = require("node:https");
const { launch, sleep } = require("./harness.js");

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const PAPER = path.resolve(arg("--paper", path.join(__dirname, "../..")));
const REPORT = path.resolve(arg("--report", path.join(__dirname, "../../../archreport")));
const ORDER = arg("--order", "paper-first");
const ONLY = arg("--only", "");
const metadata = require(path.join(PAPER, "src/metadata.js"));

const SITES = [
  ["riss", "www.riss.kr", "/search/detail/DetailView.do?p_mat_type=1a0202e37d52c72d&control_no=abc"],
  ["kci", "www.kci.go.kr", "/kciportal/ci/sereArticleSearch/ciSereArtiView.kci?sereArticleSearchBean.artiId=ART00001"],
  ["kiss", "kiss.kstudy.com", "/Detail/Ar?key=3912345"],
  ["dbpia", "www.dbpia.co.kr", "/journal/articleDetail?nodeId=NODE11111111"],
  ["earticle", "www.earticle.net", "/Article/A412345"],
  ["scholar", "scholar.kyobobook.co.kr", "/article/detail/4010012345"],
  ["koreascience", "www.koreascience.kr", "/article/JAKO202412345678.page"],
  ["scienceon", "scienceon.kisti.re.kr", "/srch/selectPORSrchArticle.do?cn=JAKO202412345678"],
  ["krm", "www.krm.or.kr", "/krmts/search/detailview/research.html?dbGubun=SD&m201_id=10012345"],
  ["nanet", "dl.nanet.go.kr", "/detail/KDMT1202112345"],
  ["nl", "www.nl.go.kr", "/NL/contents/search.do?resultType=detail&cn=KINX2021123"],
  ["seoul", "history.seoul.go.kr", "/archive/bbsctt/view.do?bbscttSn=2212200487"],
  ["dcollection", "scholar.dcollection.net", "/srch/srchDetail/200000611177"]
];

// 학교 프록시 호스트 인코딩(서울시립대 openlib 형식): www.riss.kr -> www-riss-kr-ssl.openlib.uos.ac.kr
const encodeProxyHost = host => `${host.replace(/\./g, "-")}-ssl.openlib.uos.ac.kr`;
const PDF = Buffer.from("%PDF-1.4\n%%EOF\n");

function siteForHost(host) {
  const plain = host.endsWith(".openlib.uos.ac.kr")
    ? host.replace(/\.openlib\.uos\.ac\.kr$/, "").replace(/-ssl$/, "").replace(/-/g, ".")
    : host;
  return SITES.find(([, h]) => h === plain);
}

const server = https.createServer(require("./harness.js").tlsOptions(), (req, res) => {
  const host = (req.headers.host || "").split(":")[0];
  let reqPath = req.url;
  let site = siteForHost(host);
  if (host === "libproxy.univ.ac.kr" && reqPath.startsWith("/_Lib_Proxy_Url/")) {
    const inner = new URL(reqPath.slice("/_Lib_Proxy_Url/".length));
    site = siteForHost(inner.hostname);
    reqPath = inner.pathname + inner.search;
  }
  if (reqPath.startsWith("/download/") || reqPath.startsWith("/_Lib_Proxy_Url/download")) {
    res.writeHead(200, { "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="download.pdf"' });
    return res.end(PDF);
  }
  if (!site) { res.writeHead(404); return res.end(); }
  const html = fs.readFileSync(path.join(__dirname, "fixtures", `${site[0]}.html`), "utf8")
    .replace(/<\/body>/i, '<p><a id="site-dl" href="/download/file.do?no=1">원문 PDF 다운로드</a></p></body>');
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
});

async function waitForFile(dir, ms) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const files = fs.readdirSync(dir).filter(f => !f.endsWith(".crdownload") && !f.startsWith("."));
    if (files.length) return files;
    await sleep(100);
  }
  return [];
}

async function main() {
  await new Promise(r => server.listen(require("./harness.js").PORT, r));
  const exts = ORDER === "paper-first" ? [PAPER, REPORT] : [REPORT, PAPER];
  let pass = 0, total = 0;
  for (const [key, host, pagePath] of SITES.filter(s => !ONLY || s[0] === ONLY)) {
    const html = fs.readFileSync(path.join(__dirname, "fixtures", `${key}.html`), "utf8");
    const expected = metadata.parseFixtureHtml(html, `https://${host}${pagePath}`).titleMain;
    for (const [mode, url] of [
      ["direct", `https://${host}${pagePath}`],
      ["proxy-host", `https://${encodeProxyHost(host)}${pagePath}`],
      ["proxy-path", `https://libproxy.univ.ac.kr/_Lib_Proxy_Url/https://${host}${pagePath}`]
    ]) {
      total++;
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-site-"));
      const b = await launch({ extensions: exts, downloadDir: dir, hostRules: `MAP * 127.0.0.1:${require("./harness.js").PORT}` });
      let name = "", err = "";
      try {
        const p = await b.newPage(url); await sleep(1200);
        await b.click(p, "#site-dl");
        name = (await waitForFile(dir, 10000)).join(" | ");
      } catch (e) { err = e.message; }
      await b.close();
      fs.rmSync(dir, { recursive: true, force: true });
      const ok = Boolean(expected) && name.includes(expected) && name.endsWith(".pdf");
      if (ok) pass++;
      console.log(`${ok ? "PASS" : "FAIL"}  ${(key + " " + mode).padEnd(26)} ${name || "(no file)"} ${err} ${ok ? "" : "(expected title: " + expected + ")"}`);
    }
  }
  console.log(`\n${pass}/${total} passed (${ORDER})`);
  server.close();
  process.exit(pass === total ? 0 : 1);
}
main();
