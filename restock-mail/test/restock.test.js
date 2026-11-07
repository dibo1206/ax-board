import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';
import { createRestockService } from '../src/restock.js';

function setup({ failFor = [] } = {}) {
  const sent = [];
  const mailer = {
    async send(mail) {
      if (failFor.includes(mail.to)) throw new Error('SMTP down');
      sent.push(mail);
      return { previewUrl: null };
    },
  };
  const store = createStore(null);
  const svc = createRestockService({ store, mailer, baseUrl: 'http://x' });
  return { store, svc, sent, restockMails: () => sent.filter((m) => m.subject.startsWith('[재입고 알림]')) };
}

test('품절 상품 구독 후 재입고하면 메일 1회 발송', async () => {
  const { svc, restockMails } = setup();
  await svc.subscribe('p1', ' A@Test.com ');
  await svc.subscribe('p1', 'b@test.com');
  const { notified } = await svc.setStock('p1', 3);
  assert.equal(notified.length, 2);
  assert.deepEqual(restockMails().map((m) => m.to), ['a@test.com', 'b@test.com']);

  // 재고만 늘어나는 경우엔 다시 보내지 않음
  await svc.setStock('p1', 10);
  assert.equal(restockMails().length, 2);
});

test('중복 신청·재고 있는 상품·잘못된 이메일은 거절', async () => {
  const { svc } = setup();
  await svc.subscribe('p1', 'a@test.com');
  await assert.rejects(svc.subscribe('p1', 'A@test.com'), { status: 409 });
  await assert.rejects(svc.subscribe('p3', 'a@test.com'), { status: 409 });
  await assert.rejects(svc.subscribe('p1', 'not-an-email'), { status: 400 });
  await assert.rejects(svc.setStock('p1', -1), { status: 400 });
});

test('발송 실패한 구독은 대기로 남아 다음 재입고 때 재시도', async () => {
  const { svc, store } = setup({ failFor: ['bad@test.com'] });
  await svc.subscribe('p2', 'ok@test.com');
  await svc.subscribe('p2', 'bad@test.com');
  const { notified } = await svc.setStock('p2', 1);
  assert.deepEqual(notified.map((n) => n.ok), [true, false]);
  assert.deepEqual(store.pendingFor('p2').map((s) => s.email), ['bad@test.com']);
});

test('취소한 구독은 발송되지 않음', async () => {
  const { svc, store, restockMails } = setup();
  const { sub } = await svc.subscribe('p4', 'a@test.com');
  store.cancelByToken(sub.token);
  await svc.setStock('p4', 5);
  assert.equal(restockMails().length, 0);
});

test('상품명에 HTML 이 들어 있어도 메일 본문에서는 글자로 표시', async () => {
  const { svc, store, sent } = setup();
  store.getProduct('p1').name = '<b>특가</b> 한라봉';
  await svc.subscribe('p1', 'a@test.com');
  assert.ok(sent[0].html.includes('&lt;b&gt;특가&lt;/b&gt;'));
  assert.ok(!sent[0].html.includes('<b>특가'));
});
