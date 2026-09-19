function IdeaCard({ idea, onDelete }) {
  const formattedDate = new Date(idea.createdAt).toLocaleString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <article className="idea-card">
      <header className="idea-card-header">
        <h2>{idea.title}</h2>
        <button
          type="button"
          className="delete-button"
          onClick={() => onDelete(idea.id)}
          aria-label="카드 삭제"
        >
          삭제
        </button>
      </header>

      {idea.task && (
        <p className="idea-field">
          <span className="idea-field-label">대상 업무</span>
          {idea.task}
        </p>
      )}

      {idea.idea && (
        <p className="idea-field">
          <span className="idea-field-label">AI 활용 아이디어</span>
          {idea.idea}
        </p>
      )}

      <time className="idea-date" dateTime={idea.createdAt}>
        {formattedDate}
      </time>
    </article>
  )
}

export default IdeaCard
