"""leader_logic.py: Leader JSON, delegat, xotira triggeri, va'da, yolg'on detektori, react, lotin."""
from __future__ import annotations

import unittest

from agents import contract as C
from agents import leader_logic as L

EM = chr(0x2014)


class ParseLeaderResponseTest(unittest.TestCase):
    def test_fence(self):
        raw = (
            "Mana javob:\n```json\n"
            '{"intent": "diagnose", "delegate_to": "support", "task_for_agent": "sync xatosini top", '
            '"human_reply": "Qabul qildim."}\n```\n'
        )
        d = L.parse_leader_response(raw)
        self.assertEqual(d["delegate_to"], "support")
        self.assertEqual(d["intent"], "diagnose")
        self.assertEqual(d["task_for_agent"], "sync xatosini top")
        self.assertEqual(d["human_reply"], "Qabul qildim.")

    def test_birinchi_va_oxirgi_qavs(self):
        raw = 'Oldin matn {"intent": "just_answer", "delegate_to": null, "task_for_agent": null, "human_reply": "Salom {shefim}"} keyin'
        d = L.parse_leader_response(raw)
        self.assertEqual(d["human_reply"], "Salom {shefim}")
        self.assertIsNone(L.normalize_delegate(d["delegate_to"]))

    def test_buzuq_json_xom_matn(self):
        raw = "Bu JSON emas, oddiy javob."
        d = L.parse_leader_response(raw)
        self.assertEqual(d["human_reply"], raw)
        for k in C.LEADER_JSON_KEYS:
            self.assertIn(k, d)
        self.assertIsNone(L.normalize_delegate(d["delegate_to"]))

    def test_tort_kalit_har_doim_bor(self):
        d = L.parse_leader_response('{"human_reply": "faqat javob"}')
        for k in C.LEADER_JSON_KEYS:
            self.assertIn(k, d)
        self.assertEqual(d["human_reply"], "faqat javob")


class NormalizeDelegateTest(unittest.TestCase):
    def test_null_qiymatlar(self):
        for v in (None, "null", "NULL", " none ", "", "   "):
            self.assertIsNone(L.normalize_delegate(v), repr(v))

    def test_nom(self):
        self.assertEqual(L.normalize_delegate(" Support "), "support")
        # oq ro'yxat tekshiruvi chaqiruvchida: leader ham nom sifatida qaytadi
        self.assertEqual(L.normalize_delegate("leader"), "leader")
        self.assertNotIn(L.normalize_delegate("leader"), C.DELEGATE_AGENTS)
        self.assertNotIn(L.normalize_delegate("tester"), C.DELEGATE_AGENTS)


class MemoryCommandTest(unittest.TestCase):
    def test_trigger(self):
        self.assertEqual(L.detect_memory_command("Yodda tut: Aziz buxgalter"), "Aziz buxgalter")
        self.assertEqual(L.detect_memory_command("eslab qol sverka 18:00 da"), "sverka 18:00 da")
        self.assertEqual(L.detect_memory_command("XOTIRAGA YOZ: katta"), "katta")
        self.assertEqual(L.detect_memory_command("yodda saqla: ko'p\nqatorli"), "ko'p\nqatorli")

    def test_trigger_emas(self):
        for text in ("Iltimos yodda tut: x", "yodda tut:", "yodda tut   ", "qoida qo'sh: x",
                     "shuni yozib qo'y: x", "yodda tutmoq", "", None):
            self.assertIsNone(L.detect_memory_command(text), repr(text))


class PromiseTest(unittest.TestCase):
    def test_default_2_soat(self):
        r = L.detect_promise("Tekshiraman, shefim.")
        self.assertIsNotNone(r)
        self.assertEqual(r, ("tekshiraman", C.VADA_DEFAULT_S))

    def test_muddat(self):
        self.assertEqual(L.detect_promise("30 daqiqada aniqlab aytaman")[1], 1800)
        self.assertEqual(L.detect_promise("1 soatda javob beraman")[1], 3600)
        self.assertEqual(L.detect_promise("ertaga topib beraman")[1], C.VADA_ERTAGA_S)

    def test_trigger_royxatdan(self):
        trig, _ = L.detect_promise("Hozir ko" + chr(0x2018) + "raman")  # tipografik apostrof
        self.assertIn(trig, C.VADA_TRIGGERS)

    def test_vada_yoq(self):
        self.assertIsNone(L.detect_promise("Qabul qildim."))
        self.assertIsNone(L.detect_promise("Sverka farqi 3 ta, hammasi Kapital bankda."))
        self.assertIsNone(L.detect_promise(""))


class LieDetectorTest(unittest.TestCase):
    def test_yolgon(self):
        self.assertTrue(L.is_lie("Men learned.md ga yozdim.", 0))
        self.assertTrue(L.is_lie("Qoida qo" + chr(0x2019) + "shildi.", 0))
        self.assertTrue(L.is_lie("Hammasi SAQLANDI", 0))

    def test_blok_qollangan(self):
        self.assertFalse(L.is_lie("Men learned.md ga yozdim.", 1))

    def test_istisno_joylar(self):
        for text in (
            "Commit sarlavhasi: `yangilandi sync`",
            "Kod:\n```\nlog('yozildi')\n```\nboshqa narsa yo'q",
            "[WRITE_MEMORY]\npath: agents/memory/learned.md\ncontent:\nyozildi\n[/WRITE_MEMORY]",
            "Reja:\n[REQUEST_APPROVAL]\nsummary: qator qo'shildi\n[/REQUEST_APPROVAL]",
            "Javob.\nTeacher uchun: fakt " + EM + " jadval yangilandi",
            "Hech narsa o'zgarmadi, fayl yozilmagan.",
        ):
            self.assertFalse(L.is_lie(text, 0), text)

    def test_strip(self):
        out = L.strip_for_lie_check("a `x` b\n```\nc\n```\nd")
        self.assertNotIn("x", out)
        self.assertNotIn("c", out)
        self.assertIn("a", out)
        self.assertIn("d", out)


class ReactTest(unittest.TestCase):
    def test_mavjud(self):
        text, emoji = L.extract_react("Zo'r bo'ldi! [REACT:fire]")
        self.assertEqual(text, "Zo'r bo'ldi!")
        self.assertEqual(emoji, C.REACT_MAP["fire"])

    def test_royxatda_yoq_jim(self):
        text, emoji = L.extract_react("Salom [REACT:banana]")
        self.assertEqual(text, "Salom")
        self.assertIsNone(emoji)

    def test_blok_yoq(self):
        self.assertEqual(L.extract_react("Oddiy"), ("Oddiy", None))


class NormalizeLatinTest(unittest.TestCase):
    def test_kirill_lotinga(self):
        self.assertEqual(L.normalize_latin("Салом шефим"), "Salom shefim")
        self.assertEqual(L.normalize_latin("Ўзбек"), "O'zbek")
        self.assertIsNone(C.KIRILL_RE.search(L.normalize_latin("Қарз ҳисоб ғалла")))

    def test_kod_ichiga_tegmaydi(self):
        src = "Jadval <code>ОплатыКв</code> va <pre>Қ = 1</pre> тайёр"
        out = L.normalize_latin(src)
        self.assertIn("<code>ОплатыКв</code>", out)
        self.assertIn("<pre>Қ = 1</pre>", out)
        self.assertTrue(out.endswith(" tayyor"), out)

    def test_lotin_ozgarmaydi(self):
        text = "Shefim, oplata_kv jadvalida 3 ta yozuv bor."
        self.assertEqual(L.normalize_latin(text), text)


if __name__ == "__main__":
    unittest.main()
