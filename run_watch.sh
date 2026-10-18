#!/bin/bash
# Finny — IMAP IDLE watcher (persistent, instant email processing)
set -a
source /Users/pranav/dev/hermes-finny-dashboard/.env
set +a

cd /Users/pranav/dev/hermes-finny-dashboard/agent
/opt/homebrew/opt/python@3.11/bin/python3.11 gmail_watch.py >> /Users/pranav/dev/hermes-finny-dashboard/logs/watch.log 2>&1
