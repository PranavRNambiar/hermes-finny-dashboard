#!/bin/bash
# Finny — Telegram bot (persistent, handles /today /mtd /last)
set -a
source /Users/pranav/dev/hermes-finny-dashboard/.env
set +a

cd /Users/pranav/dev/hermes-finny-dashboard/agent
/opt/homebrew/opt/python@3.11/bin/python3.11 telegram_bot.py >> /Users/pranav/dev/hermes-finny-dashboard/logs/telegram.log 2>&1
