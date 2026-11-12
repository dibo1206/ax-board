// 개인정보 보관 기간이 지나면 지운다 (2026-11-11 보안 점검). 개인정보 처리방침의 약속을 실제로 지키는 곳.
// 기간은 [가설: 회사·법률 확인 필요]. 처리방침 글(server/policy.js)도 같이 고친다
//  - 상품 문의 연락처: 답변 뒤 90일 / 기업 구매 문의 연락처: 완료 뒤 90일
//  - AI 상담 기록: 1년 / 보낸 메일 기록: 90일 / 관리자·판매자 접속 기록: 2년
//  - 결제하지 않은 주문(만료·실패): 30일 뒤 통째로 지운다 (계약이 이뤄지지 않아 보관 의무가 없다)
//  - 결제한 주문: 전자상거래법 보관 5년이 지나면 이름·연락처·주소만 지우고 매출 기록은 남긴다
import { pool } from './db.js'

export const RETENTION = { contactDays: 90, chatDays: 365, unpaidOrderDays: 30, mailDays: 90, accessLogDays: 730, orderYears: 5 }

// 지운 개수를 돌려준다. db: 시험에서는 트랜잭션 연결을 넘긴다
export async function purgeExpired(db = pool) {
  const run = async (sql, params) => (await db.query(sql, params)).rowCount
  const r = RETENTION
  const done = {
    questionContacts: await run('UPDATE questions SET contact = NULL WHERE contact IS NOT NULL AND answered_at < now() - make_interval(days => $1)', [r.contactDays]),
    b2bContacts: await run("UPDATE b2b_inquiries SET contact = '', contact_name = '' WHERE status = '완료' AND contact <> '' AND created_at < now() - make_interval(days => $1)", [r.contactDays]),
    chatLogs: await run('DELETE FROM chat_logs WHERE created_at < now() - make_interval(days => $1)', [r.chatDays]),
    unpaidOrders: await run("DELETE FROM orders WHERE status IN ('expired', 'failed') AND created_at < now() - make_interval(days => $1)", [r.unpaidOrderDays]),
    mails: await run("DELETE FROM email_outbox WHERE status <> 'queued' AND created_at < now() - make_interval(days => $1)", [r.mailDays]),
    accessLogs: await run('DELETE FROM access_logs WHERE created_at < now() - make_interval(days => $1)', [r.accessLogDays]),
    resets: await run("DELETE FROM password_resets WHERE expires_at < now() - interval '1 day'"),
    returnReasons: await run(
      `UPDATE order_returns x SET reason = '' FROM orders o WHERE o.id = x.order_id AND x.reason <> ''
         AND o.created_at < now() - make_interval(years => $1)`, [r.orderYears],
    ),
    oldOrders: await run(
      `UPDATE orders SET buyer_name = '', buyer_phone = '', receiver_name = '', receiver_phone = '', zipcode = '', address1 = '',
         address2 = NULL, memo = NULL, buyer_email = NULL, buyer_phone_hash = NULL
       WHERE status <> 'pending' AND buyer_phone <> '' AND created_at < now() - make_interval(years => $1)`, [r.orderYears],
    ),
  }
  return done
}

// 서버를 켠 뒤 1분 뒤에 한 번, 그다음 6시간마다
export function startRetention() {
  const sweep = () => purgeExpired()
    .then((done) => {
      const total = Object.values(done).reduce((sum, n) => sum + n, 0)
      if (total) console.log(`[retention] 보관 기간이 지난 개인정보 정리 ${JSON.stringify(done)}`)
    })
    .catch((e) => console.error(`[retention] 정리 실패 · ${e.message}`))
  setTimeout(sweep, 60_000).unref()
  setInterval(sweep, 6 * 3_600_000).unref()
}
