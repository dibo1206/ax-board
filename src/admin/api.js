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
    if (!response.ok) {
      const error = new Error(data.error || `요청이 실패했어요 (${response.status})`)
      error.status = response.status
      error.errors = data.errors
      error.needOtp = data.needOtp === true
      throw error
    }
    return data
  }
}

export const adminApi = makeApi('/api/admin')
export const sellerApi = makeApi('/api/seller')
