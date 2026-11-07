// 저장소: 상품, 알림 신청, 메일 발송 기록.
// 데모용이라 JSON 파일 하나에 저장한다. 실서비스에 붙일 때는 이 파일만
// 같은 함수 이름으로 DB(MySQL, PostgreSQL 등) 버전으로 바꾸면 된다.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// [예시] 테스트용으로 지어낸 상품·가격·재고. stock 이 0 이면 품절.
const SEED_PRODUCTS = [
  { id: 'p1', name: '제주 한라봉 3kg', price: 32000, stock: 0, emoji: '🍊' },
  { id: 'p2', name: '성주 꿀참외 2kg', price: 24000, stock: 0, emoji: '🍈' },
  { id: 'p3', name: '논산 설향 딸기 1kg', price: 18000, stock: 5, emoji: '🍓' },
  { id: 'p4', name: '영주 부사 사과 5kg', price: 39000, stock: 0, emoji: '🍎' },
  { id: 'p5', name: '나주 신고배 7.5kg', price: 45000, stock: 12, emoji: '🍐' },
];

const MAIL_LOG_LIMIT = 100;

function emptyData() {
  return { products: structuredClone(SEED_PRODUCTS), subscriptions: [], mailLog: [] };
}

// file 을 null 로 주면 메모리에만 저장한다 (테스트용).
export function createStore(file) {
  let data = file && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : emptyData();

  // 임시 파일에 쓴 뒤 바꿔치기해서, 쓰는 도중 꺼져도 파일이 깨지지 않게 한다.
  function save() {
    if (!file) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 2));
    fs.renameSync(`${file}.tmp`, file);
  }
  save();

  const pendingFor = (productId) =>
    data.subscriptions.filter((s) => s.productId === productId && s.status === 'pending');

  return {
    // 상품 목록 + 상품별 알림 대기 인원
    listProducts() {
      return data.products.map((p) => ({ ...p, waiting: pendingFor(p.id).length }));
    },

    getProduct(id) {
      return data.products.find((p) => p.id === id);
    },

    updateStock(id, stock) {
      const product = this.getProduct(id);
      product.stock = stock;
      save();
      return product;
    },

    // 같은 상품에 같은 이메일로 대기 중인 신청이 있는지
    hasPendingSubscription(productId, email) {
      return pendingFor(productId).some((s) => s.email === email);
    },

    // status: pending(대기) → notified(발송 완료) 또는 cancelled(취소)
    addSubscription(productId, email) {
      const sub = {
        id: crypto.randomUUID(),
        productId,
        email,
        status: 'pending',
        token: crypto.randomBytes(16).toString('hex'), // 취소 링크용
        createdAt: new Date().toISOString(),
        notifiedAt: null,
      };
      data.subscriptions.push(sub);
      save();
      return sub;
    },

    pendingFor,

    markNotified(subId) {
      const sub = data.subscriptions.find((s) => s.id === subId);
      sub.status = 'notified';
      sub.notifiedAt = new Date().toISOString();
      save();
    },

    cancelByToken(token) {
      const sub = data.subscriptions.find((s) => s.token === token && s.status === 'pending');
      if (!sub) return null;
      sub.status = 'cancelled';
      save();
      return sub;
    },

    logMail(entry) {
      data.mailLog.unshift({ ...entry, at: new Date().toISOString() });
      data.mailLog.length = Math.min(data.mailLog.length, MAIL_LOG_LIMIT);
      save();
    },

    listMailLog() {
      return data.mailLog;
    },

    reset() {
      data = emptyData();
      save();
    },
  };
}
