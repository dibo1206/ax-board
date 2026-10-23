# 농가 판매 자사몰 (4트워크 · 과제 07)

B2B·B2C를 함께 하는 브랜드 자사몰. 상품을 등록하면 AI 상담이 그 상품까지 알아서 답한다.
자세한 내용은 `docs/PRD.md`(v2).

## 지금 단계

- [x] 0단계: 저장소 틀 (화면 · 백엔드 · DB 연결)
- [x] 1단계: 데이터 구조와 예시 데이터, 불러오기·검사 스크립트
- [x] 2단계: 관리자 화면 (로그인, 상품 등록·수정·임시 저장, 재고·품절, 사진)
- [ ] 3단계: 소비자 화면 (시안 반영)
- [ ] 4단계: 구매 연결과 문의 (Q&A, 기업 구매 문의)
- [ ] 5단계: AI 상담
- [ ] 6단계: 추천 / 7단계: (도전) 자체 주문 / 8단계: 배포·인수인계

## 실행

```bash
npm install
cp .env.sample .env        # 처음 한 번. DATABASE_URL, SESSION_SECRET 채우기
chmod 600 .env
npm run load-data          # data/*.csv 검사 후 DB에 넣기 (검사만: npm run load-data -- --check)
npm run create-admin -- farm_admin   # 관리자 계정 만들기 (비밀번호는 실행하면 물어봄, 10자 이상)
npm run server             # 터미널 1 — 백엔드 ($PORT + 100)
npm run dev                # 터미널 2 — 화면 ($PORT)
```

실습서버의 배정 포트는 하나라서, ax-board를 켜 둔 상태라면 먼저 끄고 실행한다.

## 폴더

```
farm-mall/
├── data/            예시 데이터 CSV (팀원 데이터로 교체) — docs/data_guide.md
├── scripts/
│   ├── load-data.js 검사 → DB에 넣기 → docs/data_report.md
│   └── create-admin.js 관리자 계정 만들기·비밀번호 바꾸기
├── server/
│   ├── index.js     Express 백엔드 (/api/products, /api/products/:code, /api/tags, /api/admin/*)
│   ├── admin.js     관리자 API (로그인 필요): 상품 목록·등록·수정·사진
│   ├── auth.js      관리자 로그인 (scrypt 비밀번호 해시, 서명 쿠키 8시간, 5번 틀리면 10분 잠금)
│   ├── validate.js  상품 입력 검사 (데이터 불러오기와 같은 규칙)
│   ├── db.js        PostgreSQL 연결 (farm 스키마)
│   └── schema.sql   테이블 구조
├── src/             화면 (소비자: 데이터 확인용 / 관리자: /admin)
├── uploads/         관리자가 올린 상품 사진 (커밋 안 함)
└── docs/            PRD, 데이터 안내, 검사 결과
```
