# AX 아이디어 보드

업무에 AI를 어떻게 활용할지 아이디어를 카드로 기록하고 관리하는 웹앱입니다.

## 실행 방법

```bash
npm install
npm run dev -- --port 3004
```

실행 후 http://localhost:3004 에서 접속할 수 있습니다.

## 폴더 구조

```
ax-board/
├── index.html
├── src/
│   ├── main.jsx              # 엔트리 포인트
│   ├── App.jsx                # 아이디어 목록 상태 관리, localStorage 연동
│   ├── App.css
│   ├── index.css              # 전역 스타일, 다크모드 대응
│   └── components/
│       ├── IdeaForm.jsx       # 제목/대상 업무/AI 활용 아이디어 입력 폼
│       └── IdeaCard.jsx       # 카드 표시 및 삭제 버튼
├── public/
├── package.json
└── vite.config.js
```

## 주요 기능

- 제목·대상 업무·AI 활용 아이디어를 입력해 카드 추가 (제목만 필수)
- 등록된 아이디어 카드 목록 표시 및 삭제
- 제목·대상 업무·아이디어 내용 기준 실시간 검색
- 최신순·오래된순·제목순 정렬
- localStorage에 저장되어 새로고침해도 데이터 유지
- 다크모드 색상 대응

## 남은 할 일

- 카드 내용 수정(편집) 기능
- 카테고리/태그 분류
- 데이터 내보내기/가져오기(백업) 기능
- 배포(호스팅)
