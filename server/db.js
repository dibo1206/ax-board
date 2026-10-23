// PostgreSQL 연결. DB 주소는 .env 의 DATABASE_URL 에서만 읽고, 모든 테이블은 farm 스키마를 쓴다.
import { readFile } from 'node:fs/promises'
import pg from 'pg'

// DATE 칸은 시간대 변환 없이 '2026-10-17' 문자열 그대로 받는다
pg.types.setTypeParser(1082, (value) => value)

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  options: '-c search_path=farm',
})

export async function initDb() {
  const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8')
  await pool.query(schema)
}
