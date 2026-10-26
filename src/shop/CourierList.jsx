import { useEffect, useState } from 'react'
import { getPolicy } from './shared.js'

// 택배사 입력칸에 붙는 고르기 목록 (목록에 없으면 직접 입력)
export function CourierList() {
  const [couriers, setCouriers] = useState([])
  useEffect(() => {
    getPolicy().then((p) => setCouriers(p.couriers ?? [])).catch(() => {})
  }, [])
  return <datalist id="couriers">{couriers.map((c) => <option key={c} value={c} />)}</datalist>
}
