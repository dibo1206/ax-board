import { useEffect, useRef, useState } from 'react'
import { ProductCard } from './home/Home.jsx'
import { get, getPolicy, won } from './shared.js'

// 상품 화면 (/products): 카테고리(베스트·전체·묶음 → 품목)·걸러 보기·정렬·개수·보기 방식.
// 상태는 모두 주소(?cat=&item=&sort=&free=…)에 둬서 새로고침·뒤로 가기·공유가 그대로 된다
const SORTS = [['recommended', '추천순'], ['popular', '판매 많은 순'], ['new', '최신순'], ['price_asc', '낮은 가격순'], ['price_desc', '높은 가격순'], ['reviews', '후기 많은 순'], ['rating', '별점 높은 순'], ['brix', '당도 높은 순']]
const SIZES = [20, 40, 60]
const VIEWS = [['grid', '4열로 보기', 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z'], ['big', '2열로 크게 보기', 'M4 4h7v16H4zM13 4h7v16h-7z'], ['list', '목록으로 보기', 'M4 5h4v4H4zM10 6h10M4 11h4v4H4zM10 12h10M4 17h4v4H4zM10 18h10']]
const BEST_COUNT = 20
const FLAGS = [['free', '1개만 사도 무료배송'], ['instock', '품절 제외'], ['preorder', '예약 상품'], ['grade', '당도 특·상']]

function readState() {
  const p = new URLSearchParams(window.location.search)
  const num = (k) => Math.max(0, Math.min(10_000_000, Math.floor(Number(p.get(k)) || 0)))
  return {
    q: (p.get('q') ?? '').slice(0, 50),
    cat: /^[a-z]{2,20}$/.test(p.get('cat') ?? '') ? p.get('cat') : 'all',
    item: /^[a-z][a-z0-9_]{0,39}$/.test(p.get('item') ?? '') ? p.get('item') : '',
    sort: SORTS.some(([k]) => k === p.get('sort')) ? p.get('sort') : 'recommended',
    free: p.get('free') === '1', instock: p.get('instock') === '1', preorder: p.get('preorder') === '1', grade: p.get('grade') === '1',
    min: num('min'), max: num('max'),
    size: SIZES.includes(Number(p.get('size'))) ? Number(p.get('size')) : 20,
    view: VIEWS.some(([k]) => k === p.get('view')) ? p.get('view') : 'grid',
    page: Math.max(1, Math.min(1000, num('page') || 1)),
  }
}

// 주소에 남길 것 (기본값은 빼서 짧게)
function pageUrl(s) {
  const p = new URLSearchParams()
  if (s.q) p.set('q', s.q)
  if (s.cat !== 'all') p.set('cat', s.cat)
  if (s.item) p.set('item', s.item)
  if (s.sort !== 'recommended' && s.cat !== 'best') p.set('sort', s.sort)
  for (const [k] of FLAGS) if (s[k]) p.set(k, '1')
  if (s.min) p.set('min', s.min)
  if (s.max) p.set('max', s.max)
  if (s.size !== 20) p.set('size', s.size)
  if (s.view !== 'grid') p.set('view', s.view)
  if (s.page > 1) p.set('page', s.page)
  return `/products${p.size ? `?${p}` : ''}`
}

// 서버(/api/catalog)에 보낼 조건. 베스트는 판매 많은 순 1~20위
function apiQuery(s, overrides = {}) {
  const best = s.cat === 'best'
  const p = new URLSearchParams({ sort: best ? 'popular' : s.sort, size: best ? BEST_COUNT : s.size, page: best ? 1 : s.page, ...overrides })
  if (s.q) p.set('q', s.q)
  if (!best && s.cat !== 'all') p.set('group', s.cat)
  if (s.item) p.set('item', s.item)
  if (s.free) p.set('free', '1')
  if (s.instock) p.set('instock', '1')
  if (s.preorder) p.set('preorder', '1')
  if (s.grade) p.set('brix', 'high')
  if (s.min) p.set('min', s.min)
  if (s.max) p.set('max', s.max)
  return p
}

const Chevron = () => <svg className="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>

function PricePicker({ state, onApply }) {
  const [open, setOpen] = useState(false)
  const [min, setMin] = useState(state.min || '')
  const [max, setMax] = useState(state.max || '')
  const box = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const close = (e) => { if (!box.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])
  const active = state.min || state.max
  const label = active ? `${state.min ? won(state.min) : ''} ~ ${state.max ? won(state.max) : ''}` : '가격대'
  return (
    <div className="pprice" ref={box}>
      <button type="button" className={`pchip${active ? ' on' : ''}`} aria-expanded={open} onClick={() => setOpen((v) => !v)}>{label}<Chevron /></button>
      {open && (
        <form className="pprice-pop" onSubmit={(e) => { e.preventDefault(); onApply(Number(min) || 0, Number(max) || 0); setOpen(false) }}>
          <label className="sr-only" htmlFor="pmin">최소 가격</label>
          <input id="pmin" inputMode="numeric" placeholder="최소" value={min} onChange={(e) => setMin(e.target.value.replace(/\D/g, '').slice(0, 8))} />
          <span>~</span>
          <label className="sr-only" htmlFor="pmax">최대 가격</label>
          <input id="pmax" inputMode="numeric" placeholder="최대" value={max} onChange={(e) => setMax(e.target.value.replace(/\D/g, '').slice(0, 8))} />
          <button type="submit">적용</button>
          {active && <button type="button" className="link" onClick={() => { setMin(''); setMax(''); onApply(0, 0); setOpen(false) }}>지우기</button>}
        </form>
      )}
    </div>
  )
}

export function ProductsPage() {
  const [state, setState] = useState(readState)
  const [groups, setGroups] = useState([])
  const [items, setItems] = useState([])
  const [list, setList] = useState(null)
  const [error, setError] = useState('')
  const [freeOver, setFreeOver] = useState(null)

  useEffect(() => {
    get('/shop-groups').then(setGroups).catch(() => {})
    get('/shop-items').then(setItems).catch(() => {})
    getPolicy().then((p) => setFreeOver(p.shipping?.freeOver ?? null)).catch(() => {})
    const onPop = () => setState(readState())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => {
    let alive = true
    get(`/catalog?${apiQuery(state)}`).then((r) => { if (alive) { setList(r); setError('') } }).catch((e) => alive && setError(e.message))
    return () => { alive = false }
  }, [state])

  // 조건을 바꾸면 첫 페이지로 (페이지·보기 방식만 바꿀 때는 그대로)
  function change(patch, { keepPage = false } = {}) {
    const next = { ...state, ...patch, ...(keepPage ? {} : { page: 1 }) }
    window.history.pushState(null, '', pageUrl(next))
    setState(next)
    if (!keepPage || patch.page) window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const group = groups.find((g) => g.key === state.cat)
  const groupItems = items.filter((it) => it.group === state.cat)
  const item = items.find((it) => it.item_code === state.item)
  const best = state.cat === 'best'
  const title = state.q ? `'${state.q}' 검색 결과` : best ? '실시간 베스트' : item ? item.name : group ? group.name : '전체 상품'
  const anyFilter = FLAGS.some(([k]) => state[k]) || state.min || state.max
  const tabs = [{ key: 'best', name: '베스트' }, { key: 'all', name: '전체' }, ...groups]

  return (
    <section className={`plist view-${state.view}`}>
      <nav className="pcrumbs" aria-label="현재 위치">
        <a href="/">홈</a><span aria-hidden="true">›</span><a href="/products">상품</a>
        {(group || best) && <><span aria-hidden="true">›</span><button type="button" className="link" onClick={() => change({ item: '' })}>{best ? '베스트' : group.name}</button></>}
        {item && <><span aria-hidden="true">›</span><b>{item.name}</b></>}
        {list && <span className="muted">(총 {best ? Math.min(list.total, BEST_COUNT) : list.total}개)</span>}
      </nav>
      <div className="plist-head">
        <h2 className="plist-title">{title}</h2>
        <a className="plist-farms" href="/farms">농가별로 보기 →</a>
      </div>

      <nav className="pcat" aria-label="상품 카테고리">
        {tabs.map((t) => {
          const subs = items.filter((it) => it.group === t.key)
          const on = state.cat === t.key && !state.q
          return (
            <div key={t.key} className={`pcat-tab${subs.length ? ' has-sub' : ''}`}>
              <button type="button" className={on ? 'on' : ''} aria-pressed={on} onClick={() => change({ cat: t.key, item: '', q: '' })}>
                {t.name}{subs.length > 0 && <Chevron />}
              </button>
              {subs.length > 0 && (
                <div className="pcat-drop">
                  {subs.map((it) => (
                    <button key={it.item_code} type="button" onClick={() => change({ cat: t.key, item: it.item_code, q: '' })}>
                      {it.name}<small>{it.count}</small>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      {groupItems.length > 1 && !state.q && (
        <div className="pitems" role="group" aria-label={`${group?.name ?? ''} 품목`}>
          <button type="button" className={!state.item ? 'on' : ''} onClick={() => change({ item: '' })}>전체</button>
          {groupItems.map((it) => (
            <button key={it.item_code} type="button" className={state.item === it.item_code ? 'on' : ''} onClick={() => change({ item: it.item_code })}>{it.name} <small>{it.count}</small></button>
          ))}
        </div>
      )}

      <div className="pfilter" role="group" aria-label="걸러 보기">
        {FLAGS.map(([key, label]) => (
          <button key={key} type="button" className={`pchip${state[key] ? ' on' : ''}`} aria-pressed={state[key]} onClick={() => change({ [key]: !state[key] })}
            title={key === 'free' && freeOver ? `가격이 ${won(freeOver)} 이상이라 1개만 사도 배송비가 무료인 상품만 보여요` : undefined}>
            {state[key] && <span aria-hidden="true">✓ </span>}{label}
          </button>
        ))}
        <PricePicker key={`${state.min}-${state.max}`} state={state} onApply={(min, max) => change({ min, max })} />
        {(anyFilter || state.item || state.q) && <button type="button" className="link pclear" onClick={() => change({ free: false, instock: false, preorder: false, grade: false, min: 0, max: 0, item: '', q: '' })}>초기화</button>}
      </div>

      <div className="psort">
        {!best && (
          <ul className="psort-list" aria-label="정렬">
            {SORTS.map(([key, label]) => (
              <li key={key}><button type="button" className={state.sort === key ? 'on' : ''} aria-pressed={state.sort === key} onClick={() => change({ sort: key })}>{state.sort === key && <span aria-hidden="true">✓ </span>}{label}</button></li>
            ))}
          </ul>
        )}
        {best && <p className="muted psort-note">최근 30일 동안 많이 팔린 순서예요.</p>}
        <div className="psort-tools">
          {!best && (
            <select aria-label="한 번에 볼 개수" value={state.size} onChange={(e) => change({ size: Number(e.target.value) })}>
              {SIZES.map((n) => <option key={n} value={n}>{n}개씩 보기</option>)}
            </select>
          )}
          <span className="pview" role="group" aria-label="보기 방식">
            {VIEWS.map(([key, label, d]) => (
              <button key={key} type="button" className={state.view === key ? 'on' : ''} aria-label={label} aria-pressed={state.view === key} title={label} onClick={() => change({ view: key }, { keepPage: true })}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>
              </button>
            ))}
          </span>
        </div>
      </div>

      {error ? <p className="error">{error}</p> : !list ? <p className="muted">불러오는 중…</p> : list.total === 0 ? (
        <div className="empty">
          <p>조건에 맞는 상품이 없어요.</p>
          {(anyFilter || state.item || state.q) && <button type="button" className="button ghost" onClick={() => change({ free: false, instock: false, preorder: false, grade: false, min: 0, max: 0, item: '', q: '' })}>조건 지우고 전체 보기</button>}
        </div>
      ) : (
        <>
          {list.loose && <p className="muted">'{state.q}'와 딱 맞는 상품이 없어 비슷한 상품을 보여 드려요.</p>}
          <ul className={`pgrid pgrid-${state.view}`}>
            {list.items.map((p, i) => (
              <li key={p.product_code}>
                <ProductCard p={p} rank={best ? i + 1 : null} onOpen={(code) => { window.location.href = `/p/${encodeURIComponent(code)}` }} />
              </li>
            ))}
          </ul>
          {!best && list.pages > 1 && (
            <nav className="board-pages" aria-label="페이지">
              {state.page > 1 && <button type="button" onClick={() => change({ page: state.page - 1 }, { keepPage: true })} aria-label="이전 페이지">‹</button>}
              {Array.from({ length: list.pages }, (_, i) => i + 1).filter((n) => Math.abs(n - state.page) <= 4 || n === 1 || n === list.pages).map((n) => (
                <button key={n} type="button" className={n === state.page ? 'on' : ''} aria-current={n === state.page ? 'page' : undefined} onClick={() => change({ page: n }, { keepPage: true })}>{n}</button>
              ))}
              {state.page < list.pages && <button type="button" onClick={() => change({ page: state.page + 1 }, { keepPage: true })} aria-label="다음 페이지">›</button>}
            </nav>
          )}
        </>
      )}
    </section>
  )
}
