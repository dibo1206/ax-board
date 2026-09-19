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

  return (
    <div className="app">
      <header className="app-header">
        <h1>AX 아이디어 보드</h1>
        <p>업무에 AI를 어떻게 활용할지 아이디어를 기록하고 관리하세요.</p>
      </header>

      <IdeaForm onAdd={handleAdd} />

      <section className="idea-list">
        {ideas.length === 0 ? (
          <p className="empty-state">등록된 아이디어가 없습니다.</p>
        ) : (
          ideas.map((idea) => (
            <IdeaCard key={idea.id} idea={idea} onDelete={handleDelete} />
          ))
        )}
      </section>
    </div>
  )
}

export default App
