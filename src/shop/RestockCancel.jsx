import { useEffect, useState } from 'react'
import { post } from './shared.js'

// 재입고 알림 취소: 확인 메일의 링크로 들어온다. 링크를 열기만 해서는 취소하지 않고 [취소하기]를 눌러야 취소한다
// (메일 보안 프로그램이 링크를 미리 열어 봐도 저절로 취소되지 않게). 토큰은 읽자마자 주소창에서 지운다
export function RestockCancelPage() {
  // 읽기는 계산 안에서, 주소창 지우기는 화면에 나온 뒤에 (개발 모드가 계산을 두 번 해도 토큰을 잃지 않게)
  const [token] = useState(() => new URLSearchParams(window.location.search).get('token') ?? '')
  useEffect(() => {
    if (window.location.search) window.history.replaceState(null, '', '/restock/cancel')
  }, [])
  const [state, setState] = useState({ busy: false, done: '', error: '' })
  async function cancel() {
    setState({ busy: true, done: '', error: '' })
    try {
      const r = await post('/restock/cancel', { token })
      setState({ busy: false, done: r.message, error: '' })
    } catch (e) {
      setState({ busy: false, done: '', error: e.message })
    }
  }
  return (
    <section className="box narrow form">
      <h2>재입고 알림 취소</h2>
      {state.done ? (
        <>
          <p className="success">{state.done}</p>
          <a className="button" href="/">쇼핑몰로 가기</a>
        </>
      ) : !token ? (
        <p className="error">취소 주소가 올바르지 않아요. 확인 메일의 주소를 그대로 열어 주세요.</p>
      ) : (
        <>
          <p>이 상품의 재입고 알림 신청을 취소할까요? 취소하면 남겨 주신 이메일을 바로 지워요.</p>
          {state.error && <p className="error">{state.error}</p>}
          <button type="button" className="button" disabled={state.busy} onClick={cancel}>취소하기</button>
        </>
      )}
    </section>
  )
}
