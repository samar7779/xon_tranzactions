"""config.py: env parser, DB URL tozalash, sozlamalar, Q3 safe_repo_path, Toshkent vaqti."""
from __future__ import annotations

import json
import os
import tempfile
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

from agents import config
from agents import contract as C

from . import IS_POSIX, write_file

UTC = timezone.utc


class ParseEnvTextTest(unittest.TestCase):
    def test_qatorlar(self):
        text = (
            "# izoh\n"
            "\n"
            "A=1\n"
            "export B=ikki\n"
            "C='bir tirnoq # izoh emas'\n"
            'D="qo\'sh \\"tirnoq\\"\\nyangi"\n'
            "E=qiymat # izoh\n"
            "F=a=b=c\n"
            "  G = bo'shliq  \n"
            "noto'g'ri qator\n"
            "H=\n"
        )
        env = config.parse_env_text(text)
        self.assertEqual(env["A"], "1")
        self.assertEqual(env["B"], "ikki")
        self.assertEqual(env["C"], "bir tirnoq # izoh emas")
        self.assertEqual(env["D"], 'qo\'sh "tirnoq"\nyangi')
        self.assertEqual(env["E"], "qiymat")
        self.assertEqual(env["F"], "a=b=c")
        self.assertEqual(env["G"], "bo'shliq")
        self.assertEqual(env["H"], "")
        self.assertEqual(len(env), 8)


class CleanDbUrlTest(unittest.TestCase):
    BASE = "postgresql://user:pass@localhost:5432/xon_tranzactions"

    def test_schema_olib_tashlanadi(self):
        self.assertEqual(config.clean_db_url(self.BASE + "?schema=public"), self.BASE)
        out = config.clean_db_url(self.BASE + "?schema=public&sslmode=require&connection_limit=5")
        self.assertEqual(out, self.BASE + "?sslmode=require")

    def test_ozgarmaydi(self):
        self.assertEqual(config.clean_db_url(self.BASE), self.BASE)
        self.assertEqual(config.clean_db_url('"' + self.BASE + '"'), self.BASE)
        self.assertEqual(config.clean_db_url(""), "")
        self.assertEqual(config.clean_db_url("   "), "")


class _EnvFileCase(unittest.TestCase):
    """Nazoratli env: os.environ tozalanadi, AGENTS_ENV_FILE vaqtinchalik faylga."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.env_file = Path(self.tmp.name) / "agents.env"
        self.env_file.write_text("", encoding="utf-8")

    def tearDown(self):
        config.reload_env()
        self.tmp.cleanup()

    def use(self, file_text: str, **os_env: str):
        self.env_file.write_text(file_text, encoding="utf-8")
        base = {"AGENTS_ENV_FILE": str(self.env_file)}
        base.update(os_env)
        patcher = mock.patch.dict(os.environ, base, clear=True)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(config.reload_env)
        config.reload_env()


class EnvManbaTest(_EnvFileCase):
    def test_fayldan_oqiladi_osga_yozilmaydi(self):
        self.use("XON_TEST_KALIT=fayldan\n")
        self.assertEqual(config.env("XON_TEST_KALIT"), "fayldan")
        self.assertEqual(config.env_source("XON_TEST_KALIT"), "file")
        self.assertNotIn("XON_TEST_KALIT", os.environ)
        self.assertEqual(config.env_source("YOQ_KALIT"), "none")
        self.assertEqual(config.env("YOQ_KALIT", "def"), "def")

    def test_os_environ_ustun(self):
        self.use("XON_TEST_KALIT=fayldan\n", XON_TEST_KALIT="osdan")
        self.assertEqual(config.env("XON_TEST_KALIT"), "osdan")
        self.assertEqual(config.env_source("XON_TEST_KALIT"), "os")

    def test_env_int_bool(self):
        self.use("N=12\nBAD=abc\nKICHIK=3\nB1=yes\nB0=0\n")
        self.assertEqual(config.env_int("N", 5), 12)
        self.assertEqual(config.env_int("BAD", 5), 5)
        self.assertEqual(config.env_int("KICHIK", 5, min_value=10), 10)
        self.assertEqual(config.env_int("YOQ", 7), 7)
        self.assertTrue(config.env_bool("B1"))
        self.assertFalse(config.env_bool("B0", True))
        self.assertTrue(config.env_bool("YOQ", True))


class SettingsTest(_EnvFileCase):
    BOT = "sinov-bot-qiymati-" + "q" * 10
    SETUP = "sinov-setup-qiymati-" + "w" * 10

    def _toliq(self, **extra: str) -> str:
        lines = {
            "LEADER_BOT_TOKEN": self.BOT,
            "LEADER_TG_ID": str(C.EGASI_TG_ID),
            "ANTHROPIC_SETUP_TOKEN": self.SETUP,
            "AGENTS_USE_CLI": "1",
            "DATABASE_URL": "postgresql://user:pass@localhost/xon_tranzactions?schema=public",
        }
        lines.update(extra)
        return "".join("%s=%s\n" % kv for kv in lines.items())

    def test_toliq_sozlama(self):
        self.use(self._toliq())
        s = config.get_settings()
        self.assertEqual(s.bot_token, self.BOT)
        self.assertEqual(s.owner_id, C.EGASI_TG_ID)
        self.assertTrue(s.use_cli)
        self.assertEqual(s.database_url, "postgresql://user:pass@localhost/xon_tranzactions")
        self.assertEqual(s.agents_db_url, s.database_url)
        self.assertEqual(s.facts_db_url, s.database_url)
        self.assertEqual(s.claude_cmd, "claude")
        self.assertEqual(s.model_strong, config.MODEL_STRONG_DEFAULT)
        self.assertEqual(s.model_fast, config.MODEL_FAST_DEFAULT)
        self.assertEqual(s.daily_cap, C.AGENT_DAILY_CAP_DEFAULT)
        self.assertEqual(s.timeout_s, C.AGENT_TIMEOUT_DEFAULT_S)
        self.assertEqual(s.deploy_lock, config.DEPLOY_LOCK_DEFAULT)
        self.assertEqual(config.config_errors(), [])

    def test_repr_sirlarni_yashiradi(self):
        self.use(self._toliq())
        s = config.get_settings()
        for text in (repr(s), str(s)):
            self.assertNotIn(self.BOT, text)
            self.assertNotIn(self.SETUP, text)
            self.assertNotIn("user:pass", text)

    def test_facts_url_alohida(self):
        self.use(self._toliq(AGENTS_FACTS_DB_URL="postgresql://ro:x@localhost/xon_tranzactions?schema=public"))
        s = config.get_settings()
        self.assertEqual(s.facts_db_url, "postgresql://ro:x@localhost/xon_tranzactions")
        self.assertEqual(s.agents_db_url, "postgresql://user:pass@localhost/xon_tranzactions")

    def test_xatolar(self):
        self.use("")
        errs = " | ".join(config.config_errors())
        self.assertIn("LEADER_BOT_TOKEN", errs)
        self.assertIn("AGENTS_USE_CLI", errs)
        self.assertIn("ANTHROPIC_SETUP_TOKEN", errs)
        # LEADER_TG_ID yo'q -> egasi ID si (xato emas)
        self.assertEqual(config.get_settings().owner_id, C.EGASI_TG_ID)

    def test_boshqa_egasi_xato(self):
        self.use(self._toliq(LEADER_TG_ID="123"))
        self.assertTrue(any("LEADER_TG_ID" in e for e in config.config_errors()))

    def test_use_cli_faqat_1(self):
        self.use(self._toliq(AGENTS_USE_CLI="true"))
        self.assertFalse(config.get_settings().use_cli)

    def test_timeout(self):
        self.use(self._toliq(AGENT_TIMEOUT_S="200", AGENT_TIMEOUT_S_SUPPORT="600"))
        self.assertEqual(config.agent_timeout_s("support"), 600)
        self.assertEqual(config.agent_timeout_s("leader"), 200)

    def test_timeout_default_180(self):
        self.use(self._toliq())
        self.assertEqual(config.agent_timeout_s("teacher"), 180)


class SafeRepoPathTest(unittest.TestCase):
    """Q3 + loyiha: himoyalangan ro'yxatda agents/claude_settings.json."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self.tmp.name) / "repo"
        for rel in ("README.md", "backend/src/main.ts", "agents/knowledge/CHANGELOG.md", ".git/config"):
            write_file(self.repo, rel, "x\n")

    def tearDown(self):
        self.tmp.cleanup()

    def check(self, p):
        return config.safe_repo_path(p, repo=self.repo)

    def test_ruxsat(self):
        for p, rel in (
            ("README.md", "README.md"),
            ("backend/src/main.ts", "backend/src/main.ts"),
            ("./agents/knowledge/CHANGELOG.md", "agents/knowledge/CHANGELOG.md"),
            ("docs/yangi.md", "docs/yangi.md"),
            ("agents/runner.py", "agents/runner.py"),
            ("agents/memory/INDEX.md", "agents/memory/INDEX.md"),
        ):
            r = self.check(p)
            self.assertTrue(r.ok, p)
            self.assertIsNone(r.reason)
            self.assertEqual(r.rel, rel)
            self.assertEqual(Path(r.abs), Path(os.path.realpath(str(self.repo / rel))))

    def test_env(self):
        for p in (".env", "backend/.env", "frontend/.env.local", "backend/.ENV", "x/.env.example", ".envrc"):
            r = self.check(p)
            self.assertFalse(r.ok, p)
            self.assertEqual(r.reason, "env", p)

    def test_himoya(self):
        for p in (
            ".git/config", ".claude/settings.json", "venv/lib/x.py", ".venv/x", "node_modules/a/b.js",
            "backend/node_modules/x.js", "agents/__pycache__/x.pyc", "agents/state/support_facts.json",
            "agents/state", "static/tg_uploads/leader_bot_ab.jpg", "agents/claude_settings.json",
            "agents/memory/learned.md", "agents/memory/leader-runtime.md", "agents/memory/daily/2026-09-28.md",
            "Agents/State/x.json",
        ):
            r = self.check(p)
            self.assertFalse(r.ok, p)
            self.assertEqual(r.reason, "himoya", p)

    def test_yaroqsiz(self):
        for p in ("", "/etc/passwd", "~/x", "-rf", "../x", "a/../../x", "a/../b.md", "C:/x", "a\\b", "a\x00b"):
            r = self.check(p)
            self.assertFalse(r.ok, repr(p))
            self.assertEqual(r.reason, "yaroqsiz", repr(p))

    @unittest.skipUnless(IS_POSIX, "symlink POSIX'da")
    def test_symlink_tashqariga(self):
        outside = Path(self.tmp.name) / "tashqi"
        outside.mkdir()
        os.symlink(str(outside), str(self.repo / "link"))
        r = self.check("link/x.md")
        self.assertFalse(r.ok)
        self.assertEqual(r.reason, "yaroqsiz")

    @unittest.skipUnless(IS_POSIX, "symlink POSIX'da")
    def test_symlink_git_ichiga(self):
        os.symlink(str(self.repo / ".git"), str(self.repo / "lnk"))
        r = self.check("lnk/config")
        self.assertFalse(r.ok)
        self.assertEqual(r.reason, "himoya")

    def test_sezgir(self):
        for p in ("agents/runner.py", "agents/bin/bash_guard.py", "agents/leader_bot.py", "agents/reja.py",
                  "scripts/deploy.sh", "agents/deploy/xon-tranzactions-leader.service",
                  "backend/prisma/schema.prisma", "backend/src/auth/auth.service.ts", ".gitignore"):
            self.assertTrue(config.is_sensitive(p), p)
        for p in ("README.md", "backend/src/sync/sync.service.ts", "agents/knowledge/CHANGELOG.md"):
            self.assertFalse(config.is_sensitive(p), p)

    def test_rel_to_repo(self):
        self.assertEqual(config.rel_to_repo(self.repo / "backend" / "src" / "main.ts", repo=self.repo), "backend/src/main.ts")


class VaqtTest(unittest.TestCase):
    DT = datetime(2026, 9, 28, 7, 5, tzinfo=UTC)  # Toshkent 12:05, dushanba

    def test_tz(self):
        self.assertEqual(config.TZ_LOCAL.utcoffset(None), timedelta(hours=5))

    def test_now_line(self):
        self.assertEqual(config.now_line(self.DT), "[HOZIRGI VAQT (Toshkent): 2026-09-28 12:05 " + chr(0x2014) + " dushanba]")

    def test_weekday(self):
        self.assertEqual(config.weekday_uz(date(2026, 9, 28)), "dushanba")
        self.assertEqual(config.weekday_uz(date(2026, 10, 4)), "yakshanba")

    def test_kun_chegarasi(self):
        start, end = config.local_day_bounds_utc(date(2026, 9, 28))
        self.assertEqual(start, datetime(2026, 9, 27, 19, 0, tzinfo=UTC))
        self.assertEqual(end, datetime(2026, 9, 28, 19, 0, tzinfo=UTC))

    def test_oynalar(self):
        d = date(2026, 9, 28)
        self.assertEqual(config.local_window_utc(d, 0, 6),
                         (datetime(2026, 9, 27, 19, 0, tzinfo=UTC), datetime(2026, 9, 28, 1, 0, tzinfo=UTC)))
        self.assertEqual(config.local_window_utc(d, 18, 24),
                         (datetime(2026, 9, 28, 13, 0, tzinfo=UTC), datetime(2026, 9, 28, 19, 0, tzinfo=UTC)))
        # 4 oyna kunni to'liq, oraliqsiz qoplaydi
        oynalar = [config.local_window_utc(d, a, b) for _, a, b in C.TEACHER_OYNALAR]
        self.assertEqual(oynalar[0][0], config.local_day_bounds_utc(d)[0])
        self.assertEqual(oynalar[-1][1], config.local_day_bounds_utc(d)[1])
        for (_, e1), (s2, _) in zip(oynalar, oynalar[1:]):
            self.assertEqual(e1, s2)

    def test_seconds_until(self):
        self.assertEqual(config.seconds_until_local(22, 30, now=self.DT), 10 * 3600 + 25 * 60)
        late = datetime(2026, 9, 28, 18, 0, tzinfo=UTC)  # Toshkent 23:00
        self.assertEqual(config.seconds_until_local(22, 30, now=late), 23.5 * 3600)

    def test_naive_va_iso(self):
        n = config.naive_utc(datetime(2026, 9, 28, 12, 5, tzinfo=config.TZ_LOCAL))
        self.assertIsNone(n.tzinfo)
        self.assertEqual(n, datetime(2026, 9, 28, 7, 5))
        self.assertEqual(config.iso_utc(self.DT), "2026-09-28T07:05:00+00:00")
        self.assertEqual(config.parse_iso("2026-09-28T07:05:00Z"), self.DT)
        self.assertEqual(config.parse_iso("2026-09-28T07:05:00"), self.DT)
        self.assertIsNone(config.parse_iso("buzuq"))
        self.assertIsNone(config.parse_iso(""))
        self.assertEqual(config.fmt_local(self.DT), "2026-09-28 12:05")
        self.assertEqual(config.fmt_local(None), "")


class YollarTest(unittest.TestCase):
    def test_yollar(self):
        self.assertEqual(config.SETTINGS_FILE, config.REPO / "agents" / "claude_settings.json")
        self.assertEqual(config.BASH_GUARD, config.REPO / "agents" / "bin" / "bash_guard.py")
        self.assertEqual(config.UPLOADS_DIR, config.REPO / "static" / "tg_uploads")
        self.assertEqual(config.FACTS_PATH, config.REPO / "agents" / "state" / "support_facts.json")
        self.assertEqual(config.DEPLOY_LOCK_DEFAULT, "/var/run/xon-tranzactions-deploy.lock")


class OpsFayllarTest(unittest.TestCase):
    """systemd unit, requirements, .gitignore va agent sozlamasi (KOD 2.3, R8, BOT_INTERFEYS 7)."""

    @staticmethod
    def _oqi(rel: str) -> str:
        path = config.AGENTS_DIR / rel
        if not path.exists():
            raise unittest.SkipTest("fayl yo'q: agents/" + rel)
        return path.read_text(encoding="utf-8")

    def test_systemd_unit(self):
        lines = [ln.strip() for ln in self._oqi("deploy/xon-tranzactions-leader.service").splitlines()]
        kv = [ln for ln in lines if ln and not ln.startswith("#")]
        for need in ("User=root", "WorkingDirectory=/var/www/xon_tranzactions", "Restart=always",
                     "Environment=TZ=Asia/Tashkent",
                     "Environment=AGENTS_ENV_FILE=/var/www/xon_tranzactions/backend/.env"):
            self.assertIn(need, kv)
        exec_start = [ln for ln in kv if ln.startswith("ExecStart=")]
        self.assertEqual(len(exec_start), 1)
        self.assertTrue(exec_start[0].endswith("/bin/python -m agents.leader_bot"), exec_start[0])
        # backend sirlari jarayon env'iga kirmasin
        self.assertFalse([ln for ln in kv if ln.startswith("EnvironmentFile")])
        self.assertFalse(C.has_secret("\n".join(kv)))

    def test_requirements(self):
        reqs = [ln.strip() for ln in self._oqi("requirements.txt").splitlines()
                if ln.strip() and not ln.startswith("#")]
        self.assertIn("aiogram>=3.4,<4", reqs)
        self.assertIn("psycopg2-binary>=2.9,<3", reqs)

    def test_gitignore(self):
        text = self._oqi(".gitignore")
        for need in ("/state/", "/memory/leader-runtime.md", "/memory/learned.md", "/memory/daily/", "__pycache__/"):
            self.assertIn(need, text.splitlines())

    def test_claude_settings(self):
        data = json.loads(self._oqi("claude_settings.json"))
        deny = data["permissions"]["deny"]
        for need in ("Read(**/.env*)", "Read(//proc/**)", "Read(//etc/**)", "Edit", "Write",
                     "Edit(**/.env*)", "Edit(**/.git/**)"):
            self.assertIn(need, deny)
        hooks = data["hooks"]["PreToolUse"]
        self.assertIn(
            {"matcher": "Bash", "hooks": [{"type": "command", "command": "python3 agents/bin/bash_guard.py"}]},
            hooks,
        )
        self.assertEqual(config.safe_repo_path("agents/claude_settings.json").reason, "himoya")


if __name__ == "__main__":
    unittest.main()
