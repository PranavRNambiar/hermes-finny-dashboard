"""Runs scheduled jobs: daily digest (08:00 SGT, Tue–Sun) and weekly review (Mon 08:00 SGT)."""
import logging
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import schedule
from dotenv import load_dotenv

load_dotenv()

AGENT_DIR = Path(__file__).resolve().parent
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

# 00:00 UTC = 08:00 SGT
FIRE_UTC = "00:00"

_digest_run_date: str | None = None
_weekly_run_week: str | None = None


def run_digest() -> None:
    global _digest_run_date
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if _digest_run_date == today:
        log.info("[CRON] Digest already sent today, skipping")
        return
    log.info("[CRON] Running daily digest")
    result = subprocess.run([sys.executable, "daily_digest.py"], capture_output=True, text=True, cwd=AGENT_DIR)
    if result.stdout:
        log.info("[CRON] %s", result.stdout.strip())
    if result.stderr:
        log.error("[CRON] %s", result.stderr.strip())
    _digest_run_date = today


def run_weekly() -> None:
    global _weekly_run_week
    now = datetime.now(timezone.utc)
    week_key = now.strftime("%Y-W%W")
    if _weekly_run_week == week_key:
        log.info("[CRON] Weekly review already sent this week, skipping")
        return
    log.info("[CRON] Running weekly review")
    result = subprocess.run([sys.executable, "weekly_review.py"], capture_output=True, text=True, cwd=AGENT_DIR)
    if result.stdout:
        log.info("[CRON] %s", result.stdout.strip())
    if result.stderr:
        log.error("[CRON] %s", result.stderr.strip())
    _weekly_run_week = week_key


def run_job() -> None:
    """Monday: weekly review only. Tue–Sun: daily digest."""
    now = datetime.now(timezone.utc)
    if now.weekday() == 0:
        run_weekly()
    else:
        run_digest()


schedule.every().day.at(FIRE_UTC).do(run_job)

log.info("[CRON] Scheduler started — fires at %s UTC (08:00 SGT). Mon=weekly review, Tue–Sun=daily digest", FIRE_UTC)

while True:
    schedule.run_pending()
    time.sleep(30)
