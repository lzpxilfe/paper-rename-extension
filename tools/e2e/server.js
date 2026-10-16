// Fake academic / heritage / unrelated sites, dispatched by Host header.
// Chromium maps the real hostnames to 127.0.0.1 with --host-resolver-rules.
const http = require("node:https");
const fs = require("node:fs");
const { URL } = require("node:url");

const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

function page(title, head, body) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${title}</title>${head || ""}</head><body>${body}</body></html>`;
}

function meta(m) {
  const tags = [];
  if (m.title) tags.push(`<meta name="citation_title" content="${m.title}">`);
  for (const a of m.authors || []) tags.push(`<meta name="citation_author" content="${a}">`);
  if (m.journal) tags.push(`<meta name="citation_journal_title" content="${m.journal}">`);
  if (m.date) tags.push(`<meta name="citation_publication_date" content="${m.date}">`);
  if (m.volume) tags.push(`<meta name="citation_volume" content="${m.volume}">`);
  if (m.issue) tags.push(`<meta name="citation_issue" content="${m.issue}">`);
  if (m.first) tags.push(`<meta name="citation_firstpage" content="${m.first}">`);
  if (m.last) tags.push(`<meta name="citation_lastpage" content="${m.last}">`);
  if (m.publisher) tags.push(`<meta name="citation_publisher" content="${m.publisher}">`);
  if (m.pdf) tags.push(`<meta name="citation_pdf_url" content="${m.pdf}">`);
  return tags.join("");
}

const PAPERS = {
  ART1: { title: "백제 한성기 토기의 편년", authors: ["김철수"], journal: "백제학보", date: "2024/06", volume: "", issue: "48", first: "1", last: "30", publisher: "백제학회" },
  ART2: { title: "고구려 산성의 축조 기법", authors: ["이영희", "박민수"], journal: "고구려발해연구", date: "2023", volume: "", issue: "75", first: "55", last: "90", publisher: "고구려발해학회" }
};

function kciDetail(id, url) {
  const p = PAPERS[id];
  const dl = `/kciportal/ci/sereArticleSearch/ciSereArtiOrteDown.kci?sereArticleSearchBean.artiId=${id}`;
  return page(`${p.title} | KCI`, meta(Object.assign({}, p, { pdf: "https://www.kci.go.kr" + dl })) + '<meta name="referrer" content="no-referrer">', `
    <h1>${p.title}</h1>
    <div class="author">${p.authors.join(", ")}</div>
    <a id="dl-same" href="${dl}">원문 다운로드</a>
    <a id="dl-blank" href="${dl}" target="_blank">원문 다운로드(새창)</a>
    <a id="dl-popup" href="javascript:;" onclick="window.open('/kciportal/ci/sereArticleSearch/ciSereArtiOrteView.kci?sereArticleSearchBean.artiId=${id}','','width=800,height=600')">KCI 원문 미리보기</a>
    <button id="dl-js" onclick="setTimeout(function(){location.href='${dl}'},400)">PDF 다운로드</button>
    <button id="dl-iframe" onclick="var f=document.createElement('iframe');f.style.display='none';f.src='${dl}&via=iframe';document.body.appendChild(f)">원문 저장</button>
    <button id="dl-blob" onclick="blobDown()">PDF 받기</button>
    <script>function blobDown(){fetch('${dl}').then(function(r){return r.blob()}).then(function(b){var a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='${id}.pdf';document.body.appendChild(a);a.click();window.__blobDone=a.href;}).catch(function(e){window.__blobErr=String(e)})}</script>
    <form id="f" method="post" action="/kciportal/ci/sereArticleSearch/ciSereArtiOrteDown.kci"><input type="hidden" name="artiId" value="${id}"><button id="dl-form" type="submit">원문 다운로드(POST)</button></form>
    <button id="dl-cdn-noref" onclick="location.href='https://cdn.files.example/blob/7f3a9c'">원문(외부 저장소)</button>
    <a id="nav-other" href="/kciportal/ci/sereArticleSearch/ciSereArtiView.kci?sereArticleSearchBean.artiId=${id === "ART1" ? "ART2" : "ART1"}">다른 논문</a>
  `);
}

function kciViewer(id) {
  const dl = `/kciportal/ci/sereArticleSearch/ciSereArtiOrteDown.kci?sereArticleSearchBean.artiId=${id}`;
  return page("한국학술지인용색인", "", `<div id="viewer"><a id="viewer-dl" href="${dl}">다운로드</a></div>`);
}

function rissList() {
  const rows = Object.entries(PAPERS).map(([id, p], i) => `
    <li class="item">
      <div class="cont">
        <p class="title"><a href="/link?id=${id}">${p.title}</a></p>
        <p class="etc"><span class="writer">${p.authors.join(";")}</span> <span class="assigned">${p.publisher}</span> <span>${p.journal}</span> <span>${p.date.slice(0, 4)}</span></p>
        <a id="riss-dl-${i}" class="btnDown" href="/search/download/FullTextDownload.do?control_no=${id}">원문보기 PDF 다운로드</a>
      </div>
    </li>`).join("");
  return page("RISS 검색 - 학술논문", "", `<div class="srchResultListW"><ul>${rows}</ul></div>`);
}

function journalSite(id) {
  const p = PAPERS[id];
  return page(p.title, meta(p), `<h1>${p.title}</h1><a id="j-dl" href="/files/${id}.pdf?download=1">Download PDF</a>`);
}

function nrichDetail() {
  return page("국가유산 지식이음", "", `
<main id="contents">
  <h3>경주 월성 발굴조사 보고서 - C지구 가구역</h3>
  <dl><dt>발행년도</dt><dd>2025 년</dd><dt>저작권자</dt><dd>국립경주문화유산연구소</dd></dl>
  <div class="detail_list1"><ul><li>
    <a href="javascript:void(0);" title="선택 시 [경주 월성 발굴조사 보고서 - C지구 가구역.pdf] PDF 원본을 새창으로 보실 수 있습니다."><span>경주 월성 발굴조사 보고서 - C지구 가구역.pdf</span></a>
    <button id="nrich-dl" class="Btn Btn1" onclick="fnOriFileDownload('/kor/includeFileDownLoad.do', '714686', '1046', '');">다운로드</button>
  </li></ul></div>
</main>
<script>function fnOriFileDownload(u,a,b){location.href=u+'?fileIdx='+a+'&menuIdx='+b;}</script>`);
}

function heritageDetail() {
  return page("국가유산포털", "", `
<main id="contents">
  <h1>국가유산 간행물</h1>
  <h2>경주 월성 시·발굴 조사 보고서</h2>
  <ul><li>발행년도 2021</li><li>첨부파일
    <a id="heri-dl" href="/NEW_PDF/report1.pdf" title="다운로드(새창)" data-url="/NEW_PDF/report1.pdf" data-filename="경주 월성 시ㆍ발굴조사보고서 1권(시굴조사).pdf">다운로드</a>
  </li></ul>
</main>`);
}


function rissDetail(id, base) {
  const p = PAPERS[id];
  return page("RISS 상세보기", "", `
  <section id="thesisInfoDiv">
    <h3 class="title">${p.title}</h3>
    <div class="infoDetailL"><ul>
      <li><span class="strong">저자</span> ${p.authors.join("; ")}</li>
      <li><span class="strong">발행기관</span> ${p.publisher}</li>
      <li><span class="strong">학술지명</span> ${p.journal}</li>
      <li><span class="strong">권호사항</span> Vol.${p.volume || "0"} No.${p.issue}</li>
      <li><span class="strong">발행연도</span> ${p.date.slice(0, 4)}</li>
      <li><span class="strong">수록면</span> ${p.first}-${p.last}</li>
    </ul></div>
  </section>
  <a id="riss-provider" href="javascript:void(0)" onclick="window.open('https://www.dbpia.co.kr/pdf/pdfView.do?nodeId=NODE${id.slice(3)}','orgView','width=900,height=700')">원문보기</a>
  <a id="riss-detail-dl" href="${base || ""}/search/download/FullTextDownload.do?control_no=${id}">원문 PDF 다운로드</a>
  <a id="riss-wander" href="https://www.example-blog.com/post" target="_blank">관련 블로그</a>
  <a id="riss-ext-viewer" href="javascript:void(0)" onclick="window.open('https://viewer.publisher.example/view?doc=${id}','extView','width=900,height=700')">외부 원문보기</a>`);
}

function dbpiaViewer(node) {
  return page("DBpia", "", `<div class="viewer"><a id="dbpia-viewer-dl" href="/pdf/download.do?nodeId=${node}">다운로드</a></div>`);
}

function scholarList() {
  const rows = Object.entries(PAPERS).map(([id, p], i) => `
  <div class="gs_r gs_or gs_scl">
    <div class="gs_ggs gs_fl"><div class="gs_ggsd"><div class="gs_or_ggsm"><a id="gs-pdf-${i}" href="https://journal.example.org/files/${id}.pdf"><span class="gs_ctg2">[PDF]</span> journal.example.org</a></div></div></div>
    <div class="gs_ri"><h3 class="gs_rt"><a href="https://journal.example.org/article/${id}">${p.title}</a></h3>
    <div class="gs_a">${p.authors.join(", ")} - ${p.journal}, ${p.date.slice(0, 4)} - journal.example.org</div>
    <div class="gs_rs">초록 일부...</div></div>
  </div>`).join("");
  return page("Google 학술 검색", "", `<div id="gs_res_ccl_mid">${rows}</div>`);
}

function sendPdf(res, name) {
  res.writeHead(200, {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${encodeURIComponent(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    "Content-Length": PDF.length
  });
  res.end(PDF);
}

function sendHtml(res, html) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

const server = http.createServer(require("./harness.js").tlsOptions(), (req, res) => {
  const host = (req.headers.host || "").split(":")[0];
  const url = new URL(req.url, `https://${host}`);
  const path = url.pathname;
  const id = url.searchParams.get("sereArticleSearchBean.artiId") || url.searchParams.get("control_no") || "ART1";
  if (/kci\.go\.kr$/.test(host)) {
    if (path.endsWith("ciSereArtiView.kci")) return sendHtml(res, kciDetail(id));
    if (path.endsWith("ciSereArtiOrteView.kci")) return sendHtml(res, kciViewer(id));
    if (path.endsWith("ciSereArtiOrteDown.kci")) {
      if (req.method === "POST") {
        let body = ""; req.on("data", c => body += c); req.on("end", () => sendPdf(res, `${new URLSearchParams(body).get("artiId")}.pdf`));
        return;
      }
      return sendPdf(res, `${id}.pdf`);
    }
  }
  if (/dbpia\.co\.kr$/.test(host)) {
    if (path.startsWith("/pdf/pdfView.do")) return sendHtml(res, dbpiaViewer(url.searchParams.get("nodeId")));
    if (path.startsWith("/pdf/download.do")) return sendPdf(res, `${url.searchParams.get("nodeId")}.pdf`);
  }
  if (host === "scholar.google.co.kr") return sendHtml(res, scholarList());
  if (host === "viewer.publisher.example") {
    if (path === "/view") return sendHtml(res, page("Document Viewer", "", `<div><a id="ext-viewer-dl" href="/files/doc.pdf">Download</a></div>`));
    if (path.startsWith("/files/")) return sendPdf(res, "doc.pdf");
  }
  if (host === "cdn.files.example") return sendPdf(res, "7f3a9c.pdf");
  if (host === "libproxy.univ.ac.kr") {
    // 경로 감싸기형 프록시: /_Lib_Proxy_Url/https://www.kci.go.kr/...
    const inner = req.url.replace(/^\/_Lib_Proxy_Url\//, "");
    if (inner !== req.url) {
      const target = new URL(inner);
      if (target.pathname.endsWith("ciSereArtiView.kci")) return sendHtml(res, kciDetail(target.searchParams.get("sereArticleSearchBean.artiId") || "ART1"));
    }
    if (path.endsWith("ciSereArtiOrteDown.kci")) return sendPdf(res, `${id}.pdf`);
  }
  if (host === "lib.opaque-univ.ac.kr") {
    // 원래 호스트를 전혀 남기지 않는 프록시
    const cid = url.searchParams.get("control_no") || "ART1";
    if (path.startsWith("/search/detail/DetailView.do")) return sendHtml(res, rissDetail(cid));
    if (path.includes("FullTextDownload")) return sendPdf(res, "FullText.pdf");
  }
  if (/riss\.kr|riss-kr/.test(host)) {
    if (path.startsWith("/search/detail/DetailView.do")) return sendHtml(res, rissDetail(url.searchParams.get("control_no") || "ART1"));
    if (path.startsWith("/search/Search")) return sendHtml(res, rissList());
    if (path.includes("FullTextDownload")) return sendPdf(res, "FullText.pdf");
  }
  if (host === "journal.example.org") {
    const m = path.match(/\/article\/(ART\d)/);
    if (m) return sendHtml(res, journalSite(m[1]));
    if (path.startsWith("/files/")) return sendPdf(res, path.split("/").pop());
  }
  if (/nrich\.go\.kr$/.test(host)) {
    if (path.startsWith("/kor/includeFileDownLoad.do")) return sendPdf(res, "download.pdf");
    return sendHtml(res, nrichDetail());
  }
  if (/heritage\.go\.kr$/.test(host)) {
    if (path.startsWith("/NEW_PDF/")) return sendPdf(res, "경주 월성 시ㆍ발굴조사보고서 1권(시굴조사).pdf");
    return sendHtml(res, heritageDetail());
  }
  if (host === "www.example-blog.com") {
    if (path.endsWith(".pdf")) return sendPdf(res, "manual.pdf");
    return sendHtml(res, page("Blog", "", `<a id="blog-dl" href="/manual.pdf">Download PDF</a>`));
  }
  res.writeHead(404); res.end("nf");
});

module.exports = { server, PAPERS };
