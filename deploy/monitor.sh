#!/bin/bash
set -euo pipefail
bad=0
curl --fail --silent --max-time 10 http://127.0.0.1:3000/api/v1/health >/dev/null || bad=1
free=$(df -Pk /var/lib/yanxiben | awk 'NR==2 {print $4}')
used=$(df -Pk /var/lib/yanxiben | awk 'NR==2 {gsub(/%/,"",$5); print $5}')
(( free >= 5242880 && used < 80 )) || bad=1
last=$(cat /var/lib/yanxiben/last-backup-success 2>/dev/null || echo 0)
(( $(date +%s) - last < 93600 )) || bad=1
(( bad == 0 )) || { /etc/yanxiben/notify monitoring; exit 1; }
