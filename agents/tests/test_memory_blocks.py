"""memory_blocks.py: [WRITE_MEMORY] parse (KOD 4), "Teacher uchun:" qatorlari (Q6),
yo'l oq ro'yxati, vaqtinchalik repo'da yozish (record=False: DB yo'q).
"""
from __future__ import annotations

import tempfile
import unittest
from datetime import date
from pathlib import Path

from agents import contract as C

from . import fake_secret, import_or_skip

M = import_or_skip("agents.memory_blocks")

EM = chr(0x2014)
BUGUN = date(2026, 9, 28)
DAILY = C.DAILY_PATH_TPL.format(sana=BUGUN.isoformat())


def blok(path: str, content: str, mode: str = None) -> str:
    lines = ["[WRITE_MEMORY]", "path: " + path]
    if mode is not None:
        lines.append("mode: " + mode)
    lines += ["content:", content, "[/WRITE_MEMORY]"]
    return "\n".join(lines)


class ExtractWriteBlocksTest(unittest.TestCase):
    def test_bitta_blok(self):
        text = "Oldin.\n" + blok(C.LEARNED_PATH, "Tur: fakt\nbirinchi\nikkinchi", "append") + "\nKeyin."
        rest, blocks = M.extract_write_blocks(text)
        self.assertEqual(len(blocks), 1)
        b = blocks[0]
        self.assertEqual(b.path, C.LEARNED_PATH)
        self.assertEqual(b.mode, "append")
        self.assertEqual(b.content.strip(), "Tur: fakt\nbirinchi\nikkinchi")
        self.assertNotIn("WRITE_MEMORY", rest)
        self.assertIn("Oldin.", rest)
        self.assertIn("Keyin.", rest)

    def test_mode_default_append(self):
        _, blocks = M.extract_write_blocks(blok(C.LEARNED_PATH, "x"))
        self.assertEqual(blocks[0].mode, "append")
        _, blocks = M.extract_write_blocks(blok(C.LEARNED_PATH, "x", "delete"))
        self.assertEqual(blocks[0].mode, "append")
        _, blocks = M.extract_write_blocks(blok(DAILY, "x", "write"))
        self.assertEqual(blocks[0].mode, "write")

    def test_bir_nechta_va_harf_farqsiz(self):
        text = blok(C.LEARNED_PATH, "a") + "\n" + blok(DAILY, "b", "write").replace("WRITE_MEMORY", "write_memory")
        _, blocks = M.extract_write_blocks(text)
        self.assertEqual([b.path for b in blocks], [C.LEARNED_PATH, DAILY])

    def test_yolsiz_yoki_mazmunsiz_etiborsiz(self):
        for text in (
            "[WRITE_MEMORY]\nmode: append\ncontent:\nmatn\n[/WRITE_MEMORY]",
            "[WRITE_MEMORY]\npath: " + C.LEARNED_PATH + "\ncontent:\n\n[/WRITE_MEMORY]",
            "[WRITE_MEMORY]\npath: " + C.LEARNED_PATH + "\n[/WRITE_MEMORY]",
        ):
            _, blocks = M.extract_write_blocks(text)
            self.assertEqual(blocks, [], text)


class ExtractTeacherLinesTest(unittest.TestCase):
    def test_qatorlar(self):
        text = (
            "Javob matni.\n"
            "Teacher uchun: fakt " + EM + " sverka Kapital bankda 18:00 da\n"
            "Teacher uchun: vada - ertaga Hamkor tekshiriladi\n"
            "- Teacher uchun: fakt " + EM + " prefiksli (olinmaydi)\n"
            "Teacher uchun: va'da " + EM + " apostrofli (olinmaydi)\n"
            "Oxiri."
        )
        rest, lines = M.extract_teacher_lines(text)
        self.assertEqual(lines, [("fakt", "sverka Kapital bankda 18:00 da"), ("vada", "ertaga Hamkor tekshiriladi")])
        self.assertNotIn("Teacher uchun", rest)
        self.assertIn("Javob matni.", rest)
        self.assertIn("Oxiri.", rest)

    def test_qatorsiz(self):
        rest, lines = M.extract_teacher_lines("Oddiy javob.")
        self.assertEqual(lines, [])
        self.assertEqual(rest.strip(), "Oddiy javob.")


class CheckMemoryPathTest(unittest.TestCase):
    def test_ruxsat(self):
        self.assertIsNone(M.check_memory_path(C.LEARNED_PATH, "append", BUGUN))
        self.assertIsNone(M.check_memory_path(DAILY, "append", BUGUN))
        self.assertIsNone(M.check_memory_path(DAILY, "write", BUGUN))

    def test_rad(self):
        for path, mode in (
            (C.LEARNED_PATH, "write"),
            ("agents/memory/daily/2026-09-27.md", "append"),
            ("agents/memory/INDEX.md", "append"),
            ("agents/memory/leader.md", "append"),
            (C.RUNTIME_PATH, "append"),
            ("agents/leader.md", "append"),
            ("agents/memory/daily/../learned.md", "append"),
            ("/var/www/xon_tranzactions/agents/memory/learned.md", "append"),
            ("../agents/memory/learned.md", "append"),
            ("agents/memory/.env", "append"),
            ("", "append"),
        ):
            self.assertEqual(M.check_memory_path(path, mode, BUGUN), C.TW_RAD_YOL, path)


class ApplyWriteBlocksTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self.tmp.name)
        (self.repo / "agents" / "memory").mkdir(parents=True)

    def tearDown(self):
        self.tmp.cleanup()

    def apply(self, blocks, **kw):
        kw.setdefault("source", "deleg")
        kw.setdefault("today", BUGUN)
        return M.apply_write_blocks(blocks, repo=self.repo, record=False, **kw)

    def read(self, rel: str) -> str:
        return (self.repo / rel).read_text(encoding="utf-8")

    def test_learned_append(self):
        r1 = self.apply([M.WriteBlock(C.LEARNED_PATH, "append", "Tur: fakt. birinchi")])
        r2 = self.apply([M.WriteBlock(C.LEARNED_PATH, "append", "Tur: odam. ikkinchi")])
        self.assertTrue(r1[0].ok and r2[0].ok)
        self.assertTrue(r1[0].natija.startswith("qo'shildi: "), r1[0].natija)
        text = self.read(C.LEARNED_PATH)
        self.assertIn("birinchi", text)
        self.assertIn("ikkinchi", text)
        self.assertLess(text.index("birinchi"), text.index("ikkinchi"))
        self.assertIn("\n", text[text.index("birinchi"):text.index("ikkinchi")])

    def test_daily_write_papka_yaratadi(self):
        self.assertFalse((self.repo / "agents" / "memory" / "daily").exists())
        self.apply([M.WriteBlock(DAILY, "write", "eski hisobot")])
        r = self.apply([M.WriteBlock(DAILY, "write", "yangi hisobot")])
        self.assertTrue(r[0].ok)
        self.assertTrue(r[0].natija.startswith("almashtirildi: "), r[0].natija)
        text = self.read(DAILY)
        self.assertIn("yangi hisobot", text)
        self.assertNotIn("eski hisobot", text)

    def test_yol_rad_fayl_yozilmaydi(self):
        r = self.apply([M.WriteBlock("agents/memory/INDEX.md", "append", "buzg'unchi qoida")])
        self.assertFalse(r[0].ok)
        self.assertEqual(r[0].sabab, C.TW_RAD_YOL)
        self.assertFalse((self.repo / "agents" / "memory" / "INDEX.md").exists())

    def test_sir_rad(self):
        r = self.apply([M.WriteBlock(C.LEARNED_PATH, "append", "kalit " + fake_secret("anthropic"))])
        self.assertFalse(r[0].ok)
        self.assertEqual(r[0].sabab, C.TW_RAD_SIR)
        self.assertFalse((self.repo / C.LEARNED_PATH).exists())

    def test_kunlik_chegara(self):
        blocks = [M.WriteBlock(C.LEARNED_PATH, "append", "qoida %d" % i) for i in range(3)]
        r = self.apply(blocks, source="daily", max_learned=C.TEACHER_LEARNED_MAX_BLOK)
        self.assertEqual([x.ok for x in r], [True, True, False])
        self.assertEqual(r[2].sabab, C.TW_RAD_KUNLIK)
        self.assertNotIn("qoida 2", self.read(C.LEARNED_PATH))

    def test_teacher_emas(self):
        r = self.apply([M.WriteBlock(C.LEARNED_PATH, "append", "x")], agent="support")
        self.assertFalse(r[0].ok)
        self.assertEqual(r[0].sabab, C.TW_RAD_EMAS_TPL.format(agent="support"))
        self.assertFalse((self.repo / C.LEARNED_PATH).exists())

    def test_runtime_trigger(self):
        r = M.write_runtime_memory("Hisobotni har juma yubor", repo=self.repo, record=False)
        self.assertTrue(r.ok)
        self.assertEqual(r.path, C.RUNTIME_PATH)
        self.assertTrue(r.natija.startswith("qo'shildi: "))
        text = self.read(C.RUNTIME_PATH)
        self.assertIn("Hisobotni har juma yubor", text)
        self.assertIn("shefim aytdi", text)

    def test_runtime_sir_yozilmaydi(self):
        r = M.write_runtime_memory("bot " + fake_secret("telegram"), repo=self.repo, record=False)
        self.assertFalse(r.ok)
        self.assertFalse((self.repo / C.RUNTIME_PATH).exists())


class SistemaForResultsTest(unittest.TestCase):
    def test_matnlar(self):
        results = [
            M.ApplyResult(ok=True, path=C.LEARNED_PATH, natija="qo'shildi: x"),
            M.ApplyResult(ok=False, path="agents/memory/INDEX.md", sabab=C.TW_RAD_YOL),
        ]
        self.assertEqual(
            M.sistema_for_results(results),
            [
                "teacher xotiraga yozdi. Qisqacha: agents/memory/learned.md: qo'shildi: x",
                "teacher yozuvi RAD " + EM + " yo'l ruxsatsiz",
            ],
        )


if __name__ == "__main__":
    unittest.main()
