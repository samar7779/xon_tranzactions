"""runner.py: egasi qoidasi (CLI subprocess), env oq ro'yxati (Q2), buyruq (KOD 2.2, 2.3),
model tanlash (2.6), memory inject (2.5), SISTEMA (R2).

Uchidan-uchiga sinov haqiqiy `claude` o'rniga soxta skriptni chaqiradi (POSIX): tarmoq, token va
DB ishlatilmaydi. U argv, env, cwd va stdin'ni yozib oladi.
"""
from __future__ import annotations

import json
import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

from agents import config
from agents import contract as C

from . import HAS_GIT, IS_POSIX, git, import_or_skip, is_root, make_git_repo, write_file

runner = import_or_skip("agents.runner")

OQ_ROYXAT = set(C.AGENT_ENV_OS_KEYS) | {C.AGENT_ENV_TOKEN_KEY} | set(C.AGENT_ENV_OPTIONAL_KEYS)
SOXTA_SETUP = "sinov-oauth-qiymati-" + "z" * 12
SOXTA_API_KEY = "sinov-api-kalit-" + "k" * 12
BEGONA_ENV = {
    "ANTHROPIC_API_KEY": SOXTA_API_KEY,
    "ANTHROPIC_SETUP_TOKEN": SOXTA_SETUP,
    "DATABASE_URL": "postgresql://user:pass@localhost/xon_tranzactions?schema=public",
    "LEADER_BOT_TOKEN": "sinov-bot",
    "JWT_SECRET": "sinov-jwt",
    "PGPASSWORD": "sinov-pg",
    "REDIS_URL": "redis://localhost",
    "CRED_ENC_KEY": "sinov-enc",
    "GOOGLE_SA_JSON": "{}",
    "CLAUDE_CODE_OAUTH_TOKEN": "eski-qiymat",
    "PATH": "/usr/local/bin:/usr/bin:/bin",
    "HOME": "/root",
    "LANG": "C.UTF-8",
    "TZ": "Asia/Tashkent",
    "USER": "root",
}


class BuildAgentEnvTest(unittest.TestCase):
    def test_faqat_oq_royxat(self):
        env = runner.build_agent_env(BEGONA_ENV, setup_token="setup-x", agent_user="xonagent",
                                     agent_home="/home/xonagent")
        self.assertTrue(set(env) <= OQ_ROYXAT, sorted(set(env) - OQ_ROYXAT))
        for key in ("ANTHROPIC_API_KEY", "ANTHROPIC_SETUP_TOKEN", "DATABASE_URL", "LEADER_BOT_TOKEN",
                    "JWT_SECRET", "PGPASSWORD", "REDIS_URL", "CRED_ENC_KEY", "GOOGLE_SA_JSON"):
            self.assertNotIn(key, env)
        self.assertEqual(env[C.AGENT_ENV_TOKEN_KEY], "setup-x")
        self.assertEqual(env["HOME"], "/home/xonagent")
        self.assertEqual(env["USER"], "xonagent")
        self.assertNotIn(SOXTA_API_KEY, json.dumps(env))

    def test_default_qiymatlar(self):
        env = runner.build_agent_env({"ANTHROPIC_API_KEY": "x"}, setup_token="t", agent_home="/home/a")
        for key in ("PATH", "HOME", "LANG", "TZ"):
            self.assertTrue(env.get(key), key)
        self.assertEqual(env["TZ"], "Asia/Tashkent")
        self.assertNotIn("ANTHROPIC_API_KEY", env)

    def test_home_manbadan(self):
        env = runner.build_agent_env({"HOME": "/root", "PATH": "/bin"}, setup_token="t")
        self.assertEqual(env["HOME"], "/root")
        self.assertEqual(env["PATH"], "/bin")

    def test_base_url_ixtiyoriy(self):
        env = runner.build_agent_env({}, setup_token="t", agent_home="/h")
        self.assertNotIn("ANTHROPIC_BASE_URL", env)
        env = runner.build_agent_env({}, setup_token="t", agent_home="/h", base_url="http://127.0.0.1:9")
        self.assertEqual(env["ANTHROPIC_BASE_URL"], "http://127.0.0.1:9")


class BuildCliCmdTest(unittest.TestCase):
    def cmd(self, **kw):
        base = dict(claude_cmd="claude", model="claude-opus-5-5", disallowed=C.DISALLOWED_TOOLS["support"],
                    task="-x bilan boshlanadigan topshiriq", settings_file="/r/agents/claude_settings.json")
        base.update(kw)
        return runner.build_cli_cmd(**base)

    def test_egasi_qoidasi_asosi(self):
        cmd = self.cmd(system_prompt="SP matni")
        self.assertEqual(cmd[0], "claude")
        self.assertIn("--print", cmd)
        self.assertIn("--dangerously-skip-permissions", cmd)
        self.assertEqual(cmd[cmd.index("--model") + 1], "claude-opus-5-5")
        self.assertEqual(cmd[cmd.index("--append-system-prompt") + 1], "SP matni")
        self.assertEqual(cmd[cmd.index("--settings") + 1], "/r/agents/claude_settings.json")

    def test_bitta_disallowed_argument(self):
        cmd = self.cmd(system_prompt="SP")
        self.assertEqual(cmd.count("--disallowedTools"), 1)
        self.assertEqual(cmd[cmd.index("--disallowedTools") + 1], C.DISALLOWED_TOOLS["support"])

    def test_ikki_tire_va_task_oxirida(self):
        cmd = self.cmd(system_prompt="SP")
        self.assertEqual(cmd[-2:], ["--", "-x bilan boshlanadigan topshiriq"])
        self.assertEqual(cmd.count("--"), 1)
        flags = [i for i, a in enumerate(cmd[:-1]) if a.startswith("--") and a != "--"]
        self.assertTrue(all(i < len(cmd) - 2 for i in flags))

    def test_prompt_fayli(self):
        cmd = self.cmd(system_prompt_file="/r/agents/state/cli/sp_ab.md")
        self.assertEqual(cmd[cmd.index("--append-system-prompt-file") + 1], "/r/agents/state/cli/sp_ab.md")
        self.assertNotIn("--append-system-prompt", cmd)

    def test_settingssiz_va_session(self):
        cmd = self.cmd(settings_file=None, system_prompt="SP", no_session=True)
        self.assertNotIn("--settings", cmd)
        self.assertIn("--no-session-persistence", cmd)
        self.assertLess(cmd.index("--no-session-persistence"), cmd.index("--"))

    def test_token_argvda_yoq(self):
        cmd = self.cmd(system_prompt="SP")
        self.assertFalse(any("ANTHROPIC" in a or "OAUTH" in a for a in cmd))

    def test_uzun_argv_kesiladi(self):
        cmd = self.cmd(system_prompt="S" * (C.ARGV_MAX_BYTES + 5000), task="T" * (C.ARGV_MAX_BYTES + 5000))
        for arg in cmd:
            self.assertLessEqual(len(arg.encode("utf-8")), C.ARGV_MAX_BYTES)


class ToolsVaModelTest(unittest.TestCase):
    def test_disallowed(self):
        for agent in C.AGENTS:
            self.assertEqual(runner.agent_disallowed_tools(agent), C.DISALLOWED_TOOLS[agent])
        self.assertEqual(runner.agent_disallowed_tools("noma'lum"), C.DISALLOWED_TOOLS["leader"])
        self.assertIn("Bash", runner.agent_disallowed_tools("teacher").split())

    def test_pick_model(self):
        s = config.get_settings()
        self.assertEqual(runner.pick_model({"model": "sonnet"}), s.model_fast)
        self.assertEqual(runner.pick_model({"model": "opus"}), s.model_strong)
        self.assertEqual(runner.pick_model({"model": "claude-haiku-9"}), "claude-haiku-9")
        self.assertEqual(runner.pick_model({"complexity": "simple"}), s.model_fast)
        self.assertEqual(runner.pick_model({"complexity": "strong"}), s.model_strong)
        self.assertEqual(runner.pick_model(None), s.model_strong)
        self.assertEqual(runner.pick_model({}), s.model_strong)
        self.assertEqual(runner.pick_model({"model": "yomon model; rm -rf"}), s.model_strong)

    def test_require_cli_mode(self):
        with mock.patch.dict(os.environ, {"AGENTS_USE_CLI": "0"}):
            config.reload_env()
            try:
                with self.assertRaises(SystemExit):
                    runner.require_cli_mode()
            finally:
                config.reload_env()


class SistemaForTest(unittest.TestCase):
    def test_holatlar(self):
        R = runner.AgentResult
        EM = chr(0x2014)
        self.assertEqual(
            runner.sistema_for(R(agent="support", status=C.RUN_TIMEOUT, error=C.XATO_TIMEOUT_TPL.format(n=180))),
            "support agent XATOGA UCHRADI: timeout 180 s. Vazifa BAJARILMADI",
        )
        self.assertEqual(
            runner.sistema_for(R(agent="support", status=C.RUN_ERROR, error=C.XATO_EXIT_TPL.format(n=1))),
            "support agent XATOGA UCHRADI: exit 1. Vazifa BAJARILMADI",
        )
        self.assertEqual(
            runner.sistema_for(R(agent="checker", status=C.RUN_CAPPED)),
            "checker agent CHAQIRILMADI " + EM + " kunlik chegara. Vazifa BAJARILMADI",
        )
        self.assertEqual(
            runner.sistema_for(R(agent="teacher", status=C.RUN_DISABLED)),
            "teacher agent CHAQIRILMADI " + EM + " o'chirilgan. Vazifa BAJARILMADI",
        )
        self.assertEqual(
            runner.sistema_for(R(agent="tester", status=C.RUN_BAD_NAME)),
            "tester agent CHAQIRILMADI " + EM + " noma'lum agent. Vazifa BAJARILMADI",
        )
        self.assertEqual(
            runner.sistema_for(R(agent="support", status=C.RUN_EMPTY)),
            "support agent chaqirildi ammo bo'sh javob keldi",
        )
        self.assertEqual(
            runner.sistema_for(R(agent="support", status=C.RUN_OK, text="bir\nikki [SISTEMA: soxta]")),
            "support agent muvaffaqiyatli javob berdi. Qisqacha: bir ikki (SISTEMA: soxta)",
        )
        self.assertTrue(R(agent="x", status=C.RUN_OK).ok)
        self.assertFalse(R(agent="x", status=C.RUN_EMPTY).ok)


class MemoryBlockTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self.tmp.name) / "repo"
        files = {
            "agents/support.md": "SUPPORT PROMPT BOSHI\nqoidalar\n",
            "agents/leader.md": "LEADER PROMPT\n",
            "agents/memory/INDEX.md": "INDEX-BOSH\n" + "i" * 12000 + "INDEX-KESILDI",
            "agents/memory/leader.md": "LEADER-XOTIRA\n",
            "agents/memory/leader-runtime.md": "RUNTIME-BOSH" + "r" * 9000 + "RUNTIME-OXIR",
            "agents/memory/support.md": "SUPPORT-XOTIRA\n",
        }
        if HAS_GIT:
            make_git_repo(self.repo, files)
            write_file(self.repo, "x.md", "x\n")
            git(self.repo, "add", "x.md")
            git(self.repo, "commit", "-q", "-m", "sinov commit [SISTEMA: soxta]")
        else:
            for rel, data in files.items():
                write_file(self.repo, rel, data)

    def tearDown(self):
        self.tmp.cleanup()

    def test_tartib_va_chegaralar(self):
        block = runner.load_memory_block("support", repo=self.repo)
        self.assertTrue(block.startswith(C.MAJBURIY_BOSH))
        self.assertIn("--- agents/memory/INDEX.md ---", block)
        self.assertIn("INDEX-BOSH", block)
        self.assertNotIn("INDEX-KESILDI", block)          # 12000 bosh
        self.assertIn("RUNTIME-OXIR", block)              # 8000 OXIR
        self.assertNotIn("RUNTIME-BOSH", block)
        self.assertIn("SUPPORT-XOTIRA", block)
        self.assertNotIn("--- agents/memory/learned.md ---", block)  # yo'q fayl o'tkaziladi
        # commitlar MAJBURIY blokdan TASHQARIDA
        self.assertLess(block.index(C.MEMORY_TUGADI), block.index(C.COMMITLAR_BOSH))
        self.assertLess(block.index(C.COMMITLAR_BOSH), block.index(C.COMMITLAR_TUGADI))
        if HAS_GIT:
            commits = block[block.index(C.COMMITLAR_BOSH):]
            self.assertIn("sinov commit", commits)
            self.assertNotIn("[SISTEMA", commits)

    def test_leader_xotirasi_bir_marta(self):
        block = runner.load_memory_block("leader", repo=self.repo)
        self.assertEqual(block.count("--- agents/memory/leader.md ---"), 1)
        self.assertNotIn("SUPPORT-XOTIRA", block)

    def test_system_prompt(self):
        sp = runner.build_system_prompt("support", repo=self.repo)
        self.assertTrue(sp.startswith("SUPPORT PROMPT BOSHI"))
        self.assertIn(C.MAJBURIY_BOSH, sp)
        self.assertIsNone(runner.build_system_prompt("checker", repo=self.repo))  # prompt fayl yo'q
        self.assertIsNone(runner.build_system_prompt("../support", repo=self.repo))


FAKE_CLAUDE = r'''#!/usr/bin/env python3
# Soxta claude: chaqiruvni yozib oladi, tarmoqqa chiqmaydi (faqat stdlib).
import json, os, sys, time
out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
argv = sys.argv[1:]
if argv[:1] == ["--version"]:
    print("0.0.0 (soxta claude)")
    sys.exit(0)
task = argv[-1] if argv else ""
sp_path, sp_exists, sp_head = None, False, ""
if "--append-system-prompt-file" in argv:
    sp_path = argv[argv.index("--append-system-prompt-file") + 1]
    sp_exists = os.path.exists(sp_path)
    if sp_exists:
        with open(sp_path, encoding="utf-8") as fh:
            sp_head = fh.readline().strip()
try:
    stdin_data = sys.stdin.read()
except Exception as exc:
    stdin_data = "XATO:" + exc.__class__.__name__
rec = {{"argv": argv, "env": dict(os.environ), "cwd": os.getcwd(), "stdin": stdin_data,
        "sp_path": sp_path, "sp_exists": sp_exists, "sp_head": sp_head}}
with open(os.path.join(out_dir, "calls.jsonl"), "a", encoding="utf-8") as fh:
    fh.write(json.dumps(rec) + "\n")
if "--model" not in argv:
    print("probe ok")
    sys.exit(0)
if "UXLA" in task:
    time.sleep(60)
if "CHIQ3" in task:
    print("xato: 429 rate_limit_error")
    sys.exit(3)
sys.stderr.write("STDERR-BELGI\n")
sys.stderr.flush()
print("JAVOB-OK")
'''


@unittest.skipUnless(IS_POSIX, "runner subprocess'i POSIX uchun (server)")
class EndToEndFakeCliTest(unittest.TestCase):
    """Egasi qoidasi 1-6: env, stderr=STDOUT, stdin=DEVNULL, HOME, timeout, CLI topilmasa."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name)
        self.out = base / "out"
        self.out.mkdir()
        self.fake = base / "claude"
        self.fake.write_text(FAKE_CLAUDE.format(), encoding="utf-8")
        os.chmod(self.fake, 0o755)
        agent_user = ""
        if is_root():
            # root ostida CLI bypass'ni rad etadi: imtiyozsiz foydalanuvchi kerak
            import pwd
            try:
                pwd.getpwnam("nobody")
            except KeyError:
                self.skipTest("root: 'nobody' foydalanuvchisi yo'q")
            agent_user = "nobody"
            os.chmod(base, 0o755)
            os.chmod(self.out, 0o777)
        env = {
            "AGENTS_ENV_FILE": str(base / "yoq.env"),
            "AGENTS_USE_CLI": "1",
            "ANTHROPIC_SETUP_TOKEN": SOXTA_SETUP,
            "ANTHROPIC_API_KEY": SOXTA_API_KEY,
            "CLAUDE_CMD": str(self.fake),
            "AGENT_OS_USER": agent_user,
            "DATABASE_URL": "",
            "AGENTS_DB_URL": "",
            "AGENTS_FACTS_DB_URL": "",
            "JWT_SECRET": "sinov-jwt",
            "LEADER_BOT_TOKEN": "sinov-bot",
        }
        for key in ("AGENTS_MODEL_STRONG", "AGENTS_MODEL_FAST", "ANTHROPIC_BASE_URL", "AGENT_TIMEOUT_S",
                    "AGENT_TIMEOUT_S_SUPPORT"):
            env[key] = ""
        patcher = mock.patch.dict(os.environ, env)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(self._reset)
        config.reload_env()
        runner.probe_cli(force=True)

    def _reset(self):
        config.reload_env()
        if hasattr(runner, "_probe_cache"):
            runner._probe_cache = None
        self.tmp.cleanup()

    def calls(self):
        path = self.out / "calls.jsonl"
        if not path.exists():
            return []
        rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
        return [r for r in rows if "--model" in r["argv"]]

    def test_muvaffaqiyat(self):
        task = "-chiziq bilan boshlanadigan topshiriq"
        res = runner.run_agent("support", task, {"source": "manual"})
        self.assertEqual(res.status, C.RUN_OK, res.error)
        self.assertIn("JAVOB-OK", res.text)
        self.assertIn("STDERR-BELGI", res.text)             # 2: stderr=STDOUT
        calls = self.calls()
        self.assertEqual(len(calls), 1)
        rec = calls[0]
        argv, env = rec["argv"], rec["env"]
        # 1: env noldan, faqat oq ro'yxat
        extra = set(env) - OQ_ROYXAT - {"PWD", "SHLVL", "_", "LC_CTYPE"}
        self.assertEqual(extra, set(), sorted(extra))
        self.assertEqual(env.get(C.AGENT_ENV_TOKEN_KEY), SOXTA_SETUP)
        for key in ("ANTHROPIC_API_KEY", "ANTHROPIC_SETUP_TOKEN", "DATABASE_URL", "JWT_SECRET", "LEADER_BOT_TOKEN"):
            self.assertNotIn(key, env)
        # 3: stdin=DEVNULL (bo'sh, osilib qolmaydi)
        self.assertEqual(rec["stdin"], "")
        # 4: HOME bor
        self.assertTrue(env.get("HOME"))
        # buyruq
        self.assertIn("--print", argv)
        self.assertIn("--dangerously-skip-permissions", argv)
        self.assertEqual(argv[argv.index("--model") + 1], config.get_settings().model_strong)
        self.assertEqual(argv.count("--disallowedTools"), 1)
        disallowed = argv[argv.index("--disallowedTools") + 1]
        self.assertEqual(argv[-2:], ["--", task])
        self.assertNotIn(SOXTA_SETUP, " ".join(argv))
        if config.SETTINGS_FILE.is_file():
            self.assertEqual(disallowed, C.DISALLOWED_TOOLS["support"])
            self.assertEqual(argv[argv.index("--settings") + 1], str(config.SETTINGS_FILE))
        else:  # sozlama (hook) yo'q: Bash yopilishi shart
            self.assertIn("Bash", disallowed.split())
        if rec["sp_path"]:
            self.assertTrue(rec["sp_exists"])
            first = (config.AGENTS_DIR / "support.md").read_text(encoding="utf-8").splitlines()[0].strip()
            self.assertEqual(rec["sp_head"], first)
            self.assertFalse(os.path.exists(rec["sp_path"]), "system prompt fayli o'chirilmagan")
        self.assertEqual(os.path.realpath(rec["cwd"]), os.path.realpath(str(config.REPO)))

    def test_exit_kodi(self):
        res = runner.run_agent("support", "CHIQ3", {"source": "manual"})
        self.assertEqual(res.status, C.RUN_ERROR)
        self.assertEqual(res.error, C.XATO_EXIT_TPL.format(n=3))
        self.assertEqual(res.returncode, 3)

    def test_timeout(self):  # 5: timeout -> status timeout (eng kami 10 s)
        t0 = time.monotonic()
        res = runner.run_agent("support", "UXLA", {"source": "manual", "timeout_s": 10})
        self.assertEqual(res.status, C.RUN_TIMEOUT)
        self.assertTrue(res.error.startswith("timeout "), res.error)
        self.assertLess(time.monotonic() - t0, 40)

    def test_cli_topilmadi(self):  # 6: FileNotFoundError
        with mock.patch.dict(os.environ, {"CLAUDE_CMD": str(Path(self.tmp.name) / "yoq-claude")}):
            config.reload_env()
            res = runner.run_agent("support", "salom", {"source": "manual"})
        config.reload_env()
        self.assertEqual(res.status, C.RUN_ERROR)
        self.assertEqual(res.error, C.XATO_CLI_YOQ)

    def test_notogri_agent_cli_chaqirilmaydi(self):
        for name in ("../support", "tester", "Leader"):
            res = runner.run_agent(name, "salom", {"source": "manual"})
            self.assertEqual(res.status, C.RUN_BAD_NAME, name)
        self.assertEqual(self.calls(), [])


@unittest.skipUnless(IS_POSIX and is_root(), "faqat root ostida")
class RootBypassTest(unittest.TestCase):
    def test_agent_os_user_bosh(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        env = {"AGENTS_ENV_FILE": str(Path(tmp.name) / "yoq.env"), "AGENTS_USE_CLI": "1",
               "ANTHROPIC_SETUP_TOKEN": SOXTA_SETUP, "AGENT_OS_USER": "", "CLAUDE_CMD": "/bin/false",
               "DATABASE_URL": "", "AGENTS_DB_URL": "", "AGENTS_FACTS_DB_URL": ""}
        with mock.patch.dict(os.environ, env):
            config.reload_env()
            try:
                res = runner.run_agent("support", "salom", {"source": "manual"})
            finally:
                config.reload_env()
        self.assertEqual(res.status, C.RUN_ERROR)
        self.assertEqual(res.error, C.XATO_ROOT_BYPASS)


if __name__ == "__main__":
    unittest.main()
