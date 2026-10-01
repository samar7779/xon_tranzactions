"""eksport: Google Sheets eksportini bot orqali qayta ishga tushirish — ko'prik, kv, tarix soxta; tarmoq yo'q."""
from __future__ import annotations

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


class EksportTest(_Base):
    def setUp(self) -> None:
        super().setUp()
        self.javob["exports"] = {"ok": True, "credentialsAvailable": True, "items": ITEMS}

    def _kb(self) -> List[Any]:
        return [x for x in self.out.sent if x.get("keyboard")]

    def test_parse(self):
        self.assertEqual(EK.parse("EKSPORT: Sotuv"), "Sotuv")
        self.assertEqual(EK.parse("EKSPORT:"), "")
        self.assertEqual(EK.parse("EKSPORT: nomi=Debetor"), "Debetor")
        self.assertIsNone(EK.parse("oddiy matn"))

    async def test_nomsiz_royxat_tugmalar_tanlash_ha(self):
        await EK.handle("EKSPORT:", self.out)
        [s] = self._kb()
        self.assertIn("Qaysi eksportni ishga tushiray?", s["text"])
        self.assertIn("1. Сотув Булими отчети — oxirgi: 30.09 15:16, OK, 270 007 qator; avtomatik har 120 daq, 08-23",
                      s["text"])
        self.assertIn("2. Дебетор — oxirgi: hali ishlamagan; avtomatik o'chiq", s["text"])
        (t1, cb1), = s["keyboard"][0]
        self.assertTrue(cb1.startswith(C.CB_EK_TANLA) and cb1.endswith(":0"), cb1)
        toast = await EK.tanla(s["keyboard"][1][0][1], self.out, 5)
        self.assertEqual(toast, "Tanlandi: Дебетор")
        p = self._kb()[-1]
        self.assertIn("Sheet: <b>Дебетор</b> / Лист1", p["text"])
        self.assertIn("rejim: yangilash (upsert)", p["text"])
        token = p["keyboard"][0][0][1][len(C.CB_EK_OK):]
        self.javob["run"] = {"ok": True, "sheet": {"id": "sheet-2", "name": "Дебетор", "tabName": "Лист1"},
                             "writeMode": "upsert", "rowsFetched": 120, "rowsWritten": 118, "writtenRange": "A2:F119",
                             "dateFrom": None, "dateTo": "2026-10-01", "durationMs": 7400}
        self.assertEqual(await EK.decide(token, True, self.out, None), C.MSG_EKSPORT_QABUL)
        import asyncio
        await asyncio.gather(*list(EK._BG_TASKS))
        [run] = [c for c in self.calls if c["path"].endswith("/run")]
        self.assertEqual((run["path"], run["method"], run["body"]), ("/api/agent-bridge/exports/sheet-2/run", "POST", {}))
        self.assertIn('Eksport "Дебетор" bajarildi: 118 qator yozildi (120 ta olindi), 7 soniya.', self.texts()[-1])
        self.assertEqual(await EK.decide(token, True, self.out, None), C.MSG_MUDDAT_OTGAN)   # bir martalik

    async def test_nom_bitta_mos_darrov_tasdiq(self):
        await EK.handle("EKSPORT: sotuv bulimi", self.out)
        [p] = self._kb()
        self.assertIn("Eksportni ishga tushirish", p["text"])
        self.assertIn("Sotuv Bulimi Otcheti".lower(), p["text"].lower().replace("<b>", "").replace("</b>", "")
                      .replace("сотув булими отчети", "sotuv bulimi otcheti"))
        self.assertEqual(p["keyboard"][0][0][0], C.KNOPKA_EK_HA)

    async def test_mos_kelmasa_royxat_va_xato_natija(self):
        await EK.handle("EKSPORT: yoq narsa", self.out)
        self.assertIn('"yoq narsa" ga mos eksport topilmadi', self._kb()[-1]["text"])
        await EK.handle("EKSPORT: Debetor", self.out)
        token = self._kb()[-1]["keyboard"][0][0][1][len(C.CB_EK_OK):]
        self.javob["run"] = {"ok": False, "sheet": {"id": "sheet-2", "name": "Дебетор"}, "step": "write",
                             "error": "The service is currently unavailable.", "durationMs": 300}
        await EK.decide(token, True, self.out, None)
        import asyncio
        await asyncio.gather(*list(EK._BG_TASKS))
        self.assertIn('Eksport "Дебетор" bajarilmadi: The service is currently unavailable. (bosqich: write).',
                      self.texts()[-1])

    async def test_yoq_va_koprik_cheklovi(self):
        await EK.handle("EKSPORT: Debetor", self.out)
        token = self._kb()[-1]["keyboard"][0][0][1][len(C.CB_EK_OK):]
        self.assertEqual(await EK.decide(token, False, self.out, None), C.MSG_EKSPORT_BEKOR)
        self.assertFalse([c for c in self.calls if c["path"].endswith("/run")])
        with self.assertRaises(ValueError):                              # ruxsatsiz run yo'li yopiq
            TZ._koprik("/api/agent-bridge/exports/sheet-1/run")
        with self.assertRaises(ValueError):                              # ruxsat bilan ham faqat run naqshi
            TZ._koprik("/api/agent-bridge/exports/../x", ruxsat_run=True)
        from unittest import mock
        with mock.patch.object(EK.db, "kv_keys", lambda pre: [k for k in self.kv if k.startswith(pre)]):
            self.assertEqual(EK.kutilayotgan(), [])                      # rad etilgan so'rov kutilmaydi
            await EK.handle("EKSPORT: Debetor", self.out)
            self.assertEqual([t for t, _p in EK.kutilayotgan()],
                             [self._kb()[-1]["keyboard"][0][0][1][len(C.CB_EK_OK):]])


if __name__ == "__main__":
    unittest.main()
