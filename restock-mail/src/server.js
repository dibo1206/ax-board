// 서버 진입점: 설정을 읽고, 저장소·메일러·알림 로직을 연결해 API와 화면을 띄운다.
import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './store.js';
import { createMailer } from './mailer.js';
import { createRestockService, RestockError } from './restock.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 3065);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`; // 메일 속 링크에 쓰이는 주소

const store = createStore(path.join(ROOT, 'data', 'data.json'));
const mailer = await createMailer();
const restock = createRestockService({ store, mailer, baseUrl: BASE_URL });

const app = express();
app.use(express.json());
app.use(express.static(path.join(ROOT, 'public')));

// ── 고객용 ─────────────────────────────────────────────
app.get('/api/products', (req, res) => {
  res.json({ products: store.listProducts(), mailMode: mailer.mode });
});

app.post('/api/products/:id/subscribe', async (req, res) => {
  const { sub, confirm } = await restock.subscribe(req.params.id, req.body?.email);
  res.status(201).json({ ok: true, email: sub.email, confirm });
});

// 신청 확인 메일 속 "알림 신청 취소" 링크
app.get('/api/unsubscribe/:token', (req, res) => {
  const sub = store.cancelByToken(req.params.token);
  res.type('html').send(sub ? '<h3>재입고 알림 신청이 취소되었습니다.</h3>' : '<h3>이미 처리되었거나 잘못된 링크입니다.</h3>');
});

// ── 관리자용 (주의: 데모라서 로그인 없음. 실서비스에서는 반드시 관리자 인증을 붙일 것) ──
app.patch('/api/admin/products/:id/stock', async (req, res) => {
  res.json(await restock.setStock(req.params.id, req.body?.stock));
});

app.get('/api/admin/mail-log', (req, res) => {
  res.json({ mailLog: store.listMailLog() });
});

app.post('/api/admin/reset', (req, res) => {
  store.reset();
  res.json({ ok: true });
});

// ── 오류 처리 ───────────────────────────────────────────
// next 는 안 쓰지만 지우면 안 됨: Express 는 인자가 4개인 함수만 오류 처리기로 인식한다
app.use((err, req, res, next) => {
  if (err instanceof RestockError) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: '서버 오류가 발생했습니다.' });
});

app.listen(PORT, HOST, (err) => {
  if (err) {
    console.error(`포트 ${PORT} 를 열 수 없습니다: ${err.message}`);
    process.exit(1);
  }
  console.log(`재입고 알림 서버: ${BASE_URL}  (메일 모드: ${mailer.mode})`);
});
