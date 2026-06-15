"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const constants = require("../src/constants.js");
globalThis.PaperRenameConstants = constants;
const citation = require("../src/citation.js");
globalThis.PaperRenameCitation = citation;
const filename = require("../src/filename.js");
globalThis.PaperRenameFilename = filename;
const metadata = require("../src/metadata.js");
const background = require("../src/background.js");

function fixture(name) {
  return fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");
}

function test(name, run) {
  try {
    run();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

const fullMeta = {
  authors: ["김영희", "박철수"],
  titleMain: "근대 문학의 매체성과 독자",
  titleSub: "잡지 문화를 중심으로",
  journalName: "한국문학연구",
  volume: "42",
  issue: "3",
  publisher: "한국문학회",
  year: "2025",
  pageFirst: "15",
  pageLast: "42",
  originalFilename: "article.pdf",
  source: "RISS",
  pageUrl: "https://example.test"
};

test("full citation renders all present fields", () => {
  assert.equal(
    citation.renderFullCitation(fullMeta, filename.safeSettings()),
    "김영희·박철수, 2025, 「근대 문학의 매체성과 독자: 잡지 문화를 중심으로」, 『한국문학연구』 42(3), 한국문학회"
  );
});

test("citation omits pages when includePages is false", () => {
  const settings = filename.safeSettings({ includePages: false });
  assert.equal(
    citation.renderFullCitation(fullMeta, settings),
    "김영희·박철수, 2025, 「근대 문학의 매체성과 독자: 잡지 문화를 중심으로」, 『한국문학연구』 42(3), 한국문학회"
  );
});

test("citation omits empty journal section for thesis-like metadata", () => {
  const thesis = Object.assign({}, fullMeta, {
    journalName: "",
    volume: "",
    issue: "",
    publisher: "서울대학교 대학원",
    pageFirst: "",
    pageLast: ""
  });
  assert.equal(
    citation.renderFullCitation(thesis, filename.safeSettings()),
    "김영희·박철수, 2025, 「근대 문학의 매체성과 독자: 잡지 문화를 중심으로」, 서울대학교 대학원"
  );
});

test("filename sanitizer removes forbidden characters and duplicate extension", () => {
  const actual = filename.renderFilename({
    authors: ["홍길동"],
    titleMain: "홍성 / 홍주읍성: 북문지.pdf",
    journalName: "문화재 <연구>",
    publisher: "A|B 연구소",
    year: "2026",
    originalFilename: "source.pdf"
  }, filename.safeSettings({ includePages: false }));

  assert.equal(actual, "홍길동, 2026, 「홍성 홍주읍성 북문지」, 『문화재 연구』, A B 연구소.pdf");
});

test("custom chip order changes rendered filename", () => {
  const settings = filename.safeSettings({
    includePages: false,
    template: [
      { kind: "field", value: "year" },
      { kind: "separator", value: "underscore" },
      { kind: "field", value: "authors" },
      { kind: "separator", value: "underscore" },
      { kind: "field", value: "title" }
    ]
  });

  assert.equal(
    filename.renderFilename(fullMeta, settings, { filename: "paper.pdf" }),
    "2025_김영희·박철수_「근대 문학의 매체성과 독자 잡지 문화를 중심으로」.pdf"
  );
});

test("max filename length is respected including extension", () => {
  const longTitle = "가".repeat(300);
  const actual = filename.renderFilename({
    titleMain: longTitle,
    originalFilename: "long.pdf"
  }, filename.safeSettings({ maxFilenameLength: 60 }));

  assert.ok(actual.length <= 60);
  assert.ok(actual.endsWith(".pdf"));
});

test("default field list does not include sequence number", () => {
  const fields = filename.DEFAULT_TEMPLATE
    .filter((token) => token.kind === "field")
    .map((token) => token.value);
  assert.ok(!fields.includes("sequenceNumber"));
});

test("default filename matches requested KCI citation filename", () => {
  const actual = filename.renderFilename({
    authors: ["이차원", "Lee ChaWon"],
    titleMain: "백제 한성기 몽촌토성의 성격과 기능",
    journalName: "백제학보",
    issue: "53",
    publisher: "백제학회",
    year: "2025",
    originalFilename: "download.pdf"
  }, filename.safeSettings(), { filename: "download.pdf" });

  assert.equal(actual, "이차원, 2025, 「백제 한성기 몽촌토성의 성격과 기능」, 『백제학보』 53, 백제학회.pdf");
});

test("default filename matches requested RISS thesis filename", () => {
  const actual = filename.renderFilename({
    authors: ["이차원"],
    titleMain: "백제 한성기 몽촌토성의 축조 목적과 기능",
    publisher: "서울시립대학교 국사학과 석사학위논문",
    year: "2025",
    originalFilename: "000000035976_20260615105228"
  }, filename.safeSettings(), { filename: "000000035976_20260615105228" });

  assert.equal(actual, "이차원, 2025, 「백제 한성기 몽촌토성의 축조 목적과 기능」, 서울시립대학교 국사학과 석사학위논문.pdf");
});

test("author cleanup removes romanization and duplicate affiliation numbers", () => {
  assert.deepEqual(metadata.splitAuthors("이차원 Lee ChaWon 1·이차원 Lee ChaWon 1"), ["이차원"]);
});

test("RISS thesis detail facts extract Korean labels and thesis publisher", () => {
  const actual = metadata.parseFixtureHtml(`
    <!doctype html>
    <html lang="ko">
    <head><title>RISS 학위논문</title></head>
    <body>
      <div class="locationW">학위논문</div>
      <section id="thesisInfoDiv">
        <h3 class="title">백제 한성기 몽촌토성의 축조 목적과 기능</h3>
        <div class="infoDetailL">
          <ul>
            <li><span class="strong">저자</span> 이차원</li>
            <li><span class="strong">학위논문사항</span> 서울시립대학교 일반대학원, 국사학과, 국내석사, 2025</li>
            <li><span class="strong">발행년도</span> 2025</li>
          </ul>
        </div>
      </section>
    </body>
    </html>
  `, "https://www.riss.kr/search/detail/DetailView.do?p_mat_type=be54d9b8bc7cdb09");

  assert.deepEqual(actual.authors, ["이차원"]);
  assert.equal(actual.titleMain, "백제 한성기 몽촌토성의 축조 목적과 기능");
  assert.equal(actual.publisher, "서울시립대학교 국사학과 석사학위논문");
  assert.equal(actual.year, "2025");
});

test("RISS search page title is not accepted as paper title", () => {
  const actual = metadata.parseFixtureHtml(`
    <!doctype html>
    <html lang="ko">
    <head><title>RISS 검색 — 통합검색</title></head>
    <body>
      <h1>RISS 검색 — 통합검색</h1>
    </body>
    </html>
  `, "https://www.riss.kr/search/Search.do?query=%EB%AA%BD%EC%B4%8C%ED%86%A0%EC%84%B1");

  assert.equal(actual.titleMain, "");
});

test("background chooses the nearest same-tab context", () => {
  background._state.reset();
  const now = Date.now();
  background.rememberContext({
    metadata: fullMeta,
    downloadUrl: "https://example.test/article.pdf",
    originalFilename: "article.pdf",
    capturedAt: now
  }, { tab: { id: 3 }, frameId: 0 });

  const entry = background.chooseContextEntry({
    tabId: 3,
    url: "https://example.test/article.pdf",
    filename: "article.pdf"
  }, now + 50);

  assert.ok(entry);
  assert.equal(entry.context.metadata.titleMain, fullMeta.titleMain);
});

test("background ignores expired contexts", () => {
  background._state.reset();
  const now = Date.now();
  background.rememberContext({
    metadata: fullMeta,
    downloadUrl: "https://example.test/article.pdf",
    capturedAt: now - constants.CONTEXT_TTL_MS - 1000
  }, { tab: { id: 3 }, frameId: 0 });

  assert.equal(background.chooseContextEntry({ tabId: 3, url: "https://example.test/article.pdf" }, now), null);
});

test("background returns null when no context matches", () => {
  background._state.reset();
  assert.equal(background.chooseContextEntry({ tabId: 1, url: "https://example.test/article.pdf" }), null);
});

test("background accepts one recent context for viewer-mediated downloads", () => {
  background._state.reset();
  const now = Date.now();
  background.rememberContext({
    metadata: fullMeta,
    pageUrl: "https://www.riss.kr/search/Search.do?query=test",
    downloadUrl: "",
    capturedAt: now
  }, { tab: { id: 7 }, frameId: 0 });

  const entry = background.chooseContextEntry({
    tabId: 12,
    url: "https://viewer.example.test/download",
    filename: "download.pdf"
  }, now + 1000);

  assert.ok(entry);
  assert.equal(entry.context.metadata.titleMain, fullMeta.titleMain);
});

test("background ignores blank viewer contexts", () => {
  background._state.reset();
  const now = Date.now();
  background.rememberContext({
    metadata: fullMeta,
    pageUrl: "https://www.riss.kr/search/Search.do?query=test",
    capturedAt: now
  }, { tab: { id: 7 }, frameId: 0 });
  background.rememberContext({
    metadata: metadata.blankMetadata("RISS", "https://viewer.riss.kr"),
    pageUrl: "https://viewer.riss.kr",
    capturedAt: now + 1000
  }, { tab: { id: 9 }, frameId: 0 });

  assert.equal(background._state.pendingContexts.length, 1);
  assert.equal(background._state.pendingContexts[0].context.metadata.titleMain, fullMeta.titleMain);
});

test("KCI DOM metadata uses article title and journalInfo instead of UI text", () => {
  const actual = metadata.parseFixtureHtml(`
    <!doctype html>
    <html lang="ko">
    <body>
      <button class="title">초록 열기 닫기 버튼</button>
      <h3 id="artiTitle">백제 한성기 몽촌토성의 성격과 기능</h3>
      <div class="author"><a>이차원 Lee ChaWon 1</a></div>
      <div class="author"><a>이차원 Lee ChaWon 1</a></div>
      <div class="journalInfo">
        <span class="jounal"><a>백제학보</a></span>
        <span class="vol">2025, vol., no.53, pp. 5-60</span>
        <span class="pub"><a>백제학회</a></span>
      </div>
    </body>
    </html>
  `, "https://www.kci.go.kr/kciportal/ci/sereArticleSearch/ciSereArtiView.kci?sereArticleSearchBean.artiId=ART003238959");

  assert.deepEqual(actual.authors, ["이차원"]);
  assert.equal(actual.titleMain, "백제 한성기 몽촌토성의 성격과 기능");
  assert.equal(actual.journalName, "백제학보");
  assert.equal(actual.issue, "53");
  assert.equal(actual.publisher, "백제학회");
  assert.equal(actual.year, "2025");
});

test("KCI realistic page prefers citation metadata over UI button text", () => {
  const actual = metadata.parseFixtureHtml(
    fixture("kci-realistic.html"),
    "https://www.kci.go.kr/kciportal/ci/sereArticleSearch/ciSereArtiView.kci?sereArticleSearchBean.artiId=ART003238959"
  );

  assert.deepEqual(actual.authors, ["이차원"]);
  assert.equal(actual.titleMain, "백제 한성기 몽촌토성의 성격과 기능");
  assert.equal(actual.journalName, "백제학보");
  assert.equal(actual.issue, "53");
  assert.equal(actual.pageFirst, "5");
  assert.equal(actual.pageLast, "60");
});

test("RISS search result text yields thesis metadata for original-view clicks", () => {
  const actual = metadata.parseResultText(`
    학위논문 1
    백제 한성기 몽촌토성의 축조 목적과 기능
    이차원 | 서울시립대학교 일반대학원 | 2025 | 국내석사
    원문보기 목차검색조회 음성듣기
  `, "RISS", "https://www.riss.kr/search/Search.do?query=몽촌토성");

  assert.deepEqual(actual.authors, ["이차원"]);
  assert.equal(actual.titleMain, "백제 한성기 몽촌토성의 축조 목적과 기능");
  assert.equal(actual.publisher, "서울시립대학교 일반대학원");
  assert.equal(actual.year, "2025");
});

const fixtureCases = [
  ["riss.html", "https://www.riss.kr/search/detail/DetailView.do?p_mat_type=1", "RISS", "근대 문학의 매체성과 독자", "한국문학연구", "2025"],
  ["kci.html", "https://www.kci.go.kr/kciportal/ci/sereArticleSearch/ciSereArtiView.kci", "KCI", "한국 고전 서사의 공간 연구", "고전문학과 해석", "2024"],
  ["kci-realistic.html", "https://www.kci.go.kr/kciportal/ci/sereArticleSearch/ciSereArtiView.kci?sereArticleSearchBean.artiId=ART003238959", "KCI", "백제 한성기 몽촌토성의 성격과 기능", "백제학보", "2025"],
  ["kiss.html", "https://kiss.kstudy.com/Detail/Ar?key=1", "KISS", "일제강점기 잡지 번역의 양상", "현대문학사", "2023"],
  ["dbpia.html", "https://www.dbpia.com/journal/articleDetail?nodeId=1", "DBpia", "문학장과 출판 네트워크", "인문학연구", "2022"],
  ["earticle.html", "https://www.earticle.net/Article/A1", "eArticle", "근대 독서 문화의 형성", "독서문화연구", "2021"],
  ["scholar.html", "https://scholar.kyobobook.co.kr/article/detail/1", "교보 스콜라", "서사 구조와 기억의 정치", "문화와 서사", "2020"],
  ["scholar.html", "https://scholar-kyobobook-co-kr-ssl.openlib.uos.ac.kr/article/detail/1", "교보 스콜라", "서사 구조와 기억의 정치", "문화와 서사", "2020"],
  ["koreascience.html", "https://www.koreascience.or.kr/article/JAKO202400000000001.page", "KoreaScience", "과학기술 지식정보 활용 연구", "정보관리학회지", "2024"],
  ["scienceon.html", "https://scienceon.kisti.re.kr/srch/selectPORSrchArticle.do?cn=ART002255251", "ScienceON", "데이터 기반 연구성과 분석", "한국데이터정보과학회지", "2023"],
  ["krm.html", "https://www.krm.or.kr/krmts/search/detailView.html?category=ResearchPaper&dbGubun=SD&local_id=10061537", "KRM", "지역 문화 연구의 자료화 방안", "인문사회연구", "2022"]
];

fixtureCases.forEach(([file, url, source, title, journal, year]) => {
  test(`${source} fixture extracts key metadata`, () => {
    const actual = metadata.parseFixtureHtml(fixture(file), url);
    assert.equal(actual.source, source);
    assert.equal(actual.titleMain, title);
    assert.equal(actual.journalName, journal);
    assert.equal(actual.year, year);
    assert.ok(actual.authors.length >= 1);
  });
});
