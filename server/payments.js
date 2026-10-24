// 토스페이먼츠 결제 승인·취소. 시크릿 키는 .env 의 TOSS_SECRET_KEY 에서만 읽고 코드·로그·응답에 쓰지 않는다.
// 키가 없으면 개발용 '테스트 결제'(실제 돈이 오가지 않음)로 동작한다. 운영(NODE_ENV=production)에서는 키 없이 결제할 수 없다.
const API = 'https://api.tosspayments.com/v1/payments'

export function paymentMode() {
  if (process.env.TOSS_CLIENT_KEY && process.env.TOSS_SECRET_KEY) return 'toss'
  return process.env.NODE_ENV === 'production' ? 'off' : 'mock'
}

// 테스트 키(test_…)나 개발용 결제로 들어온 주문은 실제 판매가 아니라고 표시한다
export function isTestPayment() {
  const mode = paymentMode()
  return mode === 'mock' || process.env.TOSS_SECRET_KEY?.startsWith('test_') === true
}

export function clientKey() {
  return paymentMode() === 'toss' ? process.env.TOSS_CLIENT_KEY : null
}

async function call(path, body, idempotencyKey) {
  const response = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${process.env.TOSS_SECRET_KEY}:`).toString('base64')}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey, // 같은 요청이 두 번 가도 한 번만 처리된다
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw Object.assign(new Error(data.message || '결제 요청이 실패했어요.'), { status: response.status, code: data.code })
  }
  return data
}

// 결제 승인. 토스가 돌려준 금액·주문번호·상태가 우리 주문과 같은지 한 번 더 확인한다
export async function confirmPayment({ paymentKey, orderId, amount }) {
  const mode = paymentMode()
  if (mode === 'off') throw Object.assign(new Error('결제 설정이 아직 안 됐어요.'), { code: 'NOT_CONFIGURED' })
  if (mode === 'mock') {
    if (paymentKey !== `mock_${orderId}`) throw Object.assign(new Error('테스트 결제 정보가 맞지 않아요.'), { code: 'MOCK_MISMATCH' })
    return { method: '테스트 결제', approvedAt: new Date().toISOString() }
  }
  const data = await call('/confirm', { paymentKey, orderId, amount }, `confirm-${orderId}`)
  if (data.orderId !== orderId || data.totalAmount !== amount) {
    throw Object.assign(new Error('승인된 결제 정보가 주문과 달라요.'), { code: 'MISMATCH', payment: data })
  }
  if (data.status !== 'DONE') {
    // 가상계좌(입금 대기) 등은 아직 지원하지 않는다 → 취소하고 다른 수단으로 안내
    throw Object.assign(new Error('지금은 카드·간편결제·계좌이체만 받아요. 다른 결제 수단으로 다시 시도해 주세요.'), { code: 'UNSUPPORTED_STATUS', payment: data })
  }
  return { method: data.method, approvedAt: data.approvedAt }
}

export async function cancelPayment({ paymentKey, orderId, reason }) {
  const mode = paymentMode()
  if (mode === 'mock' || paymentKey?.startsWith('mock_')) return { canceledAt: new Date().toISOString() }
  if (mode === 'off') throw Object.assign(new Error('결제 설정이 아직 안 됐어요.'), { code: 'NOT_CONFIGURED' })
  const data = await call(`/${encodeURIComponent(paymentKey)}/cancel`, { cancelReason: reason.slice(0, 200) }, `cancel-${orderId}`)
  return { canceledAt: data.cancels?.at(-1)?.canceledAt ?? new Date().toISOString() }
}
