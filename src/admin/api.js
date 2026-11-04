// 관리자·판매자 API 호출. 실패하면 서버가 준 사람 말 메시지(와 항목별 오류 목록)를 담아 던진다
import { netFetch } from '../net.js'
function makeApi(base) {
  return async function call(path, options = {}) {
    // timeoutMs: 기다리는 시간 (AI 초안처럼 오래 걸리는 요청만 늘린다, 기본 20초)
    const { timeoutMs, ...rest } = options
    const isJson = rest.body !== undefined && !(rest.body instanceof Blob)
    const response = await netFetch(`${base}${path}`, {
      ...rest,
      headers: isJson ? { 'Content-Type': 'application/json' } : rest.headers,
      body: isJson ? JSON.stringify(rest.body) : rest.body,
    }, timeoutMs)
    if (response.status === 204) return null
    const data = await response.json().catch(() => ({}))
    // 202 + pending: 결제 취소 결과를 아직 모름 (server/orders.js 의 runRefund) → 실패처럼 안내하고 화면은 [다시 확인]을 보여 준다
    if (!response.ok || (response.status === 202 && data.pending === true)) {
      const error = new Error(data.error || `요청이 실패했어요 (${response.status})`)
      error.status = response.status
      error.errors = data.errors
      error.issues = data.issues // 품목 검수: 고칠 것 목록
      error.needOtp = data.needOtp === true
      error.pending = data.pending === true
      throw error
    }
    return data
  }
}

export const adminApi = makeApi('/api/admin')
export const sellerApi = makeApi('/api/seller')
