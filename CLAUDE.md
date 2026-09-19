# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- Install dependencies: `npm install`
- Run dev server: `npm run dev -- --port 3004` (project convention — always use port 3004, not the Vite default)
- Build for production: `npm run build`
- Preview production build: `npm run preview`
- Lint: `npm run lint` (runs `oxlint`; rules configured in `.oxlintrc.json`)

There is no test suite configured in this project.

## Architecture

This is a client-only React + Vite single-page app with no backend and no router — everything lives in one view.

- **State lives in `src/App.jsx`**: a single `ideas` array in `useState`, initialized synchronously from `localStorage` (key `ax-board-ideas`) via `loadIdeas()`, and persisted back to `localStorage` on every change via a `useEffect`. `loadIdeas()` swallows JSON parse errors and falls back to `[]`, so corrupted storage never crashes the app.
- **Idea shape**: `{ id, title, task, idea, createdAt }`, where `id` is `crypto.randomUUID()` and `createdAt` is an ISO string set at creation time. `task` and `idea` are optional; only `title` is required.
- **Components** (`src/components/`):
  - `IdeaForm.jsx` — controlled inputs for title/task/idea, validates and trims `title` before calling the `onAdd` prop, then resets its own fields. Has no knowledge of storage or the ideas array.
  - `IdeaCard.jsx` — pure display of one idea plus a delete button that calls the `onDelete(id)` prop. Formats `createdAt` with `toLocaleString('ko-KR', ...)`.
- All add/delete logic is owned by `App.jsx`; the components are presentational and only communicate up through `onAdd`/`onDelete` callbacks.
- All user-facing text is Korean — keep new UI strings in Korean for consistency.
- Styling is plain CSS (`src/index.css` for global/reset styles, `src/App.css` for layout and component styles), with dark mode handled via `@media (prefers-color-scheme: dark)` overrides on CSS custom properties in `:root`. No CSS framework or CSS-in-JS.
