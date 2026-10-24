// PostgreSQL 연결. DB 주소는 .env 의 DATABASE_URL 에서만 읽고, 모든 테이블은 farm 스키마를 쓴다.
import { readFile } from 'node:fs/promises'
import pg from 'pg'

// DATE 칸은 시간대 변환 없이 '2026-10-17' 문자열 그대로 받는다
pg.types.setTypeParser(1082, (value) => value)

// DB가 멈추거나 끊겨도 요청이 끝없이 기다리지 않게 시간 제한을 둔다
//  - 연결 5초, 쿼리 30초, 잠금 대기 20초(결제 승인 중인 주문을 다른 요청이 기다릴 수 있어서 결제사 시간 제한 15초보다 길게)
//  - 트랜잭션을 연 채 60초 동안 아무것도 안 하면 DB가 그 연결을 끊는다 (서버가 멈춰도 잠금이 영원히 남지 않게)
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  options: '-c search_path=farm -c statement_timeout=30000 -c lock_timeout=20000 -c idle_in_transaction_session_timeout=60000',
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
  max: 10,
})

// 쉬고 있던 연결이 끊겨도(DB 재시작·네트워크 끊김) 서버가 죽지 않게: 기록만 하고, 다음 요청은 새 연결로 처리된다
pool.on('error', (error) => {
  console.error(`[db] 쉬고 있던 연결이 끊겼어요 (다음 요청은 새 연결로) · ${error.code ?? ''} ${error.message}`)
})

// 연결이 불안정해서 생긴 오류인지 (사람 탓이 아니라 잠시 후 다시 하면 되는 오류)
const TRANSIENT = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', '57P01', '57P02', '57P03', '08000', '08001', '08003', '08006', '57014', '55P03', '40001', '40P01'])
export function isTransientDbError(error) {
  return TRANSIENT.has(error?.code) || /Connection terminated|timeout exceeded when trying to connect/i.test(error?.message ?? '')
}

// 서버를 켤 때 DB가 아직 준비 안 됐으면 잠깐씩 기다렸다가 다시 시도한다 (1, 2, 4, 8, 16초)
export async function initDb({ retries = 5 } = {}) {
  const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8')
  for (let attempt = 0; ; attempt += 1) {
    try {
      await pool.query(schema)
      return
    } catch (error) {
      if (attempt >= retries || !isTransientDbError(error)) throw error
      const wait = 1000 * 2 ** attempt
      console.warn(`[db] DB에 연결하지 못했어요. ${wait / 1000}초 뒤 다시 시도 (${attempt + 1}/${retries}) · ${error.code ?? error.message}`)
      await new Promise((resolve) => setTimeout(resolve, wait))
    }
  }
}
