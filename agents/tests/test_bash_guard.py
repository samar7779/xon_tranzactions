"""agents/bin/bash_guard.py: PreToolUse hook (Q1, KOD 2.3, README 9).

Faqat `git log|show|diff|status|blame ...` va `python3 -m py_compile <repo ichidagi .py>` o'tadi.
Hook fayli yo'l bo'yicha yuklanadi: u agents.* ni import qilmaydi va agent foydalanuvchisi
uni `python3 agents/bin/bash_guard.py` bilan alohida ishga tushiradi.
"""
from __future__ import annotations

import importlib.util
import io
import json
import subprocess
import sys
import unittest
from unittest import mock

from agents import config


def _load_guard():
    spec = importlib.util.spec_from_file_location("agents_bash_guard_test", str(config.BASH_GUARD))
    if spec is None or spec.loader is None:
        raise ImportError("bash_guard yuklanmadi: " + str(config.BASH_GUARD))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


guard = _load_guard()
REPO = str(config.REPO)

# README 9 va BOT_INTERFEYS 2.4: shular o'tishi SHART
RUXSAT = (
    "git log -3",
    "git log",
    "git status",
    "git status --porcelain",
    "git log --since=7.days --no-merges --oneline",
    "git log -S amount --format=%h",
    "git log --grep=fix -5",
    "git show HEAD",
    "git show HEAD~1 --stat",
    "git show HEAD:backend/prisma/schema.prisma",
    "git diff",
    "git diff HEAD~3 HEAD --stat",
    "git diff HEAD -- backend/src/sync/sync.service.ts",
    "git blame agents/runner.py",
    "git blame -L 10,20 backend/src/main.ts",
    "python3 -m py_compile agents/runner.py",
    "python3 -m py_compile agents/runner.py agents/config.py",
)

# README 9 va BOT_INTERFEYS 2.4 ro'yxati + qo'shimcha teshiklar: hammasi RAD
RAD = (
    # README 9
    "curl x",
    "curl https://example.com",
    "git diff --no-index /dev/null .env",
    "git log -1 --output=x",
    "git log --outp=x",
    "git diff ~/.bashrc README.md",
    "git blame --contents=/etc/hostname README.md",
    "git blame --contents ~/.bashrc README.md",
    # BOT_INTERFEYS 2.4
    "git -c alias.x=!sh x",
    "git log | head",
    "cd x && git log",
    "python3 -c 1",
    "python3 -m py_compile /etc/x.py",
    "python3 -m py_compile ../x.py",
    # global flag va noma'lum subbuyruq
    "git -C /tmp log",
    "git --no-pager log",
    "git --git-dir=x log",
    "git push origin main",
    "git checkout -- .",
    "git config --global user.name x",
    "git reset --hard",
    "git",
    "/usr/bin/git log",
    "GIT_DIR=x git log",
    "sudo git log",
    "env",
    "cat .env",
    "ls",
    # xavfli flaglar va qisqartmalari
    "git log --output x",
    "git log --o=x",
    "git diff --no-i a b",
    "git diff --ext-diff",
    "git log -p --textconv",
    "git log --text",
    "git log --git-dir=x",
    "git log --work-tree=x",
    "git log --exec-path=x",
    "git grep --open-files-in-pager=x y",
    "git log --open-files",
    "git blame --contents x README.md",
    "git blame --c x README.md",
    "git blame --ignore-revs-file x README.md",
    "git blame --ignore-revs-f=x README.md",
    "git log -C",
    "git log -cx",
    "git diff -O/etc/passwd",
    "git diff -Ox",
    # yo'l va .env
    "git show HEAD:.env",
    "git show HEAD:backend/.env",
    "git show HEAD:backend/.ENV",
    "git log -- .env.local",
    "git log --author=/x",
    "git diff HEAD~1..HEAD",
    "git log ../x",
    "git log -- ~/x",
    "git log -- /etc/passwd",
    # shell metabelgilari
    "git log; id",
    "git log && id",
    "git log || id",
    "git log & id",
    "git log $HOME",
    "git log `id`",
    "git log > x",
    "git log < x",
    "git log (x)",
    "git log\nid",
    "git log\rid",
    # shlex xatosi va bo'sh
    'git log "yopilmagan',
    "",
    "   ",
    # py_compile shakli
    "python3 -m py_compile",
    "python3 -m py_compile agents/x.txt",
    "python3 -m py_compile agents/../../x.py",
    "python3 -m py_compile ~/x.py",
    "python -m py_compile agents/runner.py",
    "python3 -m compileall agents",
    "python3 agents/runner.py",
    # NUL, yolg'iz surrogat va boshqa boshqaruv belgilari (realpath ularda yiqilardi)
    'python3 -m py_compile "a\x00.py" /etc/passwd',
    "python3 -m py_compile a\x00.py agents/runner.py",
    "git log a\x00b",
    "python3 -m py_compile a\ud800.py",
    "git log \ud800",
    "git log \x0bx",
    "git log \x1bx",
    "git log \x7fx",
)


class CheckCommandTest(unittest.TestCase):
    def test_ruxsat(self):
        for cmd in RUXSAT:
            ok, sabab = guard.check_command(cmd, REPO)
            self.assertTrue(ok, "%r rad etildi: %s" % (cmd, sabab))

    def test_rad(self):
        for cmd in RAD:
            ok, sabab = guard.check_command(cmd, REPO)
            self.assertFalse(ok, "%r o'tib ketdi" % (cmd,))
            self.assertTrue(sabab, "%r: sabab bo'sh" % (cmd,))

    def test_yakka_ikki_tire_ruxsat(self):
        # "--" pathspec ajratgich: prefiks tekshiruvi unga qo'llanmaydi
        ok, sabab = guard.check_command("git log -- README.md", REPO)
        self.assertTrue(ok, sabab)

    def test_tab_ruxsat(self):
        ok, sabab = guard.check_command("git log\t-3", REPO)
        self.assertTrue(ok, sabab)

    def test_inside_repo_istisno_bermaydi(self):
        # NUL va surrogat: realpath (Linux) ValueError/UnicodeEncodeError beradi, bu False bo'lishi kerak
        for yol in ("a\x00.py", "a\ud800.py"):
            self.assertFalse(guard._inside_repo(yol, REPO), repr(yol))
            ok, _ = guard._check_py_compile([yol], REPO)
            self.assertFalse(ok, repr(yol))


class HookMainTest(unittest.TestCase):
    """main(): stdin JSON -> exit 0 (ruxsat) yoki 2 (rad, sabab stderr'da)."""

    @staticmethod
    def _run(payload) -> subprocess.CompletedProcess:
        data = payload if isinstance(payload, str) else json.dumps(payload)
        return subprocess.run(
            [sys.executable, str(config.BASH_GUARD)], input=data, cwd=REPO,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8",
            errors="replace", timeout=30,
        )

    @staticmethod
    def _bash(cmd: str) -> dict:
        # Claude Code PreToolUse JSON'iga o'xshash (qo'shimcha kalitlar bilan)
        return {
            "session_id": "test", "cwd": REPO, "hook_event_name": "PreToolUse",
            "tool_name": "Bash", "tool_input": {"command": cmd, "description": "test"},
        }

    def test_ruxsat_exit_0(self):
        proc = self._run(self._bash("git log -3"))
        self.assertEqual(proc.returncode, 0, proc.stderr)

    def test_rad_exit_2(self):
        for cmd in ("curl x", "git log --outp=x", "git diff --no-index /dev/null .env"):
            proc = self._run(self._bash(cmd))
            self.assertEqual(proc.returncode, 2, cmd)
            self.assertIn("bash_guard", proc.stderr, cmd)

    def test_boshqa_asbob_otadi(self):
        proc = self._run({"tool_name": "Read", "tool_input": {"file_path": "README.md"}})
        self.assertEqual(proc.returncode, 0, proc.stderr)

    def test_buzuq_json_rad(self):
        proc = self._run("{buzuq json")
        self.assertEqual(proc.returncode, 2)

    def test_nul_va_surrogat_exit_2(self):
        # json.dumps ularni \u0000 va \ud800 qilib yozadi, hook esa asl belgini oladi
        for cmd in (
            'python3 -m py_compile "a\x00.py" /etc/passwd',
            "python3 -m py_compile a\ud800.py",
            "python3 -m py_compile a\ud800.py /etc/passwd",
        ):
            proc = self._run(self._bash(cmd))
            self.assertEqual(proc.returncode, 2, "%r: %s" % (cmd, proc.stderr))
            self.assertIn("bash_guard", proc.stderr, repr(cmd))

    def test_chuqur_json_exit_2(self):
        # json.loads RecursionError beradi: fail-closed, exit 1 emas
        proc = self._run("[" * 200000 + "]" * 200000)
        self.assertEqual(proc.returncode, 2, proc.stderr[-300:])


class FailClosedTest(unittest.TestCase):
    """main(): kutilmagan istisno ham exit 2 (CLI 2 dan boshqa kodni bloklamaydi)."""

    def test_ichki_xato_rad(self):
        payload = json.dumps({"tool_name": "Bash", "tool_input": {"command": "git log -3"}})
        stdin = io.TextIOWrapper(io.BytesIO(payload.encode("utf-8")), encoding="utf-8")
        stderr = io.TextIOWrapper(io.BytesIO(), encoding="utf-8")

        def _yiqil(cmd, repo):
            raise RuntimeError("sinov")

        with mock.patch.object(guard, "check_command", _yiqil), \
                mock.patch.object(sys, "argv", ["bash_guard.py"]), \
                mock.patch.object(sys, "stdin", stdin), \
                mock.patch.object(sys, "stderr", stderr):
            kod = guard.main()
        self.assertEqual(kod, 2)
        stderr.flush()
        self.assertIn(b"ichki xato", stderr.buffer.getvalue())


if __name__ == "__main__":
    unittest.main()
