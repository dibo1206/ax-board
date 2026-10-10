# 10/10 작업 규칙
- prd와 wireframe을 먼저 읽는다.
- 기능은 자기 branch에서 수정한다.
- 현재 저장 방식·기존 API·DB·개수를 유지한다.
- 선택한 작은 변경 하나만 수행한다.
- 수정 후 build와 브라우저 확인 방법을 알려준다.
- AI는 commit까지만 수행한다.
- push·PR 생성은 사람이 VS Code 소스 제어·GitHub 화면에서 한다.
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- Install: `npm install`
- Dev server: `npm run dev -- --port 30NN` (replace `30NN` with a 4-digit port, e.g. `3001`) — always pass an explicit port this way for this project
- Build: `npm run build`
- Preview production build: `npm run preview`
- Lint: `npm run lint` (runs oxlint)
- No test suite exists yet.

## Architecture

농산물 추천·상담 판매 사이트. Single-page React app (Vite + React 19, JS not TS) with no backend and no router.

- `src/App.jsx` owns screen state (`view`: `home` | `detail` | `recommend`) and chatbot open state; the floating [상담하기] button shows on home and detail.
- `src/data/products.js` is the single source of product info (price, unit, weight, brix, features, storage, soldOut, taste/type/purposes tags). Home, detail, recommendation and chatbot all read from it.
- `src/data/guides.js` holds farm contact info and shared guides (delivery, order, refund) used by detail and chatbot. `FARM.phone` / `kakaoUrl` are placeholders.
- `src/utils/recommend.js`: 4 questions (purpose, budget, taste, type); excludes sold-out items; returns up to 3 exact matches, else closest items with their mismatched conditions.
- `src/utils/chatbot.js`: rule-based keyword matcher (no LLM). Answers only from products/guides and returns `sources` for the "근거:" line; unknown questions return `answered: false`, which shows [전화 문의]/[카카오톡 문의].
- `src/utils/storage.js`: order inquiries (name, phone, quantity) saved to `localStorage` key `farm-site:inquiries` — the only persistence (no server, no DB, no payment).
- Components in `src/components/`: `Home`, `ProductDetail`, `InquiryForm`, `Recommend`, `RecommendResult` (incl. compare table), `Chatbot`, `ProductImage` (emoji placeholder until real photos).
- Styling: single mobile-first stylesheet `src/index.css`, no CSS framework.
- Out of scope for now: producer product registration/management, admin member management, cart, payment, sign-up/login.

## Project-specific notes

- All UI copy must be in Korean.