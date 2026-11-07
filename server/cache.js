// 손님 화면용 읽기 결과(상품 목록·상세 등)를 잠깐 기억해서, 같은 요청이 몰려도 DB는 한 번만 읽는다
//  - 같은 내용을 동시에 여러 명이 요청하면 첫 요청의 결과를 함께 기다린다
//  - 누가 무언가 바꾸면(관리자 수정·주문·글 남기기) index.js 에서 전부 지운다
const store = new Map()
const MAX_KEYS = 500

export async function cached(key, ttlMs, load) {
  const hit = store.get(key)
  if (hit && hit.expires > Date.now()) return hit.value
  const value = load()
  store.set(key, { value, expires: Date.now() + ttlMs })
  if (store.size > MAX_KEYS) {
    // 시간이 지난 것부터 지우고, 그래도 많으면 가장 오래된 것부터 버린다
    const now = Date.now()
    for (const [k, v] of store) if (v.expires <= now) store.delete(k)
    if (store.size > MAX_KEYS) store.delete(store.keys().next().value)
  }
  try {
    return await value
  } catch (error) {
    if (store.get(key)?.value === value) store.delete(key) // 실패한 결과는 기억하지 않는다
    throw error
  }
}

export const clearCache = () => store.clear()
