"""ariza: XATO to'lovga ariza (TR Support) va matnli tasdiq — ko'prik, kv, tarix soxta; tarmoq yo'q."""
from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from typing import Any, List
from unittest import mock

from agents import ariza as AR
from agents import config
from agents import contract as C
from agents import tuzatish as TZ
from agents.tests.test_leader_reply import LB, _FlowBase, _msg
from agents.tests.test_tuzatish import _Base

FAYL = "leader_bot_0123456789abcdef.jpg"
TXF = "6614176749_99517844_29.09.2026_20208000205720456001_17409000900001158111_710000000_-"
KAND = {"oplataKvId": "ck3q9x0000abcd0000abcd", "txId": TXF, "date": "2026-09-29", "amount": 7100000,
        "contractNo": "467RZM26HA", "client": None, "purpose": "Suyunova Karomat Faxriddin Qizi uy joy", "toAccount":
        "20208000205720456001", "fromAccount": None, "direction": "IN", "pending": None}
CRM = {"contract": "467RMZ26HA", "found": True, "customerName": "СУЮНОВА КАРОМАТ ФАХРИДДИН КИЗИ", "objectName": "RMZ"}


class ParseTest(unittest.TestCase):
    def test_parse_va_normallash(self):
        a = AR.parse("ARIZA: summa=7 100 000,00 sana=29.09.2026 hisob=2020 8000 2057 2045 6001 shartnoma=№467rmz26ha "
                     "tolovchi=Suyunova Karomat Faxriddin qizi tasdiq=Samar")
        self.assertEqual((a.summa, a.sana, a.hisob, a.shartnoma, a.tolovchi, a.tasdiq),
                         ("7100000.00", "2026-09-29", "20208000205720456001", "467RMZ26HA",
                          "Suyunova Karomat Faxriddin qizi", "Samar"))
        self.assertEqual(AR.parse("ARIZA: summa=7.100.000 sana=2026-09-29 shartnoma=X1").summa, "7100000")
        self.assertIsNone(AR.parse("oddiy matn"))

    def test_ism_mos_va_obyekt(self):
        self.assertTrue(AR.ism_mos("Suyunova Karomat Faxriddin qizi", "СУЮНОВА КАРОМАТ ФАХРИДДИН КИЗИ"))
        self.assertTrue(AR.ism_mos("Fakhriddinov Anvar", "Faxriddinov Anvar"))
        self.assertFalse(AR.ism_mos("Ahmedov Anvar", "Suyunova Karomat"))
        self.assertIsNone(AR.ism_mos("", "X"))
        self.assertEqual((AR.obyekt("467RMZ26HA"), AR.obyekt("467RZM26HA"), AR.obyekt("xato")), ("RMZ", "RZM", ""))

    def test_matn_qaror(self):
        for t in ("Tasdiqlayman", "ha", "Ha, tahrirla", "tasdiq!", "bajaring", "OK"):
            self.assertIs(TZ.matn_qaror(t), True, t)
        for t in ("yo'q", "Yoʻq", "bekor qiling", "kerak emas"):
            self.assertIs(TZ.matn_qaror(t), False, t)
        for t in ("ha lekin avval tekshir", "tasdiqlayman, shartnoma 467RMZ26HA emas 467RMZ26HB", "", "x" * 50):
            self.assertIsNone(TZ.matn_qaror(t), t)


class ArizaOqimTest(_Base):
    def setUp(self) -> None:
        super().setUp()
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name)
        (self.dir / FAYL).write_bytes(b"rasm")
        p = mock.patch.object(config, "UPLOADS_DIR", self.dir)
        p.start()
        self.addCleanup(p.stop)
        self.kutish: List[float] = []

        async def kut(s: float) -> None:
            self.kutish.append(s)
        p2 = mock.patch.object(AR, "_kut", kut)
        p2.start()
        self.addCleanup(p2.stop)

    async def _sorov(self, **ustiga: Any) -> str:
        self.javob["find"] = dict({"ok": True, "candidates": [KAND], "hisobMos": True, "crm": CRM, "aiName": "Shomurad AI"}, **ustiga)
        await AR.handle("ARIZA: summa=7100000 sana=2026-09-29 hisob=20208000205720456001 shartnoma=467RMZ26HA "
                        "tolovchi=Suyunova Karomat Faxriddin qizi tasdiq=Samar", self.out, rasmlar=[str(self.dir / FAYL)])
        s = [x for x in self.out.sent if x.get("keyboard")]
        return s[-1]["keyboard"][0][0][1][len(C.CB_AR_OK):] if s else ""

    async def test_tasdiq_sorovi_va_ha_ai_natijasi(self):
        token = await self._sorov()
        [c] = [x for x in self.calls if x["path"] == C.ARIZA_KOPRIK_FIND]
        self.assertEqual(c["q"], {"summa": ["7100000"], "sana": ["2026-09-29"], "hisob": ["20208000205720456001"],
                                  "shartnoma": ["467RMZ26HA"]})
        t = [x for x in self.out.sent if x.get("keyboard")][-1]["text"]
        for frag in ("XATO to'lovga ariza", "<code>%s</code>" % TXF, "Hozir: shartnoma 467RZM26HA (XATO)",
                     "Yangi shartnoma: <b>467RMZ26HA</b>", "CRM mijozi bilan mos", "boshqa obyektda (RZM, yangisi RMZ)",
                     "Shomurad AI arizani xodimga yuborishi mumkin", "TR Support · Samar", "\"tasdiqlayman\""):
            self.assertIn(frag, t)
        self.javob["submit"] = {"ok": True, "id": "req1", "alreadyPending": False, "contract": "467RMZ26HA",
                                "aiEnabled": True, "aiName": "Shomurad AI"}
        holatlar = [{"ok": True, "status": "pending", "agentState": "processing"},
                    {"ok": True, "status": "approved", "agentState": "done", "contract": "467RMZ26HA",
                     "agentReason": "ariza va to'lov mos", "aiName": "Shomurad AI"}]
        self.javob["status"] = lambda body, q: holatlar.pop(0)
        self.assertEqual(await AR.decide(token, True, self.out, None), C.MSG_ARIZA_QABUL)
        await _gather()
        [s] = [x for x in self.calls if x["path"] == C.ARIZA_KOPRIK_SUBMIT]
        self.assertEqual(s["body"], {"oplataKvId": KAND["oplataKvId"], "contractNo": "467RMZ26HA", "fayl": FAYL,
                                     "yubordi": "TR Support · Samar"})
        tx = self.texts()
        self.assertIn("Ariza yuborildi (#req1)", tx[-2])
        self.assertIn("Shomurad AI: ariza tasdiqlandi — to'lov 467RMZ26HA shartnomasiga biriktirildi", tx[-1])
        self.assertEqual(self.kutish, [C.ARIZA_KUT_QADAM_S] * 2)

    async def test_topilmadi_kop_crmda_yoq_pending_faylsiz(self):
        await self._sorov(candidates=[])
        self.assertIn("XATO to'lovlar ro'yxatida bunday to'lov topilmadi", self.texts()[-1])
        self.assertIn("XATO deb belgila", self.texts()[-1])
        await self._sorov(candidates=[KAND, dict(KAND, txId="BOSHQA_1_29.09.2026_A_B_1_-")])
        self.assertIn("2 ta mos to'lov bor", self.texts()[-1])
        await self._sorov(crm=dict(CRM, found=False))
        self.assertIn("CRM'da topilmadi — boshqa shartnoma bering", self.texts()[-1])
        await self._sorov(candidates=[dict(KAND, pending={"by": "Dilnoza", "at": "2026-09-30T08:00:00Z", "contract": "467RMZ26HA"})])
        self.assertIn("ariza allaqachon yuborilgan (Dilnoza, 2026-09-30", self.texts()[-1])
        self.assertFalse(any(x.get("keyboard") for x in self.out.sent))
        (self.dir / FAYL).unlink()
        await AR.handle("ARIZA: summa=7100000 sana=2026-09-29 shartnoma=467RMZ26HA", self.out, rasmlar=[])
        self.assertIn("Ariza faylini (rasm) yuboring", self.texts()[-1])

    async def test_yoq_va_ai_ochiq(self):
        token = await self._sorov()
        self.assertEqual(await AR.decide(token, False, self.out, None), C.MSG_ARIZA_BEKOR)
        self.assertFalse([x for x in self.calls if x["path"] == C.ARIZA_KOPRIK_SUBMIT])
        token = await self._sorov()
        self.javob["submit"] = {"ok": True, "id": "req2", "alreadyPending": False, "contract": "467RMZ26HA",
                                "aiEnabled": False, "aiName": "Shomurad AI"}
        await AR.decide(token, True, self.out, None)
        await _gather()
        self.assertIn("AI tekshiruvchi o'chiq: xodim tasdiqlaydi", self.texts()[-1])
        self.assertFalse([x for x in self.calls if x["path"] == C.ARIZA_KOPRIK_STATUS])


async def _gather() -> None:
    import asyncio
    await asyncio.gather(*list(AR._BG_TASKS))


class MatnTasdiqTest(_FlowBase):
    """Egasi "tasdiqlayman" deb yozsa (tugmasiz): kutilayotgan tasdiq tugma kabi; LLM chaqirilmaydi."""

    def _mods(self, tz_kut: Any, ar_kut: Any) -> List[Any]:
        qarorlar: List[Any] = []

        class FakeTZ:
            matn_qaror = staticmethod(TZ.matn_qaror)

            @staticmethod
            def kutilayotgan() -> Any:
                return tz_kut

            @staticmethod
            async def decide(token: str, approve: bool, outbox: Any, mid: Any) -> str:
                qarorlar.append(("tz", token, approve, mid))
                return C.MSG_TUZATISH_QABUL if approve else C.MSG_TUZATISH_BEKOR

        class FakeAR:
            @staticmethod
            def kutilayotgan() -> Any:
                return ar_kut

            @staticmethod
            async def decide(token: str, approve: bool, outbox: Any, mid: Any) -> str:
                qarorlar.append(("ar", token, approve, mid))
                return C.MSG_ARIZA_QABUL if approve else C.MSG_ARIZA_BEKOR

        self._patch(LB, "_mod", lambda name: {"tuzatish": FakeTZ, "ariza": FakeAR}.get(name))
        return qarorlar

    async def test_bitta_kutilayotgan_tasdiqlanadi(self):
        q = self._mods([("a" * 16, {"mid": 70})], [])
        await self.handle(_msg(901, "Tasdiqlayman"))
        self.assertEqual(q, [("tz", "a" * 16, True, 70)])
        self.assertEqual(self.runs, [])                                   # Leader chaqirilmadi
        self.assertIn(C.MSG_TUZATISH_QABUL, self.outbox.sent[-1].text)

    async def test_ikkita_bolsa_reply_aniqlaydi_yoki_soraydi(self):
        q = self._mods([("a" * 16, {"mid": 70})], [("b" * 16, {"mid": 80})])
        await self.handle(_msg(902, "ha"))
        self.assertEqual(q, [])
        self.assertIn(C.MSG_TASDIQ_QAYSI, self.outbox.sent[-1].text)
        replied = _msg(80, "XATO to'lovga ariza")
        m = _msg(903, "yo'q")
        m.reply_to_message = replied
        await self.handle(m)
        self.assertEqual(q, [("ar", "b" * 16, False, 80)])

    async def test_kutilayotgan_yoq_yoki_uzun_matn_leaderga(self):
        from agents.tests.test_leader_reply import _leader_json
        self._mods([], [])
        self.replies = [(C.RUN_OK, _leader_json("Salom"))]
        await self.handle(_msg(904, "ha"))
        self.assertEqual([a for a, _t in self.runs], ["leader"])


if __name__ == "__main__":
    unittest.main()
