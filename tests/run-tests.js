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
    "김영희·박철수, 「근대 문학의 매체성과 독자 — 잡지 문화를 중심으로」, 『한국문학연구』 42(3), 한국문학회, 2025, 15–42쪽"
  );
});

test("citation omits pages when includePages is false", () => {
  const settings = filename.safeSettings({ includePages: false });
  assert.equal(
    citation.renderFullCitation(fullMeta, settings),
    "김영희·박철수, 「근대 문학의 매체성과 독자 — 잡지 문화를 중심으로」, 『한국문학연구』 42(3), 한국문학회, 2025"
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
    "김영희·박철수, 「근대 문학의 매체성과 독자 — 잡지 문화를 중심으로」, 서울대학교 대학원, 2025"
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

  assert.equal(actual, "홍길동, 「홍성 홍주읍성 북문지」, 『문화재 연구』, A B 연구소, 2026.pdf");
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
    "2025_김영희·박철수_「근대 문학의 매체성과 독자 — 잡지 문화를 중심으로」.pdf"
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

const fixtureCases = [
  ["riss.html", "https://www.riss.kr/search/detail/DetailView.do?p_mat_type=1", "RISS", "근대 문학의 매체성과 독자", "한국문학연구", "2025"],
  ["kci.html", "https://www.kci.go.kr/kciportal/ci/sereArticleSearch/ciSereArtiView.kci", "KCI", "한국 고전 서사의 공간 연구", "고전문학과 해석", "2024"],
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
