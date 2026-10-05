"""perebroska: AI Perebroska bot orqali (tahlil -> tasdiq -> yaratish) — ko'prik, kv va fayl soxta; tarmoq yo'q."""
from __future__ import annotations

import asyncio
import tempfile
import unittest
from pathlib import Path
from typing import Any, Dict, List
from unittest import mock

from agents import config
from agents import contract as C
from agents import perebroska as PB
from agents import tuzatish as TZ
from agents.tests.test_leader_reply import LB, _FlowBase, _leader_json, _msg
from agents.tests.test_tuzatish import _Base

FAYL = "leader_bot_0123456789abcdef.pdf"
TAHLIL: Dict[str, Any] = {
    "ok": True, "agentState": "verified", "agentReason": "ok", "warnings": [], "balanceEnough": True, "duplicates": [],
    "extracted": {
        "fromContractNo": "24SRH24EF", "fromClient": "AHMEDOV ANVAR", "fromFound": True, "objectName": "SRH",
        "fromBalance": 120000000, "totalAmount": 70944290, "amountCorrected": False, "date": "2026-10-05",
        "destinations": [{"contractNo": "4105SRH26RL", "amount": 70944290, "client": "AHMEDOVA ANBAR", "object": "SRH",
                          "found": True, "balance": 0}],
        "applicantName": "Ahmedova Anbar", "applicantMatchesHolder": True, "notes": "- manba **24SRH24EF**",
    },
}
YARAT = {"ok": True, "groupId": "g1", "amount": 70944290, "qatorlar": [
    {"contractNo": "24SRH24EF", "summa": -70944290, "sana": "2026-10-05T00:00:00.000Z", "mijoz": "AHMEDOV ANVAR", "obyekt": "SRH"},
    {"contractNo": "4105SRH26RL", "summa": 70944290, "sana": "2026-10-05T00:00:00.000Z", "mijoz": "AHMEDOVA ANBAR", "obyekt": "SRH"}]}


class ParseTest(unittest.TestCase):
    def test_parse_va_contract(self):
        s = PB.parse("PEREBROSKA: fayl=%s tasdiq=Salokhiddin izoh=03.10 ariza" % FAYL)
        self.assertEqual((s.fayl, s.tasdiq, s.izoh), (FAYL, "Salokhiddin", "03.10 ariza"))
        self.assertIsNone(PB.parse("perebroska qil"))
        self.assertIn(C.INTENT_PEREBROSKA, C.INTENTS)
        self.assertIn(C.PEREBROSKA_KOPRIK_YARAT, TZ._YOLLAR)

    def test_toskiqlar(self):
        self.assertEqual(PB.toskiqlar(TAHLIL), [])
        r = {**TAHLIL, "balanceEnough": False, "extracted": {**TAHLIL["extracted"], "destinations": [
            {"contractNo": "77ZUR26AA", "amount": 70944290, "object": "ZUR", "found": True}]}}
        self.assertEqual(PB.toskiqlar(r), ["obyekt mos emas: 77ZUR26AA (ZUR), manba SRH", "manba qoldig'i yetarli emas"])
        r = {**TAHLIL, "extracted": {**TAHLIL["extracted"], "fromFound": False, "totalAmount": 5}}
        self.assertIn("manba shartnoma 24SRH24EF topilmadi (CRM va to'lovlarda yo'q)", PB.toskiqlar(r))
        self.assertIn("maqsad summalari jami o'tkaziladigan summaga teng emas", PB.toskiqlar(r))


class OqimTest(_Base):
    def setUp(self) -> None:
        super().setUp()
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name)
        (self.dir / FAYL).write_bytes(b"%PDF")
        p = mock.patch.object(config, "UPLOADS_DIR", self.dir)
        p.start()
        self.addCleanup(p.stop)
        self.javob["tahlil"] = TAHLIL
        self.javob["yarat"] = YARAT

    async def test_tahlil_tasdiq_yaratish_natija(self):
        await PB.handle("PEREBROSKA: tasdiq=Salokhiddin izoh=ariza", self.out, reply_to=3, rasmlar=[str(self.dir / FAYL)])
        [c] = self.calls
        self.assertEqual((c["path"], c["method"], c["body"]), (C.PEREBROSKA_KOPRIK_TAHLIL, "POST", {"fayl": FAYL}))
        self.assertEqual(self.texts()[0], C.MSG_PEREBROSKA_TAHLIL)
        s = self._sorov_xabari("AI Perebroska")
        for frag in ("<b>AI Perebroska</b> — tasdiqlang", "Manba: <b>24SRH24EF</b> — AHMEDOV ANVAR, SRH; to'langan 120 000 000 so'm",
                     "O'tkaziladigan summa: <b>70 944 290 so'm</b>", "1. <b>4105SRH26RL</b> — 70 944 290 so'm (AHMEDOVA ANBAR, SRH)",
                     "Arizachi: Ahmedova Anbar (maqsad egasiga mos)", "Agent xulosasi: hujjat mos", "Agent izohi: - manba 24SRH24EF",
                     "Tasdiqladi: <b>Salokhiddin</b>", 'Tasdiqlash uchun "tasdiqlayman" deb yozing'):
            self.assertIn(frag, s["text"])
        self.assertFalse([x for x in self.calls if x["path"] == C.PEREBROSKA_KOPRIK_YARAT])   # tasdiqsiz yaratilmaydi
        token = self._token(C.KV_PB_APPR)
        self.assertEqual([t for t, _p in PB.kutilayotgan()], [token])
        self.assertEqual(await PB.decide(token, True, self.out, None), C.MSG_PEREBROSKA_QABUL)
        await asyncio.gather(*list(PB._BG_TASKS))
        [y] = [x for x in self.calls if x["path"] == C.PEREBROSKA_KOPRIK_YARAT]
        self.assertEqual({k: y["body"][k] for k in ("fayl", "fromContractNo", "amount", "date", "destinations", "agentState", "tasdiq", "izoh")},
                         {"fayl": FAYL, "fromContractNo": "24SRH24EF", "amount": 70944290, "date": "2026-10-05",
                          "destinations": [{"contractNo": "4105SRH26RL", "amount": 70944290}], "agentState": "verified",
                          "tasdiq": "Salokhiddin", "izoh": "ariza"})
        self.assertEqual(y["body"]["agentData"]["fromContractNo"], "24SRH24EF")
        t = self.texts()[-1]
        for frag in ("Perebroska yaratildi (tasdiq: Salokhiddin), 70 944 290 so'm:", "• 24SRH24EF: -70 944 290 so'm, 05.10.2026",
                     "• 4105SRH26RL: +70 944 290 so'm, 05.10.2026 — AHMEDOVA ANBAR, SRH", "OplatyKv'ga 2 qator qo'shildi."):
            self.assertIn(frag, t)
        self.assertEqual(await PB.decide(token, True, self.out, None), C.MSG_MUDDAT_OTGAN)   # bir martalik

    async def test_tasdiqlovchisiz_ism_soraladi_tahlil_keshdan(self):
        await PB.handle("PEREBROSKA: fayl=%s" % FAYL, self.out)
        self.assertIn(C.MSG_PEREBROSKA_KIM, self.texts()[-1])
        self.assertEqual(self._token(C.KV_PB_APPR), "")
        await PB.handle("PEREBROSKA: fayl=%s tasdiq=Salokhiddin" % FAYL, self.out)
        self.assertEqual(len([x for x in self.calls if x["path"] == C.PEREBROSKA_KOPRIK_TAHLIL]), 1)   # AI qayta chaqirilmadi
        self.assertTrue(self._token(C.KV_PB_APPR))

    async def test_toskiq_bolsa_tasdiq_yoq_va_rad(self):
        self.javob["tahlil"] = {**TAHLIL, "extracted": {**TAHLIL["extracted"], "destinations": [
            {"contractNo": "4105SRH26RL", "amount": 70944290, "found": False}]}}
        await PB.handle("PEREBROSKA: fayl=%s tasdiq=S" % FAYL, self.out)
        t = self.texts()[-1]
        self.assertIn("<b>Yaratib bo'lmaydi:</b> maqsadli shartnoma 4105SRH26RL topilmadi.", t)
        self.assertNotIn("tasdiqlayman", t)
        self.assertEqual(self._token(C.KV_PB_APPR), "")

    async def test_yoq_word_fayl_va_faylsiz(self):
        self.javob["tahlil"] = TAHLIL
        await PB.handle("PEREBROSKA: fayl=%s tasdiq=S" % FAYL, self.out)
        token = self._token(C.KV_PB_APPR)
        self.assertEqual(await PB.decide(token, False, self.out, None), C.MSG_PEREBROSKA_BEKOR)
        self.assertFalse([x for x in self.calls if x["path"] == C.PEREBROSKA_KOPRIK_YARAT])
        word = "leader_bot_00000000000000aa.docx"
        (self.dir / word).write_bytes(b"doc")
        await PB.handle("PEREBROSKA: fayl=%s" % word, self.out)
        self.assertIn("faqat PDF yoki rasmni o'qiydi", self.texts()[-1])
        await PB.handle("PEREBROSKA:", self.out)
        self.assertIn("faylini yuboring", self.texts()[-1])


class LeaderOqimTest(_FlowBase):
    async def test_qator_botga_fayl_bilan(self):
        chaqiruv: List[Any] = []

        class FakePB:
            @staticmethod
            async def handle(text: Any, outbox: Any, reply_to: Any = None, rasmlar: Any = ()) -> bool:
                chaqiruv.append((text.splitlines()[0], reply_to))
                return True

        self._patch(LB, "_mod", lambda name: FakePB if name == "perebroska" else None)
        self.replies = [(C.RUN_OK, _leader_json("Ko'ryapman", intent=C.INTENT_PEREBROSKA,
                                                task="PEREBROSKA: fayl=%s tasdiq=Salokhiddin" % FAYL))]
        await self.handle(_msg(903, "shu perebroska arizasini qil, tasdiq Salokhiddin"))
        self.assertEqual(chaqiruv, [("PEREBROSKA: fayl=%s tasdiq=Salokhiddin" % FAYL, 903)])


if __name__ == "__main__":
    unittest.main()
