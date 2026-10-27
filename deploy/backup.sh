#!/bin/bash
# 매일 DB와 상품 사진을 백업하고 14일 지난 백업은 지운다 (docs/deploy.md 6번)
# crontab:  0 3 * * * /srv/farm-mall/deploy/backup.sh
set -euo pipefail

APP=/srv/farm-mall
DIR=/srv/backup
DAY=$(date +%F)
mkdir -p "$DIR" && chmod 700 "$DIR"

# DB 주소는 .env 에서만 읽는다 (화면·기록에 남기지 않음)
DATABASE_URL=$(grep '^DATABASE_URL=' "$APP/.env" | cut -d= -f2-)
pg_dump "$DATABASE_URL" --format=custom --file="$DIR/db-$DAY.dump"
tar czf "$DIR/uploads-$DAY.tgz" -C "$APP" uploads
chmod 600 "$DIR/db-$DAY.dump" "$DIR/uploads-$DAY.tgz"

find "$DIR" -type f -mtime +14 -delete
echo "[backup] $DAY 완료"
