// 관리자 API 호출. 실패하면 서버가 준 사람 말 메시지(와 항목별 오류 목록)를 담아 던진다
export async function adminApi(path, options = {}) {
  const isJson = options.body !== undefined && !(options.body instanceof Blob)
  const response = await fetch(`/api/admin${path}`, {
    ...options,
    headers: isJson ? { 'Content-Type': 'application/json' } : options.headers,
    body: isJson ? JSON.stringify(options.body) : options.body,
  })
  if (response.status === 204) return null
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.error || `요청이 실패했어요 (${response.status})`)
    error.status = response.status
    error.errors = data.errors
    throw error
  }
  return data
}
