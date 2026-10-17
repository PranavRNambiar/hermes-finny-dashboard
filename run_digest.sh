#!/bin/bash
# Finny — Daily digest (runs at 00:00 SGT = 16:00 UTC via crontab)
set -a
source /Users/pranav/dev/hermes-finny-dashboard/.env
set +a

cd /Users/pranav/dev/hermes-finny-dashboard/agent
/opt/homebrew/opt/python@3.11/bin/python3.11 daily_digest.py >> /Users/pranav/dev/hermes-finny-dashboard/logs/digest.log 2>&1
