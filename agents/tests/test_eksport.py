"""eksport: Google Sheets eksportini bot orqali qayta ishga tushirish — tugmasiz (raqam va "tasdiqlayman" matni)."""
from __future__ import annotations

import asyncio
import unittest
from typing import Any, Dict, List

from agents import contract as C
from agents import eksport as EK
from agents import tuzatish as TZ
from agents.tests.test_tuzatish import _Base

ITEMS: List[Dict[str, Any]] = [
    {"id": "sheet-1", "name": "Сотув Булими отчети", "source": "oplatakv", "tabName": "Туловлар", "writeMode": "replace",
     "cron": {"enabled": True, "everyMinutes": 120, "hourFrom": 8, "hourTo": 23, "days": []},
     "lastRun": {"startedAt": "2026-09-30T10:16:00.000Z", "mode": "cron", "status": "ok", "rowsWritten": 270007,
                 "durationMs": 40000, "triggeredBy": "cron", "error": None}},
    {"id": "sheet-2", "name": "Дебетор", "source": "oplatakv", "tabName": "Лист1", "writeMode": "upsert",
     "cron": {"enabled": False}, "lastRun": None},
]
RUN_OK = {"ok": True, "sheet": {"id": "sheet-2", "name": "Дебетор", "tabName": "Лист1"}, "writeMode": "upsert",
          "rowsFetched": 120, "rowsWritten": 118, "writtenRange": "A2:F119", "dateFrom": None, "dateTo": "2026-10-01",
          "durationMs": 7400}


class EksportTest(_Base):
    def setUp(self) -> None:
        super().setUp()
        self.javob["exports"] = {"ok": True, "credentialsAvailable": True, "items": ITEMS}

    def test_parse(self):
        self.assertEqual(EK.parse("EKSPORT: Sotuv"), "Sotuv")
        self.assertEqual(EK.parse("EKSPORT:"), "")
        self.assertEqual(EK.parse("EKSPORT: nomi=Debetor"), "Debetor")
        self.assertIsNone(EK.parse("oddiy matn"))

    async def test_royxat_raqam_bilan_tanlash_va_tasdiq(self):
        await EK.handle("EKSPORT:", self.out)
        t = self.texts()[-1]
        self.assertIsNone(self.out.sent[-1].get("keyboard"))             # variantlar ham tugmasiz
        self.assertIn("Qaysi eksportni ishga tushiray?", t)
        self.assertIn("1. Сотув Булими отчети — oxirgi: 30.09 15:16, OK, 270 007 qator; avtomatik har 120 daq, 08-23", t)
        self.assertIn("2. Дебетор — oxirgi: hali ishlamagan; avtomatik o'chiq", t)
        self.assertIn("Raqamini yozing (masalan: 1).", t)
        self.assertFalse(await EK.matn_tanlov("salom", None, self.out))  # raqam emas
        self.assertTrue(await EK.matn_tanlov("7", None, self.out))
        self.assertIn("Bunday raqam yo'q: 1 dan 2 gacha", self.texts()[-1])
        self.assertTrue(await EK.matn_tanlov("2", None, self.out))
        p = self._sorov_xabari("Eksportni ishga tushirish")
        self.assertIn("Sheet: <b>Дебетор</b> / Лист1", p["text"])
        self.assertIn("rejim: yangilash (upsert)", p["text"])
        self.assertIn('Tasdiqlash uchun "tasdiqlayman" deb yozing', p["text"])
        self.assertFalse(await EK.matn_tanlov("1", None, self.out))      # ro'yxat ishlatildi
        token = self._token(C.KV_EK_APPR)
        self.javob["run"] = RUN_OK
        self.assertEqual(await EK.decide(token, True, self.out, None), C.MSG_EKSPORT_QABUL)
        await asyncio.gather(*list(EK._BG_TASKS))
        [run] = [c for c in self.calls if c["path"].endswith("/run")]
        self.assertEqual((run["path"], run["method"], run["body"]), ("/api/agent-bridge/exports/sheet-2/run", "POST", {}))
        self.assertIn('Eksport "Дебетор" bajarildi: 118 qator yozildi (120 ta olindi), 7 soniya.', self.texts()[-1])
        self.assertEqual(await EK.decide(token, True, self.out, None), C.MSG_MUDDAT_OTGAN)   # bir martalik

    async def test_nom_bitta_mos_darrov_tasdiq(self):
        await EK.handle("EKSPORT: sotuv bulimi", self.out)
        p = self._sorov_xabari("Eksportni ishga tushirish")
        self.assertIn("Сотув Булими отчети", p["text"])
        self.assertTrue(self._token(C.KV_EK_APPR))

    async def test_mos_kelmasa_royxat_va_xato_natija(self):
        await EK.handle("EKSPORT: yoq narsa", self.out)
        self.assertIn('"yoq narsa" ga mos eksport topilmadi', self.texts()[-1])
        await EK.handle("EKSPORT: Debetor", self.out)
        token = self._token(C.KV_EK_APPR)
        self.javob["run"] = {"ok": False, "sheet": {"id": "sheet-2", "name": "Дебетор"}, "step": "write",
                             "error": "The service is currently unavailable.", "durationMs": 300}
        await EK.decide(token, True, self.out, None)
        await asyncio.gather(*list(EK._BG_TASKS))
        self.assertIn('Eksport "Дебетор" bajarilmadi: The service is currently unavailable. (bosqich: write).',
                      self.texts()[-1])

    async def test_yoq_va_koprik_cheklovi(self):
        await EK.handle("EKSPORT: Debetor", self.out)
        token = self._token(C.KV_EK_APPR)
        self.assertEqual([t for t, _p in EK.kutilayotgan()], [token])
        self.assertEqual(await EK.decide(token, False, self.out, None), C.MSG_EKSPORT_BEKOR)
        self.assertFalse([c for c in self.calls if c["path"].endswith("/run")])
        self.assertEqual(EK.kutilayotgan(), [])
        with self.assertRaises(ValueError):                              # ruxsatsiz run yo'li yopiq
            TZ._koprik("/api/agent-bridge/exports/sheet-1/run")
        with self.assertRaises(ValueError):                              # ruxsat bilan ham faqat run naqshi
            TZ._koprik("/api/agent-bridge/exports/../x", ruxsat_run=True)


if __name__ == "__main__":
    unittest.main()
