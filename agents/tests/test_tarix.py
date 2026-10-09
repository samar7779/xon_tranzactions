"""tarix: eski tarixni bankdan yuklash bot orqali (backfill) — ko'prik soxta, kutish tezlashtirilgan; tarmoq yo'q."""
from __future__ import annotations

import asyncio
import unittest
from typing import Any, List
from unittest import mock

from agents import config
from agents import contract as C
from agents import tarix as TR
from agents import tuzatish as TZ
from agents.tests.test_leader_reply import LB, _FlowBase, _leader_json, _msg
from agents.tests.test_tuzatish import _Base

BOSHI = {"ok": True, "startedAt": "2026-10-09T06:00:00.000Z", "qamrov": "Kapitalbank (sync yoqilgan hisoblar)",
         "hisoblar": 2, "kunlar": 5, "dan": "2026-10-01", "gacha": "2026-10-05", "ogohlantirish": None}
XATO = {"hisob": "20208000205720456001 · VATAN", "xabar": "Hisob boshqa sync bilan band edi — shu hisob uchun qayta yuklang"}


def _h(boshlangan: int, tugagan: int, olindi: int, yangi: int, ish: Any = None, xatolar: Any = ()) -> dict:
    return {"ok": True, "boshlangan": boshlangan, "tugagan": tugagan, "olindi": olindi, "yangi": yangi, "xato": 0,
            "xatolar": list(xatolar), "ish": ish}


class ParseTest(unittest.TestCase):
    def test_kalitli_kalitsiz_holat(self):
        self.assertEqual(TR.parse("TARIX: dan=2026-10-01 gacha=2026-10-05 bank=Kapitalbank"),
                         {"dan": "2026-10-01", "gacha": "2026-10-05", "bank": "Kapitalbank", "hisob": None, "holat": None})
        self.assertEqual(TR.parse("TARIX: 01.10.2026 5.10.2026 Kapitalbank")["gacha"], "2026-10-05")
        q = TR.parse("TARIX: 03.10.2026 2020 8000 9049 0096 0001")
        self.assertEqual((q["dan"], q["gacha"], q["hisob"], q["bank"]), ("2026-10-03", "2026-10-03", "20208000904900960001", None))
        self.assertIsNone(TR.parse("TARIX: dan=2026-10-03 bank=hammasi")["bank"])
        self.assertEqual(TR.parse("TARIX: holat")["holat"], "1")
        self.assertEqual(TR.parse("TARIX: qayerda?")["holat"], "1")
        self.assertIsNone(TR.parse("TARIX: 31.02.2026")["dan"])               # yaroqsiz sana
        self.assertIsNone(TR.parse("tarixni yukla"))
        self.assertIn(C.INTENT_TARIX, C.INTENTS)
        self.assertIn(C.TARIX_KOPRIK_HOLAT, TZ._YOLLAR)


class OqimTest(_Base):
    def setUp(self) -> None:
        super().setUp()
        p = mock.patch.object(TR, "_kut", mock.AsyncMock())
        p.start()
        self.addCleanup(p.stop)
        self.javob["yukla"] = BOSHI

    async def _tugat(self) -> None:
        await asyncio.gather(*list(TR._BG_TASKS))

    async def test_boshlaydi_okv_syncni_kutadi_natija(self):
        holatlar = iter([
            _h(1, 0, 10, 1, ish={"tugadi": False, "okv": None, "okvXato": None}),
            _h(2, 2, 52, 7, ish={"tugadi": False, "okv": None, "okvXato": None}, xatolar=[XATO]),   # OplatyKv sync hali
            _h(2, 2, 52, 7, ish={"tugadi": True, "okv": {"qoshildi": 6, "yangilandi": 1, "yozilmadi": 0}, "okvXato": None},
               xatolar=[XATO]),
        ])
        self.javob["holat"] = lambda body, q: next(holatlar)
        await TR.handle("TARIX: dan=2026-10-01 gacha=2026-10-05 bank=Kapitalbank", self.out, reply_to=4)
        y = self.calls[0]
        self.assertEqual((y["path"], y["method"], y["body"]),
                         (C.TARIX_KOPRIK_YUKLA, "POST", {"dan": "2026-10-01", "gacha": "2026-10-05", "bank": "Kapitalbank"}))
        self.assertIn("Eski tarix yuklash boshlandi: Kapitalbank (sync yoqilgan hisoblar), 01.10.2026 - 05.10.2026"
                      " (5 kun), 2 hisob.", self.texts()[0])
        self.assertEqual(self.kv[C.KV_TARIX_OXIRGI]["xabar"], False)
        await self._tugat()
        self.assertEqual(len([c for c in self.calls if c["path"] == C.TARIX_KOPRIK_HOLAT]), 3)
        self.assertEqual(self.calls[1]["q"], {"since": ["2026-10-09T06:00:00.000Z"]})
        t = self.texts()[-1]
        for frag in ("Eski tarix yuklandi: Kapitalbank (sync yoqilgan hisoblar), 01.10.2026 - 05.10.2026.",
                     "Hisoblar: 2 / 2 tugadi.", "Bankdan olindi: 52 ta, yangi qo'shildi: 7 ta.",
                     "OplatyKv: qo'shildi 6, yangilandi 1.",
                     "• 20208000205720456001 · VATAN: Hisob boshqa sync bilan band edi"):
            self.assertIn(frag, t)
        self.assertEqual(self.kv[C.KV_TARIX_OXIRGI]["xabar"], True)

    async def test_toxtab_qoldi_va_restartdan_keyin(self):
        self.javob["holat"] = _h(1, 1, 5, 0)                                  # ish=None: backend restart bo'lgan
        await TR.handle("TARIX: 01.10.2026", self.out)
        self.assertEqual(self.calls[0]["body"], {"dan": "2026-10-01", "gacha": "2026-10-01"})
        await self._tugat()
        t = self.texts()[-1]
        self.assertIn("TO'XTAB QOLDI", t)
        self.assertIn("Hisoblar: 1 / 2 tugadi.", t)
        self.assertLessEqual(len([c for c in self.calls if c["path"] == C.TARIX_KOPRIK_HOLAT]),
                             C.TARIX_TOXTADI_S // C.TARIX_QADAM_S + 2)

    async def test_holat_buyrugi(self):
        await TR.handle("TARIX: holat", self.out)
        self.assertIn("Oxirgi 24 soatda bot orqali boshlangan eski tarix yuklash yo'q", self.texts()[-1])
        self.kv[C.KV_TARIX_OXIRGI] = {"boshi": BOSHI, "xabar": False, "ts": config.now_utc().timestamp()}
        self.javob["holat"] = _h(2, 1, 20, 3, ish={"tugadi": False, "okv": None, "okvXato": None})
        await TR.handle("TARIX: holat", self.out)
        t = self.texts()[-1]
        self.assertIn("Eski tarix yuklash davom etyapti: Kapitalbank", t)
        self.assertIn("Hisoblar: 1 / 2 tugadi.", t)
        self.assertNotIn("OplatyKv:", t)
        self.javob["holat"] = _h(2, 2, 40, 0, ish=None)
        await TR.handle("TARIX: holat", self.out)
        self.assertIn("Eski tarix yuklandi", self.texts()[-1])
        self.assertIn("Yangi to'lov yo'q — OplatyKv o'zgarmadi.", self.texts()[-1])

    async def test_xato_va_sanasiz(self):
        self.javob["yukla"] = TZ.KoprikXato("HTTP 409: Eski tarix yuklash allaqachon ishlayapti")
        await TR.handle("TARIX: dan=2026-10-01", self.out)
        self.assertIn("boshlanmadi: HTTP 409: Eski tarix yuklash allaqachon ishlayapti", self.texts()[-1])
        self.assertEqual(TR._BG_TASKS, set())
        self.assertNotIn(C.KV_TARIX_OXIRGI, self.kv)
        await TR.handle("TARIX: kecha", self.out)
        self.assertEqual(self.texts()[-1], C.MSG_TARIX_FOYDALANISH)


class LeaderOqimTest(_FlowBase):
    async def test_qator_botga(self):
        chaqiruv: List[Any] = []

        class FakeTR:
            @staticmethod
            async def handle(text: Any, outbox: Any, reply_to: Any = None) -> bool:
                chaqiruv.append((text.splitlines()[0], reply_to))
                return True

        self._patch(LB, "_mod", lambda name: FakeTR if name == "tarix" else None)
        self.replies = [(C.RUN_OK, _leader_json("Boshlayapman", intent=C.INTENT_TARIX,
                                                task="TARIX: dan=2026-10-01 gacha=2026-10-05 bank=Kapitalbank"))]
        await self.handle(_msg(904, "kapitalbank 1-5 oktabr vipiskasini qayta yukla"))
        self.assertEqual(chaqiruv, [("TARIX: dan=2026-10-01 gacha=2026-10-05 bank=Kapitalbank", 904)])


if __name__ == "__main__":
    unittest.main()
