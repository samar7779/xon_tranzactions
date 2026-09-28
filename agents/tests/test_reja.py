"""reja.py: REQUEST_APPROVAL parse (KOD 3.1), tekshiruv (3.2, 3.4, Q3), payload, preview va
apply_plan (3.3, Q14, D6) vaqtinchalik git repo'da. DB, Telegram va haqiqiy repo ishlatilmaydi.

KOD 9.5 / README 10: `find 2 marta` -> Support APPROVED BAJARILMADI, fayl asl holida, commit yo'q.
"""
from __future__ import annotations

import hashlib
import os
import tempfile
import unittest
import uuid
from datetime import datetime, timezone
from pathlib import Path

from agents import contract as C

from . import HAS_GIT, commit_count, git, import_or_skip, make_git_repo, write_file

reja = import_or_skip("agents.reja")

EM = chr(0x2014)

PLAN_MATN = """files:
  - backend/src/sync/sync.service.ts
  - agents/knowledge/CHANGELOG.md
summary: Son bo'lmagan summa bloklangan
risk: orta
danger_flags:
  - yo'q
edits:
  - file: backend/src/sync/sync.service.ts
    find: <<<FIND
    const amount = Number(item.amount);
    return amount;
FIND
    replace: <<<REPLACE
    const amount = Number(item.amount);
    if (!Number.isFinite(amount)) {
      throw new Error('summa son emas');
    }
    return amount;
REPLACE
  - file: agents/knowledge/CHANGELOG.md
    find: <<<FIND
## 1. Tarix
FIND
    replace: <<<REPLACE
## 1. Tarix
- 2026-09-28 """ + EM + """ summa tekshiruvi """ + EM + """ backend/src/sync/sync.service.ts
REPLACE
test:
  1. Summasi son bo'lmagan yozuv: xato chiqadi
  2. Oddiy sync: avvalgidek ishlaydi
"""


def plan_text(files, edits, summary="Sinov o'zgarishi", risk="past", flags=("yo'q",), test="1. tekshir"):
    """edits: [(file, find, replace)] -> REQUEST_APPROVAL ichi."""
    out = ["files:"] + ["  - " + f for f in files]
    out += ["summary: " + summary, "risk: " + risk, "danger_flags:"] + ["  - " + x for x in flags]
    out.append("edits:")
    for f, find, rep in edits:
        out += ["  - file: " + f, "    find: <<<FIND"]
        out += find.split("\n") if find else []
        out += ["FIND", "    replace: <<<REPLACE"]
        out += rep.split("\n") if rep else []
        out.append("REPLACE")
    out += ["test:", "  " + test]
    return "\n".join(out) + "\n"


class ExtractTest(unittest.TestCase):
    def test_blok_va_qolgan_matn(self):
        text = "## Muammo\nx\n\n[REQUEST_APPROVAL]\n" + PLAN_MATN + "[/REQUEST_APPROVAL]\nOxiri"
        inner, rest = reja.extract_request_approval(text)
        self.assertIn("files:", inner)
        self.assertNotIn("REQUEST_APPROVAL", rest)
        self.assertIn("## Muammo", rest)
        self.assertIn("Oxiri", rest)

    def test_blok_yoq(self):
        inner, rest = reja.extract_request_approval("Oddiy javob")
        self.assertIsNone(inner)
        self.assertEqual(rest.strip(), "Oddiy javob")

    def test_bloksiz_trigger_r4(self):
        for text in ("Tasdiqlaysizmi?", "Tugmani bossangiz qo'llanadi", "[Ha] bosing",
                     "Qo" + chr(0x2018) + "shaymi?", "Davom etaymi", "Ruxsat bering"):
            self.assertTrue(reja.has_blockless_trigger(text), text)
        self.assertFalse(reja.has_blockless_trigger("Sabab topildi: Kapital bank sanani ko'chirgan."))


class ParsePlanTest(unittest.TestCase):
    def test_toliq_namuna(self):
        p = reja.parse_plan(PLAN_MATN)
        self.assertEqual(p.files, ["backend/src/sync/sync.service.ts", "agents/knowledge/CHANGELOG.md"])
        self.assertEqual(p.summary, "Son bo'lmagan summa bloklangan")
        self.assertEqual(p.risk, "orta")
        self.assertEqual(p.danger_flags, [])
        self.assertEqual(len(p.edits), 2)
        e = p.edits[0]
        self.assertEqual(e.file, "backend/src/sync/sync.service.ts")
        self.assertEqual(e.find, "    const amount = Number(item.amount);\n    return amount;")
        self.assertTrue(e.replace.startswith("    const amount"))
        self.assertTrue(e.replace.endswith("    return amount;"))
        self.assertIn("1. Summasi", p.test)
        self.assertIn("2. Oddiy sync", p.test)

    def test_marker_ichida_kalit_qidirilmaydi(self):
        find = "summary: ICHKI\ntest: ICHKI\nfiles:\n- file: ichki.md"
        p = reja.parse_plan(plan_text(["docs/a.md"], [("docs/a.md", find, "yangi")], summary="Tashqi summary"))
        self.assertEqual(p.summary, "Tashqi summary")
        self.assertEqual(p.edits[0].find, find)
        self.assertEqual(p.files, ["docs/a.md"])
        self.assertEqual(len(p.edits), 1)

    def test_boshqa_marker(self):
        text = (
            "files: docs/a.md\nsummary: s\nrisk: past\nedits:\n  - file: docs/a.md\n"
            "    find: <<<END1\nFIND\nREPLACE\nEND1\n    replace: <<<END2\nyangi\nEND2\ntest: t\n"
        )
        p = reja.parse_plan(text)
        self.assertEqual(p.edits[0].find, "FIND\nREPLACE")
        self.assertEqual(p.edits[0].replace, "yangi")

    def test_files_vergulli(self):
        p = reja.parse_plan(plan_text(["x"], [("docs/a.md", "a", "b"), ("docs/b.md", "c", "d")]).replace(
            "files:\n  - x\n", "files: docs/a.md, docs/b.md\n"))
        self.assertEqual(p.files, ["docs/a.md", "docs/b.md"])

    def test_risk(self):
        for raw, kutilgan in (("yuqori", "yuqori"), ("past", "past"), ("o'rta", "past"), ("orta (bir funksiya)", "past")):
            p = reja.parse_plan(plan_text(["docs/a.md"], [("docs/a.md", "a", "b")], risk=raw))
            self.assertEqual(p.risk, kutilgan, raw)

    def test_danger_flags(self):
        p = reja.parse_plan(plan_text(["docs/a.md"], [("docs/a.md", "a", "b")], flags=("XAVF: oplata_kv DELETE 100+ qator",)))
        self.assertEqual(p.danger_flags, ["XAVF: oplata_kv DELETE 100+ qator"])

    def test_yangi_fayl_va_ochirish(self):
        p = reja.parse_plan(plan_text(["docs/yangi.md", "docs/a.md"],
                                      [("docs/yangi.md", "", "mazmun"), ("docs/a.md", "o'chadi", "")]))
        self.assertEqual(p.edits[0].find, "")
        self.assertEqual(p.edits[0].replace, "mazmun")
        self.assertEqual(p.edits[1].replace, "")

    def test_eski_kalitlar_etiborsiz(self):
        text = plan_text(["docs/a.md"], [("docs/a.md", "a", "b")]) + "diff: eski\nteacher_rules_read: ha\n"
        p = reja.parse_plan(text)
        self.assertEqual(len(p.edits), 1)

    def test_buzuq(self):
        buzuq = (
            # replace yo'q
            "files: docs/a.md\nsummary: s\nedits:\n  - file: docs/a.md\n    find: <<<FIND\na\nFIND\ntest: t\n",
            # marker yopilmagan
            "files: docs/a.md\nsummary: s\nedits:\n  - file: docs/a.md\n    find: <<<FIND\na\n",
            # edits yo'q
            "files: docs/a.md\nsummary: s\nrisk: past\ntest: t\n",
            # files yo'q
            "summary: s\nedits:\n  - file: docs/a.md\n    find: <<<FIND\na\nFIND\n    replace: <<<REPLACE\nb\nREPLACE\n",
            # summary yo'q
            "files: docs/a.md\nedits:\n  - file: docs/a.md\n    find: <<<FIND\na\nFIND\n    replace: <<<REPLACE\nb\nREPLACE\n",
            # file: siz find
            "files: docs/a.md\nsummary: s\nedits:\n    find: <<<FIND\na\nFIND\n    replace: <<<REPLACE\nb\nREPLACE\n",
            "",
        )
        for text in buzuq:
            with self.assertRaises(reja.PlanReject, msg=text) as cm:
                reja.parse_plan(text)
            self.assertEqual(cm.exception.kind, "rad")
            self.assertEqual(cm.exception.sabab, C.RAD_BUZUQ)


class ValidatePlanTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self.tmp.name)
        write_file(self.repo, "docs/a.md", "a\n")

    def tearDown(self):
        self.tmp.cleanup()

    def check(self, files, edits, **kw):
        return reja.validate_plan(reja.parse_plan(plan_text(files, edits, **kw)), repo=self.repo)

    def rad(self, files, edits):
        with self.assertRaises(reja.PlanReject) as cm:
            self.check(files, edits)
        return cm.exception

    def test_ok(self):
        p = self.check(["docs/a.md"], [("docs/a.md", "a", "b")])
        self.assertEqual(p.files, ["docs/a.md"])
        self.assertEqual(p.risk, "past")

    def test_env(self):
        for f in (".env", "backend/.env", "frontend/.env.local"):
            e = self.rad([f], [(f, "A=1", "A=2")])
            self.assertEqual(e.kind, "env", f)

    def test_himoyalangan(self):
        for f in (".git/config", ".claude/settings.json", "agents/claude_settings.json", "agents/state/x.json",
                  "static/tg_uploads/leader_bot_ab.jpg", "node_modules/x/y.js", "venv/x.py",
                  "agents/memory/learned.md", "../tashqi.md"):
            e = self.rad([f], [(f, "a", "b")])
            self.assertEqual((e.kind, e.sabab), ("rad", C.RAD_HIMOYA), f)

    def test_files_royxatida_yoq(self):
        e = self.rad(["docs/a.md"], [("docs/a.md", "a", "b"), ("docs/b.md", "c", "d")])
        self.assertEqual((e.kind, e.sabab), ("rad", C.RAD_FILES))

    def test_sezgir_fayl_yuqori(self):
        p = self.check(["agents/runner.py"], [("agents/runner.py", "a", "b")], risk="past")
        self.assertEqual(p.risk, "yuqori")
        self.assertIn(C.SEZGIR_XAVF_TPL.format(path="agents/runner.py"), p.danger_flags)

    def test_sezgir_naqsh_yuqori(self):
        # prefiksda yo'q, lekin C.SEZGIR_RE: stdlib soyasi / root ostida import qilinadigan yangi modul
        for f in ("json.py", "agents/x.py", "backend/__init__.py"):
            p = self.check([f], [(f, "", "x = 1")], risk="past")
            self.assertEqual(p.risk, "yuqori", f)
            self.assertIn(C.SEZGIR_XAVF_TPL.format(path=f), p.danger_flags, f)

    def test_sezgir_emas_past(self):
        for f in ("docs/b.md", "backend/src/x/y.py"):
            p = self.check([f], [(f, "", "x")], risk="past")
            self.assertEqual(p.risk, "past", f)


class PayloadVaPreviewTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self.tmp.name)
        write_file(self.repo, "docs/a.md", "salom\n")

    def tearDown(self):
        self.tmp.cleanup()

    def plan(self, edits, files=None):
        files = files or sorted({e[0] for e in edits})
        return reja.validate_plan(reja.parse_plan(plan_text(files, edits)), repo=self.repo)

    def test_payload(self):
        p = self.plan([("docs/a.md", "salom", "alik"), ("docs/yangi.md", "", "x")])
        token = uuid.uuid4().hex[:16]
        now = datetime(2026, 9, 28, 7, 5, tzinfo=timezone.utc)
        pl = reja.build_payload(p, token, repo=self.repo, now=now)
        for k in ("token", "created", "created_ts", "files", "summary", "risk", "danger_flags", "edits", "test", "hashes"):
            self.assertIn(k, pl)
        self.assertEqual(pl["token"], token)
        self.assertEqual(pl["created_ts"], now.timestamp())
        self.assertEqual(pl["hashes"]["docs/a.md"], hashlib.sha256(b"salom\n").hexdigest())
        self.assertEqual(pl["hashes"]["docs/yangi.md"], "")
        self.assertEqual(reja.file_sha256(self.repo / "yoq.md"), "")
        self.assertFalse(reja.payload_too_big(pl))

    def test_hajm(self):
        p = self.plan([("docs/a.md", "salom", "x" * (C.PAYLOAD_MAX + 10))])
        self.assertTrue(reja.payload_too_big(reja.build_payload(p, "t" * 16, repo=self.repo)))

    def test_diff_hujjat(self):
        self.assertFalse(reja.needs_diff_document(self.plan([("docs/a.md", "salom", "alik")])))
        self.assertTrue(reja.needs_diff_document(self.plan([("docs/a.md", "salom", "y" * (C.PREVIEW_SNIPPET + 1))])))
        many = [("docs/f%d.md" % i, "", "x") for i in range(C.PREVIEW_EDITS + 1)]
        self.assertTrue(reja.needs_diff_document(self.plan(many)))

    def test_preview_escape_va_kirill(self):
        p = self.plan([("docs/a.md", "salom", "<b>ОплатыКв</b> & x")])
        out = reja.format_preview_html(p)
        self.assertIn("&lt;b&gt;", out)
        self.assertNotIn("<b>ОплатыКв</b>", out)
        self.assertIn("ОплатыКв", out)  # kod bo'lagiga normalize_latin qo'llanmaydi
        self.assertIn("docs/a.md", out)
        self.assertIn("past", out)


@unittest.skipUnless(HAS_GIT, "git kerak")
class ApplyPlanTest(unittest.TestCase):
    """apply_plan(push=False yoki mahalliy bare remote, run_checks=False|True) tmp git repo'da."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name)
        self.repo = make_git_repo(base / "repo", {
            "docs/a.md": "bir\nikki\nbir\n",
            "docs/b.md": "salom\ndunyo\n",
            "agents/x.py": "X = 1\n",
            "crlf.md": b"a\r\nb\r\n",
        })
        self.orig = base / "orig"
        self.token = uuid.uuid4().hex[:16]

    def tearDown(self):
        self.tmp.cleanup()

    def payload(self, edits, files=None):
        files = files or list(dict.fromkeys(e[0] for e in edits))
        plan = reja.validate_plan(reja.parse_plan(plan_text(files, edits, summary="Sinov: docs yangilangan")),
                                  repo=self.repo)
        return reja.build_payload(plan, self.token, repo=self.repo)

    def apply(self, payload, **kw):
        kw.setdefault("push", False)
        kw.setdefault("run_checks", False)
        return reja.apply_plan(payload, token=self.token, repo=self.repo, orig_dir=self.orig, **kw)

    def snapshot(self):
        return {rel: (self.repo / rel).read_bytes() for rel in ("docs/a.md", "docs/b.md", "agents/x.py", "crlf.md")}

    def assert_hech_narsa_ozgarmadi(self, before, commits):
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(commit_count(self.repo), commits)
        self.assertEqual(git(self.repo, "status", "--porcelain"), "")

    def test_find_2_marta(self):  # KOD 9.5
        before, commits = self.snapshot(), commit_count(self.repo)
        out = self.apply(self.payload([("docs/a.md", "bir", "BIR")]))
        self.assertFalse(out.ok)
        self.assertEqual(out.reason, "find 2 marta")
        self.assertIsNone(out.commit)
        self.assertEqual(
            C.sistema(C.SIS_SUPPORT_BAJARILMADI, sabab=out.reason),
            "Support APPROVED BAJARILMADI " + EM + " find 2 marta",
        )
        self.assert_hech_narsa_ozgarmadi(before, commits)

    def test_find_2_marta_ikkinchi_edit(self):
        # birinchi edit xotirada qo'llangan bo'lsa ham hech narsa yozilmaydi
        before, commits = self.snapshot(), commit_count(self.repo)
        out = self.apply(self.payload([("docs/b.md", "dunyo", "olam"), ("docs/a.md", "bir", "BIR")]))
        self.assertEqual(out.reason, "find 2 marta")
        self.assert_hech_narsa_ozgarmadi(before, commits)

    def test_find_topilmadi(self):
        before, commits = self.snapshot(), commit_count(self.repo)
        out = self.apply(self.payload([("docs/b.md", "yoq matn", "x")]))
        self.assertEqual(out.reason, C.BAJ_FIND_YOQ)
        self.assert_hech_narsa_ozgarmadi(before, commits)

    def test_muvaffaqiyat(self):
        commits = commit_count(self.repo)
        out = self.apply(self.payload([("docs/b.md", "dunyo", "olam")]))
        self.assertTrue(out.ok, (out.reason, out.detail))
        self.assertTrue(out.commit)
        self.assertEqual(out.files, ["docs/b.md"])
        self.assertEqual((self.repo / "docs/b.md").read_bytes(), b"salom\nolam\n")
        self.assertEqual(commit_count(self.repo), commits + 1)
        self.assertEqual(git(self.repo, "log", "-1", "--format=%s"), C.COMMIT_PREFIX + "Sinov: docs yangilangan")
        self.assertEqual(git(self.repo, "show", "--name-only", "--format=", "HEAD").split(), ["docs/b.md"])
        self.assertEqual(git(self.repo, "status", "--porcelain"), "")
        self.assertTrue(git(self.repo, "rev-parse", "--short", "HEAD").startswith(out.commit[:7]))

    def test_yangi_fayl(self):
        out = self.apply(self.payload([("docs/yangi.md", "", "yangi fayl\n"), ("docs/b.md", "dunyo", "olam")]))
        self.assertTrue(out.ok, (out.reason, out.detail))
        self.assertEqual((self.repo / "docs/yangi.md").read_text(encoding="utf-8"), "yangi fayl\n")
        self.assertIn("docs/yangi.md", git(self.repo, "show", "--name-only", "--format=", "HEAD").split())

    def test_yangi_fayl_mavjud(self):
        before, commits = self.snapshot(), commit_count(self.repo)
        out = self.apply(self.payload([("docs/b.md", "", "ustiga yozish")]))
        self.assertFalse(out.ok)
        self.assertEqual(out.reason, C.BAJ_FAYL_OZGARGAN)
        self.assert_hech_narsa_ozgarmadi(before, commits)

    def test_fayl_ozgargan(self):
        payload = self.payload([("docs/b.md", "dunyo", "olam")])
        write_file(self.repo, "docs/b.md", "salom\ndunyo\nboshqa\n")
        git(self.repo, "commit", "-q", "-am", "boshqa o'zgarish")
        before, commits = self.snapshot(), commit_count(self.repo)
        out = self.apply(payload)
        self.assertEqual(out.reason, C.BAJ_FAYL_OZGARGAN)
        self.assert_hech_narsa_ozgarmadi(before, commits)

    def test_branch(self):
        payload = self.payload([("docs/b.md", "dunyo", "olam")])
        git(self.repo, "checkout", "-q", "-b", "boshqa")
        commits = commit_count(self.repo)
        out = self.apply(payload)
        self.assertEqual(out.reason, C.BAJ_BRANCH)
        self.assertEqual(commit_count(self.repo), commits)

    def test_iflos_fayl(self):
        payload = self.payload([("docs/b.md", "dunyo", "olam")])
        write_file(self.repo, "docs/b.md", "salom\ndunyo\nsaqlanmagan\n")
        commits = commit_count(self.repo)
        out = self.apply(payload)
        self.assertEqual(out.reason, C.BAJ_BRANCH)
        self.assertEqual(commit_count(self.repo), commits)
        self.assertEqual((self.repo / "docs/b.md").read_text(encoding="utf-8"), "salom\ndunyo\nsaqlanmagan\n")

    def test_py_compile(self):  # D6: .py vaqtinchalik nusxada tekshiriladi
        before, commits = self.snapshot(), commit_count(self.repo)
        out = self.apply(self.payload([("agents/x.py", "X = 1", "X = (")]), run_checks=True)
        self.assertEqual(out.reason, C.BAJ_PY_COMPILE)
        self.assert_hech_narsa_ozgarmadi(before, commits)

    def test_py_compile_ok(self):
        out = self.apply(self.payload([("agents/x.py", "X = 1", "X = 2")]), run_checks=True)
        self.assertTrue(out.ok, (out.reason, out.detail))
        self.assertTrue(any("py_compile" in c for c in out.checks), out.checks)

    def test_crlf(self):
        out = self.apply(self.payload([("crlf.md", "a\nb", "a\nc")]))
        self.assertTrue(out.ok, (out.reason, out.detail))
        self.assertEqual((self.repo / "crlf.md").read_bytes(), b"a\r\nc\r\n")

    def bare_remote(self, reject_push=False):
        """Mahalliy bare origin (main push qilingan). reject_push: pre-receive hook push'ni rad etadi."""
        remote = Path(self.tmp.name) / "remote.git"
        git(Path(self.tmp.name), "init", "-q", "--bare", str(remote))
        git(self.repo, "remote", "add", "origin", str(remote))
        git(self.repo, "push", "-q", "origin", "main")
        if reject_push:
            hook = remote / "hooks" / "pre-receive"
            hook.write_bytes(b"#!/bin/sh\necho rad etildi >&2\nexit 1\n")
            os.chmod(str(hook), 0o755)
        return remote

    def test_push_xato_commit_qolmaydi(self):
        remote = self.bare_remote(reject_push=True)
        before, commits = self.snapshot(), commit_count(self.repo)
        out = self.apply(self.payload([("docs/b.md", "dunyo", "olam")]), push=True)
        self.assertFalse(out.ok)
        self.assertEqual(out.reason, C.BAJ_PUSH)
        self.assert_hech_narsa_ozgarmadi(before, commits)
        self.assertEqual(git(remote, "rev-parse", "main"), git(self.repo, "rev-parse", "HEAD"))

    def test_origin_oqilmadi(self):  # KOD 3.4: origin noma'lum -> push qilinmaydi
        git(self.repo, "remote", "add", "origin", str(Path(self.tmp.name) / "yoq-remote.git"))
        before, commits = self.snapshot(), commit_count(self.repo)
        out = self.apply(self.payload([("docs/b.md", "dunyo", "olam")]), push=True)
        self.assertEqual(out.reason, C.BAJ_BRANCH)
        self.assertIn("origin bilan bir xil emas", out.detail)
        self.assert_hech_narsa_ozgarmadi(before, commits)

    def test_lokal_origindan_oldinda(self):
        # qaytarish to'liq bo'lmagan yoki qo'lda commit: REJA push'i uni tasdiqsiz olib ketmasin
        remote = self.bare_remote()
        remote_head = git(remote, "rev-parse", "main")
        write_file(self.repo, "docs/c.md", "qo'lda\n")
        git(self.repo, "add", "docs/c.md")
        git(self.repo, "commit", "-q", "-m", "push qilinmagan")
        before, commits = self.snapshot(), commit_count(self.repo)
        out = self.apply(self.payload([("docs/b.md", "dunyo", "olam")]), push=True)
        self.assertEqual(out.reason, C.BAJ_BRANCH)
        self.assertIn("origin bilan bir xil emas", out.detail)
        self.assert_hech_narsa_ozgarmadi(before, commits)
        self.assertEqual(git(remote, "rev-parse", "main"), remote_head)

    def test_tayyorlash_repoga_yozmaydi(self):
        # 1-bosqich (deploy flock'siz): repo fayllari va git holati o'zgarmaydi
        before, commits = self.snapshot(), commit_count(self.repo)
        prep = reja._prepare_apply(self.payload([("agents/x.py", "X = 1", "X = 2")]), token=self.token,
                                   repo=self.repo, push=False, orig_dir=self.orig, run_checks=True)
        self.assertNotIsInstance(prep, reja.ApplyOutcome, getattr(prep, "detail", ""))
        self.assert_hech_narsa_ozgarmadi(before, commits)
        out = reja._write_apply(prep)
        self.assertTrue(out.ok, (out.reason, out.detail))
        self.assertEqual((self.repo / "agents/x.py").read_bytes(), b"X = 2\n")

    def test_tekshiruv_paytida_head_ozgardi(self):
        # tsc paytida deploy yangi commit olib kelgan: eski tekshiruv natijasi bilan yozilmaydi
        prep = reja._prepare_apply(self.payload([("docs/b.md", "dunyo", "olam")]), token=self.token,
                                   repo=self.repo, push=False, orig_dir=self.orig, run_checks=False)
        self.assertNotIsInstance(prep, reja.ApplyOutcome)
        write_file(self.repo, "docs/c.md", "deploy\n")
        git(self.repo, "add", "docs/c.md")
        git(self.repo, "commit", "-q", "-m", "deploy olib kelgan")
        before, commits = self.snapshot(), commit_count(self.repo)
        out = reja._write_apply(prep)
        self.assertEqual(out.reason, C.BAJ_BRANCH)
        self.assertIn("HEAD o'zgardi", out.detail)
        self.assert_hech_narsa_ozgarmadi(before, commits)

    def test_push_muvaffaqiyat(self):
        remote = self.bare_remote()
        out = self.apply(self.payload([("docs/b.md", "dunyo", "olam")]), push=True)
        self.assertTrue(out.ok, (out.reason, out.detail))
        self.assertEqual(git(remote, "rev-parse", "main"), git(self.repo, "rev-parse", "HEAD"))


if __name__ == "__main__":
    unittest.main()
