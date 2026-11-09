import { useState } from 'react'
import { usePage } from './paging.js'
import { Chip, FilterChips, Pager } from './ui.jsx'

// 상품 관리 › 농가별로 보기 (2026-11-09): 농가가 많아져도 한눈에 — 농가마다 판매 중·검토 대기·품절·확인 필요 개수를 한 줄로,
// 찾기(이름·지역)와 정렬, 20곳씩 쪽 나누기. 줄을 누르면 그 농가 상품만 상품 목록으로 연다.
// rows: Admin.jsx 가 상품 목록에서 센 농가별 숫자 [{ seller_code, name, region, is_company, total, selling, pending, soldout, check, draft }]
const SORTS = [
  ['todo', '할 일 많은 순', (a, b) => b.pending + b.check - (a.pending + a.check) || b.total - a.total],
  ['products', '상품 많은 순', (a, b) => b.total - a.total],
  ['name', '이름순', () => 0],
]
const VIEWS = [
  ['all', '전체', () => true],
  ['todo', '할 일 있는 곳', (f) => f.pending + f.check > 0],
  ['soldout', '품절 있는 곳', (f) => f.soldout > 0],
  ['empty', '상품 없는 곳', (f) => f.total === 0],
]
const num = (n, tone) => (n > 0 ? (tone ? <Chip tone={tone}>{n}</Chip> : n) : <span className="muted">–</span>)

export function FarmOverview({ rows, onPick }) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('todo')
  const [view, setView] = useState('all')
  const q = query.trim()
  const byName = (a, b) => a.name.localeCompare(b.name, 'ko')
  const shown = rows
    .filter(VIEWS.find(([key]) => key === view)[2])
    .filter((f) => !q || `${f.name} ${f.region ?? ''}`.includes(q))
    .sort((a, b) => (b.is_company ? 1 : 0) - (a.is_company ? 1 : 0) || SORTS.find(([key]) => key === sort)[2](a, b) || byName(a, b))
  const paging = usePage(shown, 20, `${q}|${sort}|${view}`)

  return (
    <section className="farm-overview">
      <div className="toolbar">
        <FilterChips value={view} onChange={setView} items={VIEWS.map(([key, label, f]) => ({ key, label, count: rows.filter(f).length }))} />
        <div className="actions">
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="농가 이름·지역 찾기" aria-label="농가 찾기" />
          <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="정렬">
            {SORTS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </div>
      </div>
      {shown.length === 0 ? <p className="muted">맞는 농가가 없어요.</p> : (
        <table className="table farm-table">
          <thead>
            <tr><th>농가</th><th>판매 중</th><th>검토 대기</th><th>품절</th><th>확인 필요</th><th>임시·반려</th><th></th></tr>
          </thead>
          <tbody>
            {paging.rows.map((f) => (
              <tr key={f.seller_code} className="farm-row" onClick={() => onPick(f.seller_code)}>
                <td>
                  <strong>{f.name}</strong>{f.is_company && <> <Chip tone="green">회사 직영</Chip></>}
                  <br /><span className="muted">{f.region || '지역 없음'} · 상품 {f.total}개</span>
                </td>
                <td>{num(f.selling)}</td>
                <td>{num(f.pending, 'amber')}</td>
                <td>{num(f.soldout, 'red')}</td>
                <td>{num(f.check, 'amber')}</td>
                <td>{num(f.draft)}</td>
                <td className="row-actions">
                  <button type="button" onClick={(e) => { e.stopPropagation(); onPick(f.seller_code) }} aria-label={`${f.name} 상품 보기`}>상품 보기 →</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Pager paging={paging} />
    </section>
  )
}
