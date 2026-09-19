import { useState } from 'react'

function IdeaForm({ onAdd }) {
  const [title, setTitle] = useState('')
  const [task, setTask] = useState('')
  const [idea, setIdea] = useState('')

  function handleSubmit(e) {
    e.preventDefault()
    const trimmedTitle = title.trim()
    if (!trimmedTitle) return

    onAdd({
      title: trimmedTitle,
      task: task.trim(),
      idea: idea.trim(),
    })

    setTitle('')
    setTask('')
    setIdea('')
  }

  return (
    <form className="idea-form" onSubmit={handleSubmit}>
      <div className="field">
        <label htmlFor="title">제목</label>
        <input
          id="title"
          type="text"
          placeholder="아이디어 제목을 입력하세요"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
      </div>

      <div className="field">
        <label htmlFor="task">대상 업무</label>
        <input
          id="task"
          type="text"
          placeholder="어떤 업무에 적용할까요?"
          value={task}
          onChange={(e) => setTask(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="idea">AI 활용 아이디어</label>
        <textarea
          id="idea"
          placeholder="AI를 어떻게 활용할지 구체적으로 적어주세요"
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          rows={3}
        />
      </div>

      <button type="submit" className="submit-button">
        카드 추가
      </button>
    </form>
  )
}

export default IdeaForm
