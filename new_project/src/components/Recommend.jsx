import { useState } from 'react'
import { QUESTIONS } from '../utils/recommend.js'
import RecommendResult from './RecommendResult.jsx'

export default function Recommend({ onClose, onOpenProduct }) {
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState({})
  const [showResult, setShowResult] = useState(false)

  if (showResult) {
    return (
      <RecommendResult
        answers={answers}
        onOpenProduct={onOpenProduct}
        onChangeConditions={() => {
          setShowResult(false)
          setStep(0)
        }}
        onRestart={() => {
          setAnswers({})
          setStep(0)
          setShowResult(false)
        }}
      />
    )
  }

  const question = QUESTIONS[step]
  const isLast = step === QUESTIONS.length - 1
  const selected = answers[question.key]

  return (
    <main className="page">
      <div className="recommend-head">
        <h2>맞춤 상품 추천</h2>
        <button type="button" className="btn btn-ghost btn-small" onClick={onClose}>
          닫기
        </button>
      </div>
      <p className="progress">
        {step + 1}/{QUESTIONS.length}
      </p>
      <div className="progress-bar" aria-hidden="true">
        <div style={{ width: `${((step + 1) / QUESTIONS.length) * 100}%` }} />
      </div>

      <section className="question">
        <h3>{question.title}</h3>
        <div className="option-list">
          {question.options.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`option ${selected === option.value ? 'option-selected' : ''}`}
              aria-pressed={selected === option.value}
              onClick={() => setAnswers((prev) => ({ ...prev, [question.key]: option.value }))}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>

      <div className="step-actions">
        <button type="button" className="btn btn-ghost" disabled={step === 0} onClick={() => setStep(step - 1)}>
          이전
        </button>
        {isLast ? (
          <button type="button" className="btn btn-primary" disabled={!selected} onClick={() => setShowResult(true)}>
            추천 결과 보기
          </button>
        ) : (
          <button type="button" className="btn btn-primary" disabled={!selected} onClick={() => setStep(step + 1)}>
            다음
          </button>
        )}
      </div>
    </main>
  )
}
