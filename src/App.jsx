import { useEffect, useState } from 'react'
import './App.css'

const STORAGE_KEY = 'ax-board-cards'

function loadCards() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved ? JSON.parse(saved) : []
  } catch {
    return []
  }
}

function App() {
  const [cards, setCards] = useState(loadCards)
  const [title, setTitle] = useState('')
  const [task, setTask] = useState('')
  const [idea, setIdea] = useState('')

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cards))
  }, [cards])

  function addCard(event) {
    event.preventDefault()
    if (!title.trim() || !task.trim() || !idea.trim()) return

    setCards([
      { id: Date.now(), title: title.trim(), task: task.trim(), idea: idea.trim() },
      ...cards,
    ])
    setTitle('')
    setTask('')
    setIdea('')
  }

  function removeCard(id) {
    setCards(cards.filter((card) => card.id !== id))
  }

  return (
    <div className="app">
      <header>
        <h1>AX 아이디어 보드</h1>
        <p>업무에 AI를 어떻게 쓸지 떠오른 생각을 카드로 쌓아둡니다.</p>
      </header>

      <form className="card-form" onSubmit={addCard}>
        <label>
          제목
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="예: 주간보고 초안 자동화"
          />
        </label>
        <label>
          대상 업무
          <input
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="예: 매주 월요일 주간보고 작성"
          />
        </label>
        <label>
          AI 활용 아이디어
          <textarea
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            placeholder="예: 지난주 회의록을 요약해 초안을 만들게 한다"
            rows={3}
          />
        </label>
        <button type="submit">카드 추가</button>
      </form>

      <section className="card-list">
        <h2>아이디어 {cards.length}개</h2>
        {cards.length === 0 ? (
          <p className="empty">아직 카드가 없습니다. 위에서 첫 아이디어를 적어보세요.</p>
        ) : (
          <ul>
            {cards.map((card) => (
              <li key={card.id} className="card">
                <div className="card-head">
                  <h3>{card.title}</h3>
                  <button type="button" onClick={() => removeCard(card.id)} aria-label="카드 삭제">
                    삭제
                  </button>
                </div>
                <p className="task">대상 업무 · {card.task}</p>
                <p className="idea">{card.idea}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

export default App
