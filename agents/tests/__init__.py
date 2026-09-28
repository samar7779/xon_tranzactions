"""agents/ unit testlari: faqat stdlib, DB, tarmoq va aiogram'siz.

Ishga tushirish (repo ildizidan):
    python3 -m unittest discover -s agents/tests -t .

Testlar DB'ga ulanmaydi, Telegram'ga yozmaydi, haqiqiy repo'ni o'zgartirmaydi:
git kerak bo'lgan testlar vaqtinchalik papkada o'z repo'sini quradi.
Token qiymati testlarda yo'q: sirga o'xshash namuna matnlar ish vaqtida yig'iladi
(manba faylida token ko'rinishidagi literal bo'lmasin, secret scanner push'ni to'xtatmasin).
"""
from __future__ import annotations

import importlib
import logging
import os
import shutil
import subprocess
import unittest
from pathlib import Path
from types import ModuleType
from typing import Dict, Union

# Modul loglari (kutilgan ogohlantirishlar) test chiqishini to'ldirmasin.
# Ko'rish kerak bo'lsa: AGENTS_TEST_LOG=1 python3 -m unittest discover -s agents/tests -t .
if os.environ.get("AGENTS_TEST_LOG") != "1":
    logging.getLogger("agents").addHandler(logging.NullHandler())
    logging.getLogger("agents").propagate = False

# Windows'da yo'q POSIX modullari. Faqat shular yetishmasa (va faqat Windows'da) test o'tkazib yuboriladi.
POSIX_ONLY_MODULES = frozenset({"fcntl", "pwd", "grp", "resource", "termios"})
IS_POSIX = os.name == "posix"
HAS_GIT = shutil.which("git") is not None


def import_or_skip(modname: str) -> ModuleType:
    """Modulni import qiladi. Windows'da POSIX moduli yetishmasa SkipTest, boshqa har xato yiqitadi."""
    try:
        return importlib.import_module(modname)
    except ModuleNotFoundError as exc:
        if not IS_POSIX and exc.name in POSIX_ONLY_MODULES:
            raise unittest.SkipTest("%s: POSIX moduli kerak (%s)" % (modname, exc.name))
        raise


def is_root() -> bool:
    return hasattr(os, "geteuid") and os.geteuid() == 0


def git(repo: Union[str, Path], *args: str, check: bool = True) -> str:
    """Test repo'sida git (tizim sozlamasisiz, parol so'ramaydi)."""
    env = dict(os.environ, GIT_TERMINAL_PROMPT="0", GIT_CONFIG_NOSYSTEM="1")
    proc = subprocess.run(
        ["git", *args], cwd=str(repo), env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        stdin=subprocess.DEVNULL, text=True, encoding="utf-8", errors="replace",
    )
    if check and proc.returncode != 0:
        raise AssertionError("git %s: %s" % (" ".join(args), proc.stderr.strip()))
    return proc.stdout.strip()


def write_file(root: Union[str, Path], rel: str, data: Union[str, bytes]) -> Path:
    path = Path(root) / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(data, bytes):
        path.write_bytes(data)
    else:
        with open(path, "w", encoding="utf-8", newline="") as fh:
            fh.write(data)
    return path


def make_git_repo(root: Union[str, Path], files: Dict[str, Union[str, bytes]]) -> Path:
    """Vaqtinchalik git repo: branch main, bitta boshlang'ich commit."""
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    git(root, "init", "-q")
    git(root, "symbolic-ref", "HEAD", "refs/heads/main")
    git(root, "config", "user.name", "Agents Test")
    git(root, "config", "user.email", "agents-test@example.invalid")
    git(root, "config", "commit.gpgsign", "false")
    git(root, "config", "core.autocrlf", "false")
    for rel, data in files.items():
        write_file(root, rel, data)
    git(root, "add", "-A")  # faqat test repo'si
    git(root, "commit", "-q", "-m", "init")
    return root


def commit_count(repo: Union[str, Path]) -> int:
    return int(git(repo, "rev-list", "--count", "HEAD"))


def fake_secret(kind: str) -> str:
    """Sirga o'xshash NAMUNA (haqiqiy emas). join ish vaqtida yig'adi: .py va .pyc da butun literal yo'q."""
    parts = {
        "anthropic": ["sk", "-", "ant", "-", "oat01", "-", "x" * 24],
        "telegram": ["12345", "6789", ":", "A" * 35],
        "parol": ["parol", ": ", "Sinov", "123"],
        "url": ["postgresql", "://", "user", ":", "pw", "@", "localhost/db"],
    }
    if kind not in parts:
        raise ValueError(kind)
    return "".join(parts[kind])
