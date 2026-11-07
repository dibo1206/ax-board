// 상담 내용은 로그아웃(또는 탈퇴)할 때까지 이 브라우저에 기억한다 (2026-11-07 피드백).
// 장바구니·마이페이지에 갔다 와도(화면이 새로 열려도) 이어서 보인다. 공용 PC를 생각해 24시간 동안 안 쓰면 지운다
const STORE = 'farm-chat-v1'
const KEEP_MS = 24 * 60 * 60_000
const MAX_KEEP = 40

// hello: 맨 앞에 붙일 첫 인사말 (저장하지 않는다)
export function loadChat(hello) {
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORE) ?? 'null')
    if (saved && Date.now() - saved.at < KEEP_MS && Array.isArray(saved.messages) && saved.messages.length) {
      return { open: saved.open === true, messages: [hello, ...saved.messages] }
    }
  } catch {
    // 저장소를 못 쓰는 브라우저(사생활 보호 모드 등)는 기억 없이 쓴다
  }
  return { open: false, messages: [hello] }
}

// 실패한 답과 [AI에게 물어보기] 버튼 상태는 남기지 않는다
export function saveChat(messages, open) {
  const kept = messages.filter((m) => !m.failed).map(({ askAi: _a, ...m }) => m).slice(-MAX_KEEP)
  try {
    if (kept.length) window.localStorage.setItem(STORE, JSON.stringify({ at: Date.now(), open, messages: kept }))
    else window.localStorage.removeItem(STORE)
  } catch {
    // 저장소가 꽉 찼거나 막혀 있으면 이 화면에서만 기억한다
  }
}

// 로그아웃·탈퇴 때 부른다
export function clearChat() {
  try {
    window.localStorage.removeItem(STORE)
  } catch {
    // 저장소를 못 쓰면 지울 것도 없다
  }
}
