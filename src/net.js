// 서버 요청 공통: 인터넷이 끊기거나 서버가 오래 답하지 않으면 영어 오류("Failed to fetch") 대신 한국어 안내로 바꾼다
export async function netFetch(url, options = {}, timeoutMs = 20_000) {
  try {
    return await fetch(url, { ...options, signal: options.signal ?? AbortSignal.timeout(timeoutMs) })
  } catch (error) {
    const slow = error?.name === 'TimeoutError' || error?.name === 'AbortError'
    throw Object.assign(
      new Error(slow ? '서버 응답이 늦어지고 있어요. 잠시 후 다시 시도해 주세요.' : '인터넷 연결이 불안정해요. 연결을 확인하고 다시 시도해 주세요.'),
      { network: true, status: 0 },
    )
  }
}
