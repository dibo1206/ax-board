// 올린 사진 폴더 (2026-11-12, 배포 준비)
// 기본은 프로젝트의 uploads/. 배포 서비스(Railway 등)는 다시 배포할 때마다 서버 디스크를 새로 만들어서
// 여기 둔 사진(당도계 사진·상품 사진·레시피 사진)이 사라진다 → 계속 남는 디스크(볼륨)를 붙이고 그 안을 쓴다.
//  1. UPLOAD_DIR 에 경로를 적으면 그 폴더 (예: UPLOAD_DIR=/data/uploads)
//  2. 없고 Railway 볼륨이 붙어 있으면 Railway 가 알려 주는 볼륨 경로(RAILWAY_VOLUME_MOUNT_PATH) 아래 uploads/
//  3. 둘 다 없으면 프로젝트의 uploads/ (실습서버·개발)
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

function uploadDir() {
  const custom = process.env.UPLOAD_DIR?.trim()
  if (custom) return pathToFileURL(`${resolve(custom)}/`)
  const volume = process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim()
  if (volume) return pathToFileURL(`${join(resolve(volume), 'uploads')}/`)
  return new URL('../uploads/', import.meta.url)
}

export const UPLOAD_DIR = uploadDir()
