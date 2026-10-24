#!/bin/bash
set -euo pipefail
umask 077
exec 9>/run/yanxiben-maintenance.lock
flock -n 9 || exit 1
source /etc/yanxiben/backup.env
export RESTIC_REPOSITORY RESTIC_PASSWORD_FILE
systemctl is-active --quiet yanxiben.service
stage=/var/lib/yanxiben/backup-current
# Never overwrite or delete an unexplained leftover snapshot.
[[ ! -e "$stage" && ! -L "$stage" ]]
cleanup() {
  systemctl start yanxiben.service || true
  if [[ "$stage" == /var/lib/yanxiben/backup-current ]]; then rm -rf -- "$stage"; fi
}
trap cleanup EXIT
systemctl stop yanxiben.service
set -a
source /etc/yanxiben/app.env
set +a
cd /opt/yanxiben/current
/opt/node/bin/node --import tsx scripts/instance.ts snapshot "$stage" --offline
systemctl start yanxiben.service
curl --fail --silent --retry 15 --retry-connrefused --retry-delay 1 --max-time 10 http://127.0.0.1:3000/api/v1/health >/dev/null
# Stable private staging path, protected by the maintenance lock.
restic backup --tag yanxiben-instance "$stage"
restic forget --tag yanxiben-instance --group-by tags --keep-daily 7 --keep-weekly 4 --prune
restic check
date +%s >/var/lib/yanxiben/last-backup-success
