import { useCallback, useEffect, useState } from 'react'
import { adminApi } from './api.js'

// 관리자 [주문 → 정산] (server/settlement.js): 달마다 농가별로 보낼 돈, 보냈는지 기록
const won = (n) => `${Number(n || 0).toLocaleString('ko-KR')}원`
const plain = (name) => name.replace(/\[예시\]\s*/g, '')
const kstMonth = (offset = 0) => {
  const d = new Date(Date.now() + 9 * 3_600_000)
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() - offset)
  return d.toISOString().slice(0, 7)
}
const MONTHS = Array.from({ length: 12 }, (_, n) => kstMonth(n))
const monthLabel = (m) => `${m.slice(0, 4)}년 ${Number(m.slice(5))}월`

// 은행 송금용 표 (엑셀에서 열리게 BOM + 쉼표, 글 안의 쉼표·따옴표는 감싼다)
function downloadCsv(data) {
  const cell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
  const head = ['농가', '농가 코드', '확정 주문', '상품 판매액', '배송비 몫', '반품 환불', '수수료', '보낼 금액', '지급 완료일', '처리한 사람']
  const lines = data.rows.map((r) => [plain(r.name), r.seller_code, r.orders, r.amount, r.shipping, r.refunds, r.commission, r.payout,
    r.paid_at ? new Date(r.paid_at).toLocaleDateString('ko-KR') : '', r.paid_by ?? ''])
  const csv = '﻿' + [head, ...lines].map((l) => l.map(cell).join(',')).join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: `정산_${data.month}${data.includeTest ? '' : '_테스트제외'}.csv` })
  a.click()
  URL.revokeObjectURL(url)
}

export function Settlement() {
  const [month, setMonth] = useState(() => kstMonth(1)) // 보통 지난달 것을 보낸다
  const [includeTest, setIncludeTest] = useState(true)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    adminApi(`/settlement/${month}?test=${includeTest ? '1' : '0'}`).then((d) => { setError(''); setData(d) }).catch((e) => setError(e.message))
  }, [month, includeTest])
  useEffect(() => { load() }, [load])

  async function markPaid(row) {
    if (!window.confirm(`${plain(row.name)}에 ${monthLabel(month)} 정산 ${won(row.payout)}을 보냈다고 기록할까요?\n(실제 송금은 은행에서 따로 해요)`)) return
    setBusy(true); setError(''); setMessage('')
    try {
      await adminApi(`/settlement/${month}/sellers/${row.seller_code}/paid`, { method: 'POST', body: { amount: row.payout, includeTest } })
      setMessage(`${plain(row.name)} ${won(row.payout)} 지급 완료로 기록했어요.`)
      load()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function unmark(row) {
    if (!window.confirm(`${plain(row.name)}의 ${monthLabel(month)} 지급 완료 기록을 지울까요?`)) return
    setBusy(true); setError(''); setMessage('')
    try {
      await adminApi(`/settlement/${month}/sellers/${row.seller_code}/paid`, { method: 'DELETE' })
      load()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const rows = data?.rows ?? []
  const total = (key) => rows.reduce((sum, r) => sum + r[key], 0)
  const unpaid = rows.filter((r) => !r.paid_at && r.payout > 0)
  return (
    <section>
      <div className="section-head">
        <p className="muted">그 달에 구매 확정된 주문을 농가별로 모아요. 보낼 금액 = 상품 판매액 + 배송비 몫 − 반품 환불 − 수수료. 실제 송금은 은행에서 하고, 여기서는 [지급 완료]로 기록해요.</p>
      </div>
      <div className="toolbar settle-toolbar">
        <select value={month} onChange={(e) => { setData(null); setMonth(e.target.value) }} aria-label="정산할 달">
          {MONTHS.map((m, n) => <option key={m} value={m}>{monthLabel(m)}{n === 0 ? ' (진행 중)' : ''}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={!includeTest} onChange={(e) => { setData(null); setIncludeTest(!e.target.checked) }} /> 테스트 결제 빼기</label>
        {data && rows.length > 0 && <button type="button" className="button ghost small" onClick={() => downloadCsv(data)}>엑셀(CSV) 받기</button>}
      </div>
      {data && !data.closed && <p className="warn">아직 진행 중인 달이에요. 구매 확정·반품에 따라 금액이 바뀌어서, 지급 완료는 달이 끝난 뒤에 기록할 수 있어요.</p>}
      {message && <p className="success">{message}</p>}
      {error && <p className="error">{error}</p>}
      {!data ? <p className="muted">불러오는 중…</p> : rows.length === 0 ? <p className="muted">{monthLabel(month)}에 구매 확정된 주문이 없어요.</p> : (
        <>
          <p className="muted">{rows.length}곳 · 보낼 금액 합계 <b>{won(total('payout'))}</b> · 아직 안 보낸 곳 {unpaid.length}곳 ({won(unpaid.reduce((s, r) => s + r.payout, 0))}) · 수수료 합계 {won(total('commission'))}</p>
          <div className="table-wrap">
            <table className="table settle-table">
              <thead><tr><th>농가</th><th>확정 주문</th><th>상품 판매액</th><th>배송비 몫</th><th>반품 환불</th><th>수수료</th><th>보낼 금액</th><th>지급</th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const changed = r.paid_at && r.paid_amount !== r.payout
                  return (
                    <tr key={r.seller_code}>
                      <td><strong>{plain(r.name)}</strong>{r.is_company && <span className="muted"> · 회사 직영</span>}{r.has_test && <span className="muted"> · 테스트 결제 포함</span>}</td>
                      <td>{r.orders}건</td>
                      <td>{won(r.amount)}</td>
                      <td>{won(r.shipping)}</td>
                      <td>{r.refunds ? `− ${won(r.refunds)}` : '-'}</td>
                      <td>{r.commission ? `− ${won(r.commission)}` : '-'}</td>
                      <td><b>{won(r.payout)}</b></td>
                      <td>
                        {r.paid_at ? (
                          <>
                            <span className="success">✓ {new Date(r.paid_at).toLocaleDateString('ko-KR')} {won(r.paid_amount)}</span>
                            {changed && <><br /><span className="warn">기록 뒤 금액이 바뀌었어요 (차액 {won(r.payout - r.paid_amount)})</span></>}
                            <br /><button type="button" className="link" disabled={busy} onClick={() => unmark(r)}>기록 지우기</button>
                          </>
                        ) : data.closed && r.payout > 0
                          ? <button type="button" className="button small" disabled={busy} onClick={() => markPaid(r)}>지급 완료</button>
                          : <span className="muted">{r.payout > 0 ? '달이 끝난 뒤' : '보낼 돈 없음'}</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr><th>합계</th><th>{total('orders')}건</th><th>{won(total('amount'))}</th><th>{won(total('shipping'))}</th><th>− {won(total('refunds'))}</th><th>− {won(total('commission'))}</th><th>{won(total('payout'))}</th><th /></tr>
              </tfoot>
            </table>
          </div>
          <p className="muted">수수료는 주문할 때의 수수료율로 계산돼요 ([쇼핑몰 설정 → 정산·수수료], [판매자 승인]의 농가별 수수료). 반품 환불은 그 달 확정 주문에 그 달 안에 돌려준 돈과, 지난달 이전 확정 주문에 이번 달 돌려준 돈이에요. 결제 대행사 수수료는 들어가지 않아요.</p>
        </>
      )}
    </section>
  )
}
