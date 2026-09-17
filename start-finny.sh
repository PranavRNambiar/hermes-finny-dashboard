#!/bin/bash
# Starts all Finny agent processes. Run once; they stay alive.

AGENT_DIR="/Users/pranav/dev/hermes-finny-dashboard/agent"
LOG_DIR="/Users/pranav/dev/hermes-finny-dashboard/logs"
PYTHON="/opt/homebrew/bin/python3.11"

mkdir -p "$LOG_DIR"

start_process() {
    local name="$1"
    local script="$2"
    local log="$LOG_DIR/${name}.log"

    # Kill existing instance if running
    pkill -f "$script" 2>/dev/null

    cd "$AGENT_DIR" && nohup "$PYTHON" "$script" >> "$log" 2>&1 &
    echo "Started $name (PID $!)"
}

start_process "gmail-watch"  "gmail_watch.py"
start_process "telegram-bot" "telegram_bot.py"
start_process "cron-runner"  "cron_runner.py"

echo "All Finny processes started. Logs in $LOG_DIR"
