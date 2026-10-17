#!/bin/bash
# Finny — Gmail poll (runs every 15 min via crontab)
set -a
source /Users/pranav/dev/hermes-finny-dashboard/.env
set +a

cd /Users/pranav/dev/hermes-finny-dashboard/agent
/opt/homebrew/opt/python@3.11/bin/python3.11 gmail_poll.py >> /Users/pranav/dev/hermes-finny-dashboard/logs/poll.log 2>&1
