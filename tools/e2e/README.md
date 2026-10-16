# 실제 브라우저 다운로드 검증 (E2E)

크로미움에 **논문 PDF 인용식 파일명**과 **국가유산 보고서 파일명 정리**를 함께 올리고, 학술·국가유산 사이트를 흉내 낸 로컬 HTTPS 서버에서 실제로 파일을 내려받아 저장된 파일명을 확인합니다. Chrome API 모의 환경(`tests/`)으로는 잡히지 않는 크롬 고유 동작을 확인하는 용도입니다.

크롬은 진짜 도메인(`www.kci.go.kr`, `www-riss-kr-ssl.openlib.uos.ac.kr` 등)으로 접속한다고 생각하지만, `--host-resolver-rules`로 모두 이 컴퓨터의 테스트 서버로 연결됩니다. 실제 사이트에는 접속하지 않습니다.

## 준비

* Node.js 22 이상(내장 `WebSocket` 사용)
* `openssl`(테스트용 자체 서명 인증서를 처음 한 번 만듭니다)
* 확장 프로그램을 올릴 수 있는 크로미움. 기본 경로는 Playwright 크로미움(`/opt/pw-browsers/...`)이고, 다른 위치라면 `CHROME=/path/to/chrome`으로 지정합니다. 정식 Google Chrome 137 이상은 `--load-extension`을 막으므로 Chromium을 쓰세요.
* 두 저장소를 나란히 둡니다: `paper-rename-extension/`과 `archreport/`

## 실행

```bash
cd tools/e2e
node run.js                       # 접근 경로 34가지 (논문 확장을 먼저 설치한 것으로 가정)
node run.js --order report-first  # 보고서 확장을 먼저 설치한 것으로 가정
node run.js --only kci-popup      # 이름에 kci-popup이 들어간 시나리오만
node run.js --repeat 3            # 반복 실행(간헐적 실패 찾기)
node sites.js                     # 지원 학술 사이트 13곳 × (직접 / 학교 프록시 호스트 / 경로 감싸기 프록시)
```

포트는 기본 8443이며 `E2E_PORT`로 바꿀 수 있습니다.

## 시나리오가 다루는 것

* 같은 탭 링크, 새 탭, 원문보기 팝업(window.open), 지연된 JS 이동, 숨은 iframe, blob, POST 양식, PDF 주소 직접 입력
* 상세페이지를 오래 읽은 뒤 받기, 탭 두 개에 다른 논문, 같은 탭에서 논문 이동
* 서비스 워커가 잠든 상태에서 받기
* RISS 검색 목록 행, RISS 상세 → 원문보기(DBpia 창) → 받기
* 학교 프록시: 호스트 인코딩(서울시립대 openlib 형식), 경로 감싸기(`/_Lib_Proxy_Url/https://...`), 원 주소를 숨기는 불투명 프록시
* 구글 학술검색 [PDF] 링크
* 국가유산 보고서(nrich, heritage)와 논문을 번갈아 받기 — 두 확장의 공존
* 관련 없는 사이트의 파일은 손대지 않는지(같은 탭·새 탭에서 다른 사이트로 옮겨 간 경우 포함)

## 이 검증으로 처음 확인된 크롬 동작

`downloads.onDeterminingFilename` 리스너를 가진 확장이 둘 이상이면, **나중에 설치된 확장이 이름을 제안하지 않아도 그 결정(=원래 이름)이 이깁니다.** `suggest()`를 부르든, 부르지 않든, 원래 파일명을 그대로 제안하든 결과가 같았습니다. 두 확장이 `src/coop.js`로 서로 물어 같은 이름을 제안하는 이유입니다.

참고: 리눅스에서 크로미움을 C 로캘로 띄우면 한글 파일명 제안이 모두 거부됩니다. 하네스는 `LANG=C.UTF-8`로 띄웁니다.
