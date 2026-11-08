import { useEffect, useState } from 'react'
import { get } from './shared.js'

// 공지사항·언론보도 (/notice, /press, /notice/번호). 본문은 글자 그대로(줄바꿈만) 보여 준다
const TITLES = { notice: '공지사항', press: '언론보도' }
const day = (t) => new Date(t).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\.\s?/g, '.').replace(/\.$/, '')

function BoardTabs({ kind }) {
  return (
    <nav className="board-tabs" aria-label="고객센터">
      {Object.entries(TITLES).map(([key, label]) => (
        <a key={key} href={`/${key}`} className={key === kind ? 'on' : ''} aria-current={key === kind ? 'page' : undefined}>{label}</a>
      ))}
    </nav>
  )
}

export function PostListPage({ kind }) {
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    get(`/posts?kind=${kind}&page=${page}`).then(setData).catch((e) => setError(e.message))
  }, [kind, page])
  return (
    <section className="board">
      <h2>{TITLES[kind]}</h2>
      <BoardTabs kind={kind} />
      {error ? <p className="error">{error}</p> : !data ? <p className="muted">불러오는 중…</p> : data.total === 0 ? (
        <p className="muted">아직 올라온 글이 없어요.</p>
      ) : (
        <>
          <p className="muted board-count">전체 {data.total}건</p>
          <ul className="board-list">
            {data.items.map((p) => (
              <li key={p.id}>
                <a href={`/${kind}/${p.id}`}>
                  {p.image_url ? <img src={p.image_url} alt="" loading="lazy" /> : <span className="board-noimg" aria-hidden="true" />}
                  <span className="board-text">
                    <b>{p.pinned && <em className="board-pin">공지</em>}{p.title}</b>
                    {p.excerpt && <small>{p.excerpt}</small>}
                    <time dateTime={p.created_at}>{day(p.created_at)}</time>
                  </span>
                </a>
              </li>
            ))}
          </ul>
          {data.pages > 1 && (
            <nav className="board-pages" aria-label="페이지">
              {Array.from({ length: data.pages }, (_, i) => i + 1).map((n) => (
                <button key={n} type="button" className={n === page ? 'on' : ''} aria-current={n === page ? 'page' : undefined} onClick={() => setPage(n)}>{n}</button>
              ))}
            </nav>
          )}
        </>
      )}
    </section>
  )
}

export function PostDetailPage({ kind, id }) {
  const [post, setPost] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    get(`/posts/${id}`).then((p) => {
      if (p.kind !== kind) throw new Error('글을 찾지 못했어요.')
      setPost(p)
      document.title = `${p.title} · ${TITLES[kind]}`
    }).catch((e) => setError(e.message))
  }, [kind, id])
  if (error) return <section className="board"><p className="error">{error}</p><a href={`/${kind}`}>목록으로</a></section>
  if (!post) return <p className="muted">불러오는 중…</p>
  return (
    <article className="board board-detail">
      <BoardTabs kind={kind} />
      <header>
        <h2>{post.title}</h2>
        <time className="muted" dateTime={post.created_at}>{day(post.created_at)}</time>
      </header>
      {post.image_url && <img className="board-image" src={post.image_url} alt="" />}
      {post.body && <p className="board-body">{post.body}</p>}
      {post.link_url && (
        <p><a className="button ghost" href={post.link_url} target="_blank" rel="noopener noreferrer">{kind === 'press' ? '기사 보러 가기' : '관련 링크 열기'} ↗</a></p>
      )}
      <nav className="board-near" aria-label="이전·다음 글">
        {post.newer ? <a href={`/${kind}/${post.newer.id}`}><small>다음 글</small>{post.newer.title}</a> : <span />}
        {post.older ? <a href={`/${kind}/${post.older.id}`}><small>이전 글</small>{post.older.title}</a> : <span />}
      </nav>
      <a className="button" href={`/${kind}`}>목록으로</a>
    </article>
  )
}

// 첫 화면 팝업 공지: 관리자가 [팝업으로 띄우기]를 켠 공지 하나. [오늘 하루 보지 않기]는 이 브라우저에만 기억한다
const HIDE_KEY = (id) => `popup-hide-${id}`
const todayKst = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })

export function NoticePopup() {
  const [post, setPost] = useState(null)
  useEffect(() => {
    get('/posts/popup').then((p) => {
      if (!p) return
      let hidden = false
      try { hidden = localStorage.getItem(HIDE_KEY(p.id)) === todayKst() } catch { /* 저장소를 못 쓰면 매번 보여 준다 */ }
      if (!hidden) setPost(p)
    }).catch(() => {})
  }, [])
  if (!post) return null
  const close = (forToday) => {
    if (forToday) {
      try { localStorage.setItem(HIDE_KEY(post.id), todayKst()) } catch { /* 저장소를 못 쓰면 이번만 닫는다 */ }
    }
    setPost(null)
  }
  return (
    <div className="popup-backdrop" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) close(false) }}>
      <div className="popup" role="dialog" aria-modal="true" aria-labelledby="popup-title">
        {post.image_url && <img src={post.image_url} alt="" />}
        <div className="popup-body">
          <h2 id="popup-title">{post.title}</h2>
          {post.body && <p>{post.body.length > 160 ? `${post.body.slice(0, 160)}…` : post.body}</p>}
          <a href={`/notice/${post.id}`}>자세히 보기 →</a>
        </div>
        <div className="popup-actions">
          <button type="button" onClick={() => close(true)}>오늘 하루 보지 않기</button>
          <button type="button" onClick={() => close(false)} autoFocus>닫기</button>
        </div>
      </div>
    </div>
  )
}
