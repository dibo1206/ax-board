# AX 아이디어 보드

업무에 AI를 어떻게 쓸지 떠오른 생각을 카드로 모아두는 웹앱입니다. 천안형 AX 액션러닝 1주차 첫 빌드 결과물입니다.

## 실행 방법

```bash
npm install
npm run dev -- --port 3066
```

VS Code 아래 패널의 PORTS 탭에서 3066번의 지구본 아이콘을 누르면 브라우저로 열립니다. 서버를 끄려면 터미널에서 Ctrl+C를 누릅니다.

## 폴더 구조

```
ax-board/
├── index.html        진입 HTML
├── package.json      의존성과 실행 스크립트
├── vite.config.js    Vite 설정
└── src/
    ├── main.jsx      React 시작점
    ├── App.jsx       화면과 기능 전체
    └── App.css       스타일
```

## 주요 기능

- 제목, 대상 업무, AI 활용 아이디어 세 칸을 입력해 카드 추가
- 카드별 삭제 버튼
- localStorage 저장 — 새로고침해도 카드가 남습니다
- 라이트/다크 모드 자동 대응

## 남은 할 일

- 카드에 분류 태그 달기와 태그별 필터
- 제목 검색과 정렬
- 카드 내용 수정 기능
