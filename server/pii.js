// 개인정보 저장 암호화: DB에는 암호문만 두고, 서버 안에서만 풀어서 쓴다. 화면과 API가 주고받는 값은 그대로다.
// 암호문은 값이 같아도 매번 달라서 그대로는 찾을 수 없다 → 찾아야 하는 값(이메일·주문자 휴대폰·사업자등록번호)은 lookupHash 를 따로 저장한다
import { lookupHash, openText, sealText } from './crypto.js'
import { pool } from './db.js'

const SEALED = '^v1\\.[A-Za-z0-9_-]{16}\\.[A-Za-z0-9_-]{22}\\.'
const TABLES = {
  orders: { key: 'id', columns: ['buyer_name', 'buyer_phone', 'buyer_email', 'receiver_name', 'receiver_phone', 'zipcode', 'address1', 'address2', 'memo', 'payment_key'], hash: { buyer_phone_hash: 'buyer_phone' } },
  customers: { key: 'id', columns: ['email', 'name', 'phone', 'zipcode', 'address1', 'address2'], hash: { email_hash: 'email' } },
  sellers: { key: 'seller_code', columns: ['owner_name', 'phone', 'business_no', 'email'], hash: { business_no_hash: 'business_no' } },
  b2b_inquiries: { key: 'id', columns: ['contact_name', 'contact'] },
  questions: { key: 'id', columns: ['contact'] },
  reviews: { key: 'id', columns: ['author'] },
  email_outbox: { key: 'id', columns: ['to_email', 'body'] },
  order_returns: { key: 'id', columns: ['reason'] }, // 반품 사유 (손님이 쓴 글이라 연락처·주소가 들어갈 수 있다)
}

const openRow = (row, table) => {
  if (!row) return row
  const opened = { ...row }
  for (const column of TABLES[table].columns) if (column in opened) opened[column] = openText(opened[column])
  return opened
}
export const openOrder = (row) => openRow(row, 'orders')
export const openCustomer = (row) => openRow(row, 'customers')
export const openSeller = (row) => openRow(row, 'sellers')
export const openB2b = (row) => openRow(row, 'b2b_inquiries')
export const openQuestion = (row) => openRow(row, 'questions')
export const openReview = (row) => openRow(row, 'reviews')
export const openMail = (row) => openRow(row, 'email_outbox')
export const openReturn = (row) => openRow(row, 'order_returns')

// 서버를 켤 때: 암호화 전에 저장된 값을 암호화한다. 이미 암호문인 값은 건너뛰어서 몇 번을 돌려도 같다
export async function encryptExisting() {
  const client = await pool.connect()
  let changed = 0
  try {
    await client.query('BEGIN')
    for (const [table, { key, columns, hash = {} }] of Object.entries(TABLES)) {
      const plain = columns.map((c) => `(${c} IS NOT NULL AND ${c} <> '' AND ${c} !~ '${SEALED}')`).join(' OR ')
      const { rows } = await client.query(`SELECT * FROM ${table} WHERE ${plain} FOR UPDATE`)
      for (const row of rows) {
        const next = columns.map((c) => sealText(openText(row[c])))
        const hashes = Object.values(hash).map((c) => (table === 'customers' && row.deleted_at ? null : openText(row[c]) ? lookupHash(openText(row[c])) : null))
        const names = [...columns, ...Object.keys(hash)]
        await client.query(
          `UPDATE ${table} SET ${names.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE ${key} = $1`,
          [row[key], ...next, ...hashes],
        )
        changed += 1
      }
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
  if (changed) console.log(`[pii] 저장돼 있던 개인정보 ${changed}건을 암호화했어요`)
  return changed
}
