#!/bin/bash
# 매일 DB와 상품 사진을 백업하고 14일 지난 백업은 지운다 (docs/deploy.md 6번)
# crontab:  0 3 * * * /srv/farm-mall/deploy/backup.sh
set -euo pipefail

APP=/srv/farm-mall
DIR=/srv/backup
DAY=$(date +%F)
mkdir -p "$DIR" && chmod 700 "$DIR"

# DB 주소는 .env 에서만 읽는다 (화면·기록에 남기지 않음).
# 비밀번호는 명령줄에 넣지 않는다 — 명령줄은 같은 서버의 다른 계정도 ps 로 볼 수 있다.
# 잠깐 만든 비밀번호 파일(본인만 읽기, 끝나면 지움)로 pg_dump 에 넘기고, 명령줄에는 비밀번호를 뺀 주소만 쓴다
umask 077
PGPASSFILE=$(mktemp)
export PGPASSFILE
trap 'rm -f "$PGPASSFILE"' EXIT
DB_URL=$(DATABASE_URL="$(grep '^DATABASE_URL=' "$APP/.env" | cut -d= -f2-)" node -e '
  const url = new URL(process.env.DATABASE_URL)
  const esc = (v) => v.replace(/[\\:]/g, "\\$&")
  if (url.password) require("node:fs").writeFileSync(process.env.PGPASSFILE, `*:*:*:${esc(decodeURIComponent(url.username) || "*")}:${esc(decodeURIComponent(url.password))}\n`)
  url.password = ""
  console.log(url.href)')
pg_dump "$DB_URL" --format=custom --file="$DIR/db-$DAY.dump"
tar czf "$DIR/uploads-$DAY.tgz" -C "$APP" uploads
chmod 600 "$DIR/db-$DAY.dump" "$DIR/uploads-$DAY.tgz"

find "$DIR" -type f -mtime +14 -delete
echo "[backup] $DAY 완료"
