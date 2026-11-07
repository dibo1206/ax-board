// 재입고 알림 핵심 로직
// - subscribe: 품절 상품에 이메일로 알림 신청 (+ 신청 확인 메일)
// - setStock:  재고 변경. 품절(0) → 입고(1 이상)로 바뀌는 순간 대기자 전원에게 메일 발송
import { confirmMail, restockMail } from './mail-templates.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 사용자에게 그대로 보여줘도 되는 오류 (status 는 HTTP 상태 코드)
export class RestockError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function createRestockService({ store, mailer, baseUrl }) {
  // 메일을 보내고 결과를 발송 기록에 남긴다. 실패해도 예외를 던지지 않고 ok:false 로 돌려준다.
  async function sendAndLog(kind, product, mail) {
    try {
      const { previewUrl } = await mailer.send(mail);
      store.logMail({ kind, to: mail.to, productName: product.name, ok: true, previewUrl });
      return { email: mail.to, ok: true, previewUrl };
    } catch (err) {
      store.logMail({ kind, to: mail.to, productName: product.name, ok: false, error: err.message });
      return { email: mail.to, ok: false, error: err.message };
    }
  }

  async function subscribe(productId, rawEmail) {
    const email = String(rawEmail ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw new RestockError(400, '올바른 이메일 주소를 입력해 주세요.');

    const product = store.getProduct(productId);
    if (!product) throw new RestockError(404, '상품을 찾을 수 없습니다.');
    if (product.stock > 0) throw new RestockError(409, '이미 재고가 있는 상품입니다. 바로 구매해 주세요.');
    if (store.hasPendingSubscription(productId, email)) {
      throw new RestockError(409, '이미 이 상품의 재입고 알림을 신청하셨습니다.');
    }

    const sub = store.addSubscription(productId, email);
    // 확인 메일이 실패해도 신청은 유지한다 (재입고 메일은 별도로 발송됨)
    const confirm = await sendAndLog('confirm', product, confirmMail({ product, sub, baseUrl }));
    return { sub, confirm };
  }

  // 대기 중인 신청자 전원에게 발송. 성공한 신청만 notified 로 바꾸고,
  // 실패한 신청은 pending 으로 남겨 다음 재입고 때 다시 시도한다.
  async function notifySubscribers(product) {
    const results = [];
    for (const sub of store.pendingFor(product.id)) {
      const result = await sendAndLog('restock', product, restockMail({ product, sub, baseUrl }));
      if (result.ok) store.markNotified(sub.id);
      results.push(result);
    }
    return results;
  }

  // 같은 상품의 재입고 요청이 동시에 들어와도 메일이 두 번 나가지 않게 막는다.
  const sending = new Set();

  async function setStock(productId, rawStock) {
    const stock = Number(rawStock);
    if (!Number.isInteger(stock) || stock < 0) throw new RestockError(400, '재고는 0 이상의 정수여야 합니다.');

    const before = store.getProduct(productId);
    if (!before) throw new RestockError(404, '상품을 찾을 수 없습니다.');

    const wasSoldOut = before.stock <= 0;
    const product = store.updateStock(productId, stock);

    // 품절 → 입고일 때만 발송 (5개 → 10개처럼 이미 재고가 있던 경우는 발송 안 함)
    if (!wasSoldOut || stock === 0 || sending.has(productId)) return { product, notified: [] };

    sending.add(productId);
    try {
      return { product, notified: await notifySubscribers(product) };
    } finally {
      sending.delete(productId);
    }
  }

  return { subscribe, setStock };
}
