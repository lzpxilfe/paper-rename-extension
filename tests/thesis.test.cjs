const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseHTML } = require('linkedom');
const citation = require('../src/citation.js');
const filename = require('../src/filename.js');
const metadata = require('../src/metadata.js');

const notice = '원하는 DB만 선택하여 검색하실 수 있습니다.';
const contaminated = {
  authors: ['홍길동'], year: '2025', titleMain: '학위논문 제목',
  journalName: notice, volume: '12', issue: '3',
  publisher: '한국대학교 석사학위논문'
};

test('cached thesis metadata omits journal and issue in filename and copied citation', () => {
  const expected = '홍길동, 2025, 『학위논문 제목』, 한국대학교 석사학위논문';
  assert.equal(filename.renderFilename(contaminated, filename.safeSettings(), { filename: 'thesis.pdf' }), expected + '.pdf');
  assert.equal(citation.renderFullCitation(contaminated, filename.safeSettings()), expected);
  assert.equal(contaminated.journalName, notice, 'rendering must not mutate cached input');
});

for (const degree of ['석사', '박사']) test(`structured ${degree} metadata is a thesis without a degree in publisher`, () => {
  const data = { ...contaminated, publisher: '한국대학교', thesisInstitution: '한국대학교', thesisDegree: degree };
  assert.equal(citation.journalText(data), '');
  assert.equal(citation.volumeIssueText(data), '');
  assert.equal(citation.titleText(data, { thesisTitleBracketMode: 'single' }), '「학위논문 제목」');
  const normalized = metadata.normalizeMetadata(data);
  assert.equal(normalized.journalName, '');
  assert.equal(normalized.volume, '');
  assert.equal(normalized.issue, '');
});

test('custom filename templates cannot reintroduce the thesis journal section', () => {
  const settings = filename.safeSettings({ template: [
    { kind: 'field', value: 'journal' }, { kind: 'separator', value: 'commaSpace' },
    { kind: 'field', value: 'volumeIssue' }, { kind: 'separator', value: 'commaSpace' },
    { kind: 'field', value: 'title' }
  ] });
  assert.equal(filename.renderFilename(contaminated, settings, { filename: 'thesis.pdf' }), '『학위논문 제목』.pdf');
});

test('RISS thesis DOM normalizes away UI text mistakenly collected as the journal', () => {
  const { document } = parseHTML(`<html><head><title>학위논문 제목</title>
    <meta property="og:site_name" content="${notice}">
    <meta name="citation_journal_title" content="${notice}"></head><body>
    <section id="thesisInfoDiv"><h3 class="title">학위논문 제목</h3><ul>
    <li><span class="strong">저자</span> 홍길동</li>
    <li><span class="strong">학위논문사항</span> 한국대학교 일반대학원, 고고학과, 국내석사, 2025</li>
    <li><span class="strong">발행년도</span> 2025</li>
    </ul></section></body></html>`);
  const data = metadata.extractFromDocument(document, 'https://www-riss-kr.proxy.example.edu/search/detail/DetailView.do?p_mat_type=be54d9b8bc7cdb09');
  assert.equal(data.thesisDegree, '석사학위논문');
  assert.equal(data.journalName, '');
  assert.equal(filename.renderFilename(data, filename.safeSettings(), { filename: 'thesis.pdf' }),
    '홍길동, 2025, 『학위논문 제목』, 한국대학교 석사학위논문.pdf');
});

test('thesis exports also exclude journal and issue from stale metadata', () => {
  assert.ok(!metadata.renderBibtex(contaminated).includes(notice));
  assert.ok(metadata.renderBibtex(contaminated).startsWith('@mastersthesis{'));
  assert.ok(!/\b(?:journal|volume|number)\s*=/.test(metadata.renderBibtex(contaminated)));
  assert.ok(metadata.renderRis(contaminated).includes('TY  - THES'));
  assert.ok(!/^(?:T2|VL|IS)  -/m.test(metadata.renderRis(contaminated)));
});

test('ordinary journal articles retain journal brackets even with a university publisher', () => {
  const article = { ...contaminated, titleMain: '학위논문의 연구 동향', journalName: '고고학연구', publisher: '한국대학교' };
  assert.equal(citation.journalText(article), '『고고학연구』');
  assert.equal(citation.volumeIssueText(article), '12(3)');
  assert.equal(citation.titleText(article), '「학위논문의 연구 동향」');
  assert.equal(metadata.normalizeMetadata(article).journalName, '고고학연구');
});
