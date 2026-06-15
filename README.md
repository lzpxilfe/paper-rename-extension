# 논문 PDF 인용식 파일명

국내 학술 DB에서 논문 PDF를 다운로드할 때, 현재 페이지의 서지정보를 읽어 인용식에 가까운 파일명으로 자동 저장하는 Chrome MV3 확장 프로그램입니다.

## 지원 범위

- RISS
- KCI
- KISS
- DBpia
- eArticle
- 교보 스콜라
- KoreaScience
- ScienceON
- KRM 기초학문자료센터
- 교보 스콜라 기관 프록시(`scholar-kyobobook-co-kr-ssl.openlib.uos.ac.kr`)

## 사용 방법

1. Chrome에서 `chrome://extensions`를 엽니다.
2. 개발자 모드를 켭니다.
3. `압축해제된 확장 프로그램을 로드합니다`를 누르고 이 폴더를 선택합니다.
4. 지원 사이트의 논문 상세 페이지에서 PDF, 원문, 다운로드 버튼을 누릅니다.

확장 아이콘 팝업에서 자동 파일명 변경을 잠시 끄고 켤 수 있습니다. 파일명에 들어가는 항목은 칩을 끌어서 순서를 바꾸거나, 아래 항목/구분 칩을 클릭해서 추가할 수 있습니다.

## 테스트

시스템에 Node.js가 설치되어 있다면 다음 명령으로 테스트를 실행합니다.

```powershell
npm test
```

현재 테스트는 인용식 렌더링, 파일명 정리, 다운로드 context 매칭, 6개 지원처 fixture 기반 메타데이터 추출을 확인합니다.

## 참고

이 프로젝트는 `danhyun-jeong/sickle-cite`와 `lzpxilfe/archreport`의 아이디어와 동작 구조를 참고해 새로 구현했습니다. 원본 저장소의 코드는 직접 복사하지 않았습니다.
