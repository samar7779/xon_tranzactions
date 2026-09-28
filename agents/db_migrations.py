"""Bot jadvallarining yagona manbasi (KOD 0). Faqat `agents` sxemasi.

public sxemaga hech narsa yozilmaydi: deploy `prisma db push --accept-data-loss` u yerdagi
Prisma'da yo'q jadvallarni har safar o'chiradi. Prisma faqat public'ni boshqaradi.

  python3 -m agents.db_migrations            # jadvallarni yaratadi (idempotent)
  python3 -m agents.db_migrations --cleanup  # + eski yozuvlarni o'chiradi (RETENTION_DAYS)
"""
from __future__ import annotations

import argparse
import logging
import sys
from datetime import datetime, timedelta
from typing import Dict, List, Optional

from . import config
from . import contract as C
from . import db

log = logging.getLogger("agents.db_migrations")

# ensure_tables bir vaqtda ikki jarayondan chaqirilsa CREATE poygasi bo'lmasin
_ADVISORY_LOCK_ID = 7_462_019_551

DDL = """
CREATE SCHEMA IF NOT EXISTS agents;

CREATE TABLE IF NOT EXISTS agents.kv_store (
  k          VARCHAR(64) PRIMARY KEY,
  value      TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agents.agent_runs (
  id               BIGSERIAL PRIMARY KEY,
  ts               TIMESTAMPTZ NOT NULL,
  agent            VARCHAR(32) NOT NULL,
  model            VARCHAR(64),
  status           VARCHAR(24) NOT NULL,   -- C.RUN_*
  source           VARCHAR(32),            -- dm | deleg | synth | fon | checker | teacher_daily | manual
  duration_ms      INTEGER,
  returncode       INTEGER,
  task_preview     TEXT,                   -- 500 belgi (Teacher kunlik IN)
  response_preview TEXT,                   -- 500 belgi (Teacher kunlik OUT)
  error            TEXT                    -- 500 belgi
);
CREATE INDEX IF NOT EXISTS agent_runs_agent_ts ON agents.agent_runs (agent, ts);
CREATE INDEX IF NOT EXISTS agent_runs_ts ON agents.agent_runs (ts);

CREATE TABLE IF NOT EXISTS agents.agent_tasks (
  id             BIGSERIAL PRIMARY KEY,
  created_at     TIMESTAMPTZ NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL,
  agent          VARCHAR(32) NOT NULL,
  intent         VARCHAR(32),
  source         VARCHAR(16) NOT NULL DEFAULT 'dm',   -- dm | fon
  is_forward     BOOLEAN NOT NULL DEFAULT false,
  task           TEXT NOT NULL,                       -- 2000 belgi
  status         VARCHAR(16) NOT NULL,                -- in_progress | done | failed
  result_preview TEXT,                                -- 500 belgi
  run_id         BIGINT
);
CREATE INDEX IF NOT EXISTS agent_tasks_created ON agents.agent_tasks (created_at);

CREATE TABLE IF NOT EXISTS agents.agent_memory (
  id      BIGSERIAL PRIMARY KEY,
  ts      TIMESTAMPTZ NOT NULL,
  path    VARCHAR(255) NOT NULL,
  mode    VARCHAR(8) NOT NULL,           -- append | write
  source  VARCHAR(24) NOT NULL,          -- trigger | deleg | fon | forward | daily
  agent   VARCHAR(32),
  content TEXT NOT NULL,
  result  VARCHAR(255) NOT NULL          -- natija yoki "RAD: <sabab>"
);

CREATE TABLE IF NOT EXISTS agents.agent_health (
  id        BIGSERIAL PRIMARY KEY,
  ts        TIMESTAMPTZ NOT NULL,
  component VARCHAR(64) NOT NULL,
  status    VARCHAR(8) NOT NULL,         -- ok | warn | error | unknown
  message   TEXT,
  details   TEXT                         -- JSON, 4000 belgi
);
CREATE INDEX IF NOT EXISTS agent_health_comp_ts ON agents.agent_health (component, ts);

CREATE TABLE IF NOT EXISTS agents.agent_promises (
  id               BIGSERIAL PRIMARY KEY,
  created_at       TIMESTAMPTZ NOT NULL,
  due_at           TIMESTAMPTZ NOT NULL,
  text             TEXT NOT NULL,                     -- human_reply, 500 belgi
  trigger          VARCHAR(32),
  status           VARCHAR(16) NOT NULL DEFAULT 'open', -- open | closed
  reminder_count   INTEGER NOT NULL DEFAULT 0,
  last_reminded_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS agent_promises_open ON agents.agent_promises (status, due_at);

CREATE TABLE IF NOT EXISTS agents.agent_alert_log (
  id        BIGSERIAL PRIMARY KEY,
  ts        TIMESTAMPTZ NOT NULL,
  component VARCHAR(64) NOT NULL,
  status    VARCHAR(8) NOT NULL,
  message   TEXT
);
CREATE INDEX IF NOT EXISTS agent_alert_log_cst ON agents.agent_alert_log (component, status, ts);

CREATE TABLE IF NOT EXISTS agents.agent_chat_log (   -- Q10: Teacher kunlik manbasi, 30 kun
  id         BIGSERIAL PRIMARY KEY,
  ts         TIMESTAMPTZ NOT NULL,
  role       VARCHAR(16) NOT NULL,       -- owner | leader | system
  text       TEXT NOT NULL,              -- owner/leader: neytrallangan matn; system: SISTEMA ichki matni
  is_forward BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS agent_chat_log_ts ON agents.agent_chat_log (ts);
"""

TABLES: tuple = (
    "kv_store", "agent_runs", "agent_tasks", "agent_memory", "agent_health",
    "agent_promises", "agent_alert_log", "agent_chat_log",
)

# RETENTION_DAYS jadvallari va ularning vaqt ustuni (SQL'ga faqat shu oq ro'yxatdan nom tushadi)
_TS_COLUMN: Dict[str, str] = {
    "agent_chat_log": "ts",
    "agent_runs": "ts",
    "agent_health": "ts",
    "agent_alert_log": "ts",
    "agent_tasks": "created_at",
    "agent_memory": "ts",
}

# Kutilayotgan tasdiq tokenlari (TTL 600 s) 1 kundan keyin tashlanadi
_KV_APPR_PREFIXES = ("sup_appr_", "tw_appr_")
_KV_APPR_MAX_AGE = timedelta(days=1)


def ensure_tables() -> None:
    """Idempotent, bitta tranzaksiya. Faqat agents sxemasi."""
    with db.tx("agents") as cur:
        cur.execute("SELECT pg_advisory_xact_lock(%s)", (_ADVISORY_LOCK_ID,))
        cur.execute(DDL)
    log.info("agents sxemasi tayyor (%d jadval)", len(TABLES))


def missing_tables() -> List[str]:
    """agents sxemasida yo'q jadvallar (diagnostika)."""
    rows = db.fetchall(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = %s",
        (C.DB_SCHEMA,),
    )
    have = {r["table_name"] for r in rows}
    return [t for t in TABLES if t not in have]


def cleanup_old(now: Optional[datetime] = None) -> Dict[str, int]:
    """RETENTION_DAYS dan eski qatorlar + 1 kundan eski sup_appr_/tw_appr_ kv. Natija: nom -> o'chirilgan soni (-1 = xato)."""
    now = config.to_utc(now) if now else config.now_utc()
    out: Dict[str, int] = {}
    for table, days in C.RETENTION_DAYS.items():
        col = _TS_COLUMN.get(table)
        if not col:
            log.warning("cleanup: %s uchun vaqt ustuni noma'lum, o'tkazildi", table)
            continue
        cutoff = now - timedelta(days=int(days))
        try:
            out[table] = db.execute(
                "DELETE FROM %s.%s WHERE %s < %%s" % (C.DB_SCHEMA, table, col), (cutoff,),
            )
        except Exception as exc:  # noqa: BLE001 - bitta jadval boshqasini to'xtatmasin
            log.warning("cleanup %s: %s", table, exc.__class__.__name__)
            out[table] = -1
    kv_cutoff = now - _KV_APPR_MAX_AGE
    for prefix in _KV_APPR_PREFIXES:
        name = "kv_" + prefix.rstrip("_")
        try:
            out[name] = db.execute(
                "DELETE FROM " + db.KV_TABLE + " WHERE k LIKE %s ESCAPE '!' AND updated_at < %s",
                (db._like_prefix(prefix), kv_cutoff),
            )
        except Exception as exc:  # noqa: BLE001
            log.warning("cleanup %s: %s", name, exc.__class__.__name__)
            out[name] = -1
    log.info("cleanup: %s", out)
    return out


def main(argv: Optional[List[str]] = None) -> int:
    config.configure_logging()
    parser = argparse.ArgumentParser(prog="python3 -m agents.db_migrations",
                                     description="agents sxemasi jadvallari (KOD 0)")
    parser.add_argument("--cleanup", action="store_true", help="eski yozuvlarni o'chirish (RETENTION_DAYS)")
    args = parser.parse_args(argv)
    try:
        ensure_tables()
        missing = missing_tables()
    except db.DbUnavailable as exc:
        print("XATO: baza mavjud emas: %s" % exc)
        return 1
    except Exception as exc:  # noqa: BLE001
        print("XATO: jadvallar yaratilmadi: %s" % exc.__class__.__name__)
        log.exception("ensure_tables")
        return 1
    if missing:
        print("XATO: yo'q jadvallar: " + ", ".join(missing))
        return 1
    print("OK: %s sxemasi, jadvallar: %s" % (C.DB_SCHEMA, ", ".join(TABLES)))
    if args.cleanup:
        res = cleanup_old()
        print("cleanup: " + ", ".join("%s=%d" % kv for kv in res.items()))
        if any(v < 0 for v in res.values()):
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
