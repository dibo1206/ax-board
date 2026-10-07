import { useEffect, useState } from 'react'
import IdeaForm from './components/IdeaForm.jsx'
import IdeaCard from './components/IdeaCard.jsx'
import './App.css'

const STORAGE_KEY = 'ax-board-ideas'

function loadIdeas() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function App() {
  const [ideas, setIdeas] = useState(loadIdeas)
  const [query, setQuery] = useState('')
  const [sortOrder, setSortOrder] = useState('newest')

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ideas))
  }, [ideas])

  function handleAdd(newIdea) {
    setIdeas((prev) => [
      {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        ...newIdea,
      },
      ...prev,
    ])
  }

  function handleDelete(id) {
    setIdeas((prev) => prev.filter((idea) => idea.id !== id))
  }

  const trimmedQuery = query.trim().toLowerCase()
  const filteredIdeas = trimmedQuery
    ? ideas.filter((idea) =>
        [idea.title, idea.task, idea.idea].some((field) =>
          field?.toLowerCase().includes(trimmedQuery),
        ),
      )
    : ideas

  const sortedIdeas = [...filteredIdeas].sort((a, b) => {
    if (sortOrder === 'oldest') {
      return new Date(a.createdAt) - new Date(b.createdAt)
    }
    if (sortOrder === 'title') {
      return a.title.localeCompare(b.title, 'ko')
    }
    return new Date(b.createdAt) - new Date(a.createdAt)
  })

  return (
    <div className="app">
      <header className="app-header">
        <h1> 우리 팀 AX 보드</h1>
        <p>업무에 AI를 어떻게 활용할지 아이디어를 기록하고 관리하세요.</p>
      </header>

      <IdeaForm onAdd={handleAdd} />

      <div className="toolbar">
        <input
          type="text"
          className="search-input"
          placeholder="제목, 대상 업무, 아이디어 내용으로 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="아이디어 검색"
        />

        <select
          className="sort-select"
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value)}
          aria-label="정렬 기준"
        >
          <option value="newest">최신순</option>
          <option value="oldest">오래된순</option>
          <option value="title">제목순</option>
        </select>
      </div>

      <section className="idea-list">
        {ideas.length === 0 ? (
          <p className="empty-state">등록된 아이디어가 없습니다.</p>
        ) : sortedIdeas.length === 0 ? (
          <p className="empty-state">검색 결과가 없습니다.</p>
        ) : (
          sortedIdeas.map((idea) => (
            <IdeaCard key={idea.id} idea={idea} onDelete={handleDelete} />
          ))
        )}
      </section>
    </div>
  )
}

export default App
