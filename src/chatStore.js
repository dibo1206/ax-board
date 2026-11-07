// 상담 내용은 로그아웃(또는 탈퇴)할 때까지 이 브라우저에 기억한다 (2026-11-07 피드백).
// 로그인할 때도 지운다: 대화를 로그인 상태(member)와 함께 저장하고, 화면을 열 때 지금 상태와 다르면 버린다
// (공용 PC에서 앞사람이 로그인 없이 나눈 상담이 다음에 로그인한 사람 화면에 보이지 않게. 간편 로그인으로 돌아와도 같다)
// 장바구니·마이페이지에 갔다 와도(화면이 새로 열려도) 이어서 보인다. 공용 PC를 생각해 24시간 동안 안 쓰면 지운다
const STORE = 'farm-chat-v1'
const KEEP_MS = 24 * 60 * 60_000
const MAX_KEEP = 40

// hello: 맨 앞에 붙일 첫 인사말 (저장하지 않는다)
export function loadChat(hello) {
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORE) ?? 'null')
    if (saved && Date.now() - saved.at < KEEP_MS && Array.isArray(saved.messages) && saved.messages.length) {
      return { open: saved.open === true, messages: [hello, ...saved.messages], member: saved.member === true }
    }
  } catch {
    // 저장소를 못 쓰는 브라우저(사생활 보호 모드 등)는 기억 없이 쓴다
  }
  return { open: false, messages: [hello], member: null }
}

// 실패한 답과 [AI에게 물어보기] 버튼 상태는 남기지 않는다
export function saveChat(messages, open, member = false) {
  const kept = messages.filter((m) => !m.failed).map(({ askAi: _a, ...m }) => m).slice(-MAX_KEEP)
  try {
    if (kept.length) window.localStorage.setItem(STORE, JSON.stringify({ at: Date.now(), open, member, messages: kept }))
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
