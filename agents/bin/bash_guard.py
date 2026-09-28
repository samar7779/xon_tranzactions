"""Bash qo'riqchisi: Claude Code PreToolUse hook (matcher: Bash). Q1, KOD 2.3, 8#2.

Faqat shu ikki shakl o'tadi:
  git log|show|diff|status|blame ...
  python3 -m py_compile <repo ichidagi .py fayl> [...]
Qolgani rad: sabab stderr'ga, exit 2 (CLI buyruqni bajarmaydi, bypass rejimida ham).

settings.json dagi Bash allow'lari himoya EMAS, haqiqiy to'siq shu fayl.
Faqat stdlib, agents.* import qilinmaydi (agent foydalanuvchisi va minimal env ostida ishlaydi).

Qo'lda sinash:  python3 agents/bin/bash_guard.py --check "git log -3"
"""
from __future__ import annotations

import json
import os
import shlex
import sys
from pathlib import Path
from typing import List, Tuple

REPO = Path(__file__).resolve().parents[2]

# 1. Shell metabelgilari (Q1) + qattiqlik: {} brace expansion, * ? [ ] glob.
#    Masalan `git log {--output=x,-1}` bash'da `--output=x` ga aylanadi, shlex esa buni ko'rmaydi.
META_CHARS = frozenset(";|&$`><()\n\r" + "{}*?[]")

GIT_SUBS = frozenset({"log", "show", "diff", "status", "blame"})

# 4. Taqiqlangan qisqa flaglar (qiymat yopishgan shakli ham: -O<fayl>)
SHORT_BAD = ("-c", "-C", "-O")

# 5. Taqiqlangan uzun flaglar. Git noaniq bo'lmagan prefiksni qabul qiladi (--outp = --output),
#    shuning uchun argumentning '=' gacha qismi shu nomlardan birining PREFIKSI bo'lsa rad.
LONG_BAD = (
    "--output", "--no-index", "--ext-diff", "--textconv", "--git-dir", "--work-tree",
    "--exec-path", "--open-files-in-pager", "--contents", "--ignore-revs-file",
    "--orderfile",  # -O ning uzun shakli
)

PREFIX = "bash_guard: ruxsat yo'q — "


def _path_problem(value: str) -> str:
    """6-qoida: .env, absolyut yoki uy papkasi yo'li, '..'. Bo'sh satr = muammo yo'q."""
    if ".env" in value.lower():
        return "maxfiy fayl (.env)"
    if value.startswith("/") or value.startswith("~"):
        return "absolyut yoki uy papkasi yo'li"
    if ".." in value:
        return "yuqori papka (..)"
    return ""


def _arg_problem(arg: str, sub: str) -> str:
    """git argumenti uchun 4-6 qoidalar."""
    # 4. -c, -C, -O (qiymat yopishgan bo'lsa ham)
    if not arg.startswith("--"):
        for bad in SHORT_BAD:
            if arg.startswith(bad):
                return "taqiqlangan flag: " + bad
        # qisqa flagga yopishgan absolyut yo'l: -S/etc/x, -pO/etc/x
        if arg.startswith("-") and len(arg) > 2:
            body = arg[1:]
            i = 0
            while i < len(body) and body[i].isalnum():
                i += 1
            if i < len(body) and body[i] in "/~":
                return "absolyut yoki uy papkasi yo'li"
        # blame -S <revs-fayl>: fayl mazmunini xato matnida chiqarishi mumkin
        if sub == "blame" and arg.startswith("-S"):
            return "taqiqlangan flag: -S"
    # 5. uzun flag va uning qisqartmasi
    name = arg.split("=", 1)[0]
    if name != "--" and name.startswith("--"):
        for bad in LONG_BAD:
            if bad.startswith(name):
                return "taqiqlangan flag: " + name
    # 6. argumentning o'zi va '=' dan keyingi qismi
    parts = [arg]
    if "=" in arg:
        parts.append(arg.split("=", 1)[1])
    for part in parts:
        problem = _path_problem(part)
        if problem:
            return problem
    return ""


def _inside_repo(path: str, repo: str) -> bool:
    if "\x00" in path:  # Windows realpath NUL'da yiqilmaydi, Linux'da yiqiladi: har joyda bir xil
        return False
    try:
        path.encode("utf-8")  # yolg'iz surrogat -> UnicodeEncodeError (ValueError)
        base = os.path.realpath(repo)
        target = os.path.realpath(os.path.join(base, path))
        return os.path.commonpath([base, target]) == base
    except (ValueError, OSError):  # NUL, surrogat, boshqa disk (Windows) va h.k.
        return False


def _check_py_compile(files: List[str], repo: str) -> Tuple[bool, str]:
    if not files:
        return False, "py_compile uchun fayl yo'q"
    for f in files:
        if f.startswith("-"):
            return False, "py_compile: flag ruxsat etilmagan"
        problem = _path_problem(f)
        if problem:
            return False, problem
        if not f.endswith(".py"):
            return False, "faqat .py fayl"
        if not _inside_repo(f, repo):
            return False, "repo tashqarisidagi fayl"
    return True, ""


def check_command(cmd: str, repo: str) -> Tuple[bool, str]:
    """(ruxsat, sabab). Sabab rad bo'lganda qisqa lotin matn."""
    if not isinstance(cmd, str) or not cmd.strip():
        return False, "bo'sh buyruq"
    # 1a. kodlash: yolg'iz surrogat realpath/exec'da istisno beradi, shuning uchun darhol rad
    try:
        cmd.encode("utf-8")
    except UnicodeEncodeError:
        return False, "buyruq kodlashi buzuq (surrogat)"
    # 1b. metabelgi (xom satrda, qo'shtirnoq ichida ham) va boshqaruv belgilari (NUL va h.k.)
    for ch in cmd:
        if ch in META_CHARS:
            shown = {"\n": "yangi qator", "\r": "yangi qator"}.get(ch, ch)
            return False, "shell metabelgisi: " + shown
        if ch == "\x00":
            return False, "NUL belgisi"
        if ch == "\x7f" or (ch < " " and ch != "\t"):
            return False, "boshqaruv belgisi"
    # 2. shlex
    try:
        argv = shlex.split(cmd)
    except ValueError:
        return False, "buyruqni ajratib bo'lmadi"
    if not argv:
        return False, "bo'sh buyruq"
    # 3. faqat ikki shakl
    if argv[0] == "git":
        if len(argv) < 2 or argv[1] not in GIT_SUBS:
            return False, "faqat git log/show/diff/status/blame"
        sub = argv[1]
        for arg in argv[2:]:
            problem = _arg_problem(arg, sub)
            if problem:
                return False, problem
        return True, ""
    if argv[0] == "python3":
        if len(argv) < 3 or argv[1] != "-m" or argv[2] != "py_compile":
            return False, "python3 faqat -m py_compile bilan"
        return _check_py_compile(argv[3:], repo)
    return False, "faqat git log/show/diff/status/blame va python3 -m py_compile"


def _reject(reason: str) -> int:
    """Sababni stderr'ga yozadi va 2 qaytaradi. Hech qachon istisno bermaydi."""
    data = (PREFIX + reason + "\n").encode("utf-8", "replace")
    try:
        sys.stderr.flush()
        sys.stderr.buffer.write(data)  # locale'dan qat'i nazar UTF-8
        sys.stderr.buffer.flush()
    except Exception:
        try:
            sys.stderr.write(data.decode("ascii", "replace"))
            sys.stderr.flush()
        except Exception:
            pass  # sabab yo'qolsa ham exit 2 qoladi
    return 2


def main() -> int:
    """Fail-closed: kutilmagan istisno ham rad (exit 2).

    CLI 2 dan boshqa exit kodini bloklamaydigan xato deb oladi va buyruqni bajaradi,
    shuning uchun traceback bilan exit 1 bo'lishi mumkin emas.
    """
    try:
        return _main()
    except SystemExit:
        raise
    except BaseException:
        return _reject("ichki xato")


def _main() -> int:
    """PreToolUse hook: stdin JSON {"tool_name", "tool_input": {"command"}}."""
    if len(sys.argv) >= 3 and sys.argv[1] == "--check":
        ok, reason = check_command(" ".join(sys.argv[2:]), str(REPO))
        print("RUXSAT" if ok else "RAD: " + reason)
        return 0 if ok else 2
    try:
        raw = sys.stdin.buffer.read()
        data = json.loads(raw.decode("utf-8") or "null")
    except (ValueError, UnicodeDecodeError, OSError):
        return _reject("hook kirishi buzuq")
    if not isinstance(data, dict):
        return _reject("hook kirishi buzuq")
    if data.get("tool_name") != "Bash":
        return 0
    tool_input = data.get("tool_input")
    command = tool_input.get("command") if isinstance(tool_input, dict) else None
    if not isinstance(command, str):
        return _reject("buyruq yo'q")
    ok, reason = check_command(command, str(REPO))
    if ok:
        return 0
    return _reject(reason)


if __name__ == "__main__":
    sys.exit(main())
