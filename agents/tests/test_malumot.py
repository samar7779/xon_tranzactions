"""malumot: hisob raqam ma'lumoti va XATO ro'yxati fayli (TR Support, faqat o'qish) — ko'prik soxta, tarmoq yo'q."""
from __future__ import annotations

import base64
import unittest
from typing import Any, List

from agents import contract as C
from agents import malumot as ML
from agents import tuzatish as TZ
from agents.tests.test_leader_reply import LB, _FlowBase, _leader_json, _msg
from agents.tests.test_tuzatish import _Base

ACC = "20208000904900960001"
HISOB_JAVOB = {
    "ok": True, "hisob": ACC, "balansKod": "20208", "valyuta": "UZS", "topildi": True, "kesilgan": False,
    "bizniki": [],
    "nomlar": [
        {"nom": "XODJIMURATOV SIROJIDDIN", "mfo": "01158", "inn": "512345678901234", "soni": 14,
         "oxirgi": "2026-10-02T06:00:00.000Z", "bankNomi": "TOSHKENT SH., KAPITALBANK"},
        {"nom": "XODJIMURATOV S", "mfo": "01158", "inn": "512345678901234", "soni": 1, "oxirgi": None, "bankNomi": None},
    ],
    "korxonalar": [{"inn": "512345678901234", "nom": "Xodjimuratov", "toliqNom": "XODJIMURATOV SIROJIDDIN NURILLO O'G'LI",
                    "direktor": None, "telefon": "+998901234567", "manzil": "Toshkent", "qqs": None, "oked": None,
                    "royxatdan": None, "faol": True, "bankNomi": "KAPITALBANK", "mfo": "01158"}],
    "jonatuvchi": {"soni": 15, "summa": 293188000, "birinchi": "2026-05-04T06:00:00.000Z", "oxirgi": "2026-10-02T06:00:00.000Z"},
    "qabulQiluvchi": {"soni": 0, "summa": 0, "birinchi": None, "oxirgi": None},
    "shartnomalar": [{"shartnoma": "2118MSO252P", "soni": 14}, {"shartnoma": "2118MSO252POT", "soni": 1}],
    "oxirgi": [{"id": "6625540158_3505671_02.10.2026_A_B_994200000_-", "sana": "2026-10-02T06:00:00.000Z", "summa": 9942000,
                "yon": "IN", "jonatuvchi": True, "qarshi": "XON SAROY", "shartnoma": "2118MSO252POT", "izoh": "oplata"}],
}
XLSX = b"PK\x03\x04 soxta xlsx"


class ParseTest(unittest.TestCase):
    def test_hisob_parse(self):
        self.assertEqual(ML.hisob_parse("HISOB: 2020 8000 9049 0096 0001"), [ACC])
        self.assertEqual(ML.hisob_parse("HISOB: %s, 20208000904900960002; 123" % ACC), [ACC, "20208000904900960002"])
        self.assertEqual(ML.hisob_parse("HISOB:"), [])
        self.assertIsNone(ML.hisob_parse("oddiy matn " + ACC))

    def test_xato_parse_va_contract(self):
        self.assertEqual(ML.xato_parse("XATO_FAYL:"), "")
        self.assertEqual(ML.xato_parse('XATO_FAYL: "VATAN"'), "VATAN")
        self.assertIsNone(ML.xato_parse("XATO to'lovlar"))
        self.assertIn(C.INTENT_HISOB, C.INTENTS)
        self.assertIn(C.INTENT_XATO_FAYL, C.INTENTS)
        self.assertIn(C.HISOB_KOPRIK, TZ._YOLLAR)
        self.assertIn(C.XATO_FAYL_KOPRIK, TZ._YOLLAR)


class OqimTest(_Base):
    async def test_hisob_matni(self):
        self.javob["hisob"] = HISOB_JAVOB
        self.assertTrue(await ML.handle("HISOB: 2020 8000 9049 0096 0001", self.out, reply_to=5))
        [c] = self.calls
        self.assertEqual((c["path"], c["q"], c["method"]), (C.HISOB_KOPRIK, {"raqam": [ACC]}, "GET"))
        [t] = self.texts()
        for frag in ("Hisob raqam: " + ACC, "Balans kodi 20208, valyuta UZS.",
                     "Egasi (to'lovlardagi nom): XODJIMURATOV SIROJIDDIN", "MFO: 01158 - TOSHKENT SH., KAPITALBANK",
                     "INN/PINFL: 512345678901234", "Boshqa yozilishlar: XODJIMURATOV S (1)",
                     "Korxona (DIDOX): XODJIMURATOV SIROJIDDIN NURILLO O'G'LI", "telefon: +998901234567",
                     "Shu hisobdan to'lovlar: 15 ta, 293 188 000 so'm (04.05.2026 - 02.10.2026).",
                     "Shu hisobga to'lovlar: yo'q.", "Shartnomalar: 2118MSO252P (14), 2118MSO252POT (1)",
                     "1. 02.10.2026 · 9 942 000 so'm · shu hisobdan -> XON SAROY · 2118MSO252POT",
                     "   ID 6625540158_3505671_02.10.2026_A_B_994200000_-"):
            self.assertIn(frag, t)

    async def test_hisob_topilmadi_va_raqamsiz(self):
        self.javob["hisob"] = {"ok": True, "hisob": ACC, "balansKod": "20208", "valyuta": "UZS", "topildi": False}
        await ML.handle("HISOB: " + ACC, self.out)
        self.assertIn("ma'lumot topilmadi", self.texts()[-1])
        await ML.handle("HISOB: abc", self.out)
        self.assertEqual(self.texts()[-1], C.MSG_HISOB_FOYDALANISH)
        self.assertEqual(len(self.calls), 1)                            # raqamsiz — ko'prikka bormaydi

    async def test_xato_fayl_hujjat_bilan(self):
        self.javob["xato-royxat"] = {
            "ok": True, "filename": "xato-tolovlar_2026-10-05_filtr.xlsx", "base64": base64.b64encode(XLSX).decode(),
            "soni": 2, "jami": 40, "summa": 14942000, "kutilmoqda": 1, "rad": 0, "dateFrom": "2026-07-01",
            "filtr": "vatan", "kesilgan": False}
        self.assertTrue(await ML.handle("XATO_FAYL: vatan", self.out))
        [c] = self.calls
        self.assertEqual((c["path"], c["q"]), (C.XATO_FAYL_KOPRIK, {"filtr": ["vatan"]}))
        [d] = [s for s in self.out.sent if s["kind"] == "document"]
        self.assertEqual((d["filename"], d["size"]), ("xato-tolovlar_2026-10-05_filtr.xlsx", len(XLSX)))
        for frag in ("XATO to'lovlar: 2 ta, jami 14 942 000 so'm; ariza kutilmoqda 1, rad etilgan 0.",
                     'Filtr: "vatan" (40 tadan).', "Manba: XATO to'lovlar sahifasi bilan bir xil, 01.07.2026 dan."):
            self.assertIn(frag, d["caption"])
        self.assertIn("Fayl yuborildi: xato-tolovlar_2026-10-05_filtr.xlsx", self.hist[-1])

    async def test_xato_bosh_va_xato_javob(self):
        self.javob["xato-royxat"] = {"ok": True, "filename": "x.xlsx", "base64": "", "soni": 0, "jami": 0, "summa": 0,
                                     "kutilmoqda": 0, "rad": 0, "dateFrom": None, "filtr": None, "kesilgan": False}
        await ML.handle("XATO_FAYL:", self.out)
        self.assertEqual(self.calls[0]["q"], {})                         # filtrsiz — parametr yo'q
        self.assertIn("Fayl yuborilmadi: qator yo'q.", self.texts()[-1])
        self.assertFalse([s for s in self.out.sent if s["kind"] == "document"])
        self.javob["xato-royxat"] = {"ok": True, "filename": "../../etc.xlsx", "base64": "%%%", "soni": 3}
        await ML.handle("XATO_FAYL:", self.out)
        self.assertIn("fayl buzilgan", self.texts()[-1])


class LeaderOqimTest(_FlowBase):
    """Leader javobida HISOB / XATO_FAYL qatori -> malumot.handle (delegatsiyasiz)."""

    async def test_qatorlar_botga(self):
        chaqiruv: List[Any] = []

        class FakeML:
            @staticmethod
            async def handle(text: Any, outbox: Any, reply_to: Any = None) -> bool:
                chaqiruv.append((text, reply_to))
                return True

        self._patch(LB, "_mod", lambda name: FakeML if name == "malumot" else None)
        self.replies = [(C.RUN_OK, _leader_json("Qarayapman", intent=C.INTENT_HISOB, task="HISOB: " + ACC)),
                        (C.RUN_OK, _leader_json("Tayyorlayapman", intent=C.INTENT_XATO_FAYL, task="XATO_FAYL: VATAN"))]
        await self.handle(_msg(901, "shu hisob kimniki " + ACC))
        await self.handle(_msg(902, "xato to'lovlarni excelda tashla, faqat vatan"))
        self.assertEqual([(t.splitlines()[0], r) for t, r in chaqiruv], [("HISOB: " + ACC, 901), ("XATO_FAYL: VATAN", 902)])
        self.assertEqual([a for a, _t in self.runs], ["leader", "leader"])
        self.assertFalse(any("Qarayapman" in (getattr(s, "text", "") or "") for s in self.outbox.sent))


if __name__ == "__main__":
    unittest.main()
