// 토스페이먼츠 결제 승인·조회·취소. 시크릿 키는 .env 의 TOSS_SECRET_KEY 에서만 읽고 코드·로그·응답에 쓰지 않는다.
// 키가 없으면 개발용 '테스트 결제'(실제 돈이 오가지 않음)로 동작한다. 운영(NODE_ENV=production)에서는 키 없이 결제할 수 없다.
//
// 통신이 중간에 끊기면 "실패"인지 "이미 승인됐는데 답만 못 받은 것"인지 알 수 없다.
// 그런 오류에는 uncertain: true 를 붙이고, 부르는 쪽은 실패로 처리하지 말고 결제 조회(lookupPayment)로 실제 상태를 확인한다.
const DEFAULT_API = 'https://api.tosspayments.com/v1/payments'
// 결과를 알 수 없는 오류 코드 (공식 오류 코드 문서 기준): 결제사 일시 오류, 같은 요청 처리 중, 이미 처리됨
const UNCERTAIN_CODES = new Set(['PROVIDER_ERROR', 'FAILED_INTERNAL_SYSTEM_PROCESSING', 'IDEMPOTENT_REQUEST_PROCESSING', 'ALREADY_PROCESSED_PAYMENT'])

// 시험할 때만 가짜 결제 서버·짧은 시간 제한을 쓸 수 있다 (운영에서는 무시)
const testing = () => process.env.NODE_ENV !== 'production'
const apiBase = () => (testing() && process.env.TOSS_API_BASE) || DEFAULT_API
const timeoutMs = () => (testing() && Number(process.env.TOSS_TIMEOUT_MS)) || 15_000

export function paymentMode() {
  if (process.env.TOSS_CLIENT_KEY && process.env.TOSS_SECRET_KEY) return 'toss'
  return process.env.NODE_ENV === 'production' ? 'off' : 'mock'
}

// 운영에서 테스트 키로 주문을 받으면 돈을 내지 않아도 '결제 완료'가 되어 농가가 물건을 보낼 수 있다 → 막는다.
// 오픈 전 리허설만 ALLOW_TEST_PAYMENTS=1 로 연다. 이미 들어온 주문의 조회·취소는 그대로 된다
export function orderingOpen() {
  if (paymentMode() === 'off') return false
  const testKeyInProduction = process.env.NODE_ENV === 'production' && process.env.TOSS_SECRET_KEY?.startsWith('test_')
  return !testKeyInProduction || process.env.ALLOW_TEST_PAYMENTS === '1'
}

// 테스트 키(test_…)나 개발용 결제로 들어온 주문은 실제 판매가 아니라고 표시한다
export function isTestPayment() {
  const mode = paymentMode()
  return mode === 'mock' || process.env.TOSS_SECRET_KEY?.startsWith('test_') === true
}

export function clientKey() {
  return paymentMode() === 'toss' ? process.env.TOSS_CLIENT_KEY : null
}

async function request(method, path, body, idempotencyKey) {
  let response
  try {
    response = await fetch(`${apiBase()}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${process.env.TOSS_SECRET_KEY}:`).toString('base64')}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}), // 같은 요청을 다시 보내도 한 번만 처리되고 첫 응답이 돌아온다
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs()),
    })
  } catch (error) {
    // 연결 끊김·시간 초과: 결제사에서는 처리됐을 수도 있다
    throw Object.assign(new Error('결제사와 연결이 끊겼어요.'), { uncertain: true, cause: error })
  }
  let data = null
  try {
    data = await response.json()
  } catch {
    // 응답을 받는 도중에 끊긴 경우
  }
  if (!response.ok) {
    const code = data?.code
    throw Object.assign(new Error(data?.message || '결제 요청이 실패했어요.'), {
      status: response.status, code, uncertain: response.status >= 500 || UNCERTAIN_CODES.has(code),
    })
  }
  if (!data) throw Object.assign(new Error('결제사 응답을 끝까지 받지 못했어요.'), { uncertain: true })
  return data
}

// 주문번호로 실제 결제 상태 조회. 결제가 없으면 null
export async function lookupPayment(orderId) {
  if (paymentMode() !== 'toss') return null
  try {
    return await request('GET', `/orders/${encodeURIComponent(orderId)}`)
  } catch (error) {
    if (error.status === 404) return null
    throw error
  }
}

// 결제 승인. 토스가 돌려준 금액·주문번호·상태가 우리 주문과 같은지 한 번 더 확인한다
export async function confirmPayment({ paymentKey, orderId, amount }) {
  const mode = paymentMode()
  if (mode === 'off') throw Object.assign(new Error('결제 설정이 아직 안 됐어요.'), { code: 'NOT_CONFIGURED' })
  if (mode === 'mock') {
    if (paymentKey !== `mock_${orderId}`) throw Object.assign(new Error('테스트 결제 정보가 맞지 않아요.'), { code: 'MOCK_MISMATCH' })
    return { paymentKey, method: '테스트 결제', approvedAt: new Date().toISOString() }
  }
  const data = await request('POST', '/confirm', { paymentKey, orderId, amount }, `confirm-${orderId}`)
  return checkApproved(data, { orderId, amount })
}

// 승인된 결제(승인 응답이든 조회 결과든)가 우리 주문과 맞는지 확인
export function checkApproved(data, { orderId, amount }) {
  if (data.orderId !== orderId || data.totalAmount !== amount) {
    throw Object.assign(new Error('승인된 결제 정보가 주문과 달라요.'), { code: 'MISMATCH', payment: data })
  }
  if (data.status !== 'DONE') {
    // 가상계좌(입금 대기) 등은 아직 지원하지 않는다 → 취소하고 다른 수단으로 안내
    throw Object.assign(new Error('지금은 카드·간편결제·계좌이체만 받아요. 다른 결제 수단으로 다시 시도해 주세요.'), { code: 'UNSUPPORTED_STATUS', payment: data })
  }
  return { paymentKey: data.paymentKey, method: data.method, approvedAt: data.approvedAt }
}

export async function cancelPayment({ paymentKey, orderId, reason }) {
  const mode = paymentMode()
  if (mode === 'mock' || paymentKey?.startsWith('mock_')) return { canceledAt: new Date().toISOString() }
  if (mode === 'off') throw Object.assign(new Error('결제 설정이 아직 안 됐어요.'), { code: 'NOT_CONFIGURED' })
  try {
    const data = await request('POST', `/${encodeURIComponent(paymentKey)}/cancel`, { cancelReason: reason.slice(0, 200) }, `cancel-${orderId}`)
    return { canceledAt: data.cancels?.at(-1)?.canceledAt ?? new Date().toISOString() }
  } catch (error) {
    if (!error.uncertain) throw error
    // 취소 요청 중 끊김: 실제로 취소됐는지 조회해서 확인한다
    const found = await lookupPayment(orderId).catch(() => null)
    if (found?.status === 'CANCELED') return { canceledAt: found.cancels?.at(-1)?.canceledAt ?? new Date().toISOString() }
    throw error
  }
}
