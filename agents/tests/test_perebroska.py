"""perebroska: AI Perebroska bot orqali (tahlil -> darrov yaratish, tasdiqsiz; egasi qarori 2026-10-07) —
ko'prik, kv va fayl soxta; tarmoq yo'q."""
from __future__ import annotations

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
        "fromContractNo": "1817ZUR24HW", "fromClient": "Abdukadirov Alisher Abdurasilovich", "fromFound": True,
        "objectName": "ЗУРСАН", "fromBalance": 120000000, "totalAmount": 95000000, "amountCorrected": False,
        "date": "2026-10-05",
        "destinations": [{"contractNo": "1818ZUR24QB", "amount": 95000000, "client": "Abdukadirov Alisher Abdurasilovich",
                          "object": "ЗУРСАН", "found": True, "balance": 0}],
        "applicantName": "Abdukadirov Alisher", "applicantMatchesHolder": True, "notes": "- manba **1817ZUR24HW**",
    },
}
YARAT = {"ok": True, "groupId": "pg_7f3a", "amount": 95000000, "qatorlar": [
    {"contractNo": "1817ZUR24HW", "summa": -95000000, "sana": "2026-10-05T00:00:00.000Z",
     "mijoz": "Abdukadirov Alisher Abdurasilovich", "obyekt": "ЗУРСАН"},
    {"contractNo": "1818ZUR24QB", "summa": 95000000, "sana": "2026-10-05T00:00:00.000Z",
     "mijoz": "Abdukadirov Alisher Abdurasilovich", "obyekt": "ЗУРСАН"}]}


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
            {"contractNo": "77SRH26AA", "amount": 95000000, "object": "SRH", "found": True}]}}
        self.assertEqual(PB.toskiqlar(r), ["obyekt mos emas: 77SRH26AA (SRH), manba ЗУРСАН", "manba qoldig'i yetarli emas"])
        r = {**TAHLIL, "extracted": {**TAHLIL["extracted"], "fromFound": False, "totalAmount": 5}}
        self.assertIn("manba shartnoma 1817ZUR24HW topilmadi (CRM va to'lovlarda yo'q)", PB.toskiqlar(r))
        self.assertIn("maqsad summalari jami o'tkaziladigan summaga teng emas", PB.toskiqlar(r))
        r = {**TAHLIL, "duplicates": [{"date": "2026-10-01", "amount": 95000000}]}
        self.assertEqual(PB.toskiqlar(r), ["takror bo'lishi mumkin: 1817ZUR24HW dan shu summada allaqachon 1 ta"
                                           " perebroska bor (01.10.2026)"])


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

    def _yollar(self) -> List[str]:
        return [c["path"] for c in self.calls]

    async def test_tasdiqsiz_darrov_yaratadi_natija_kartasi(self):
        await PB.handle("PEREBROSKA: tasdiq=samar izoh=ariza", self.out, reply_to=3, rasmlar=[str(self.dir / FAYL)])
        self.assertEqual(self._yollar(), [C.PEREBROSKA_KOPRIK_TAHLIL, C.PEREBROSKA_KOPRIK_YARAT])
        self.assertEqual(self.calls[0]["body"], {"fayl": FAYL})
        y = self.calls[1]["body"]
        self.assertEqual({k: y[k] for k in ("fayl", "fromContractNo", "amount", "date", "destinations", "agentState", "tasdiq", "izoh")},
                         {"fayl": FAYL, "fromContractNo": "1817ZUR24HW", "amount": 95000000, "date": "2026-10-05",
                          "destinations": [{"contractNo": "1818ZUR24QB", "amount": 95000000}], "agentState": "verified",
                          "tasdiq": "samar", "izoh": "ariza"})
        self.assertEqual(y["agentData"]["fromContractNo"], "1817ZUR24HW")
        self.assertEqual(self.kv, {C.kv_key(C.KV_PB_YARATILDI, token="0123456789abcdef"): mock.ANY})
        tahlil_xabari, karta = self.texts()
        self.assertEqual(tahlil_xabari, C.MSG_PEREBROSKA_TAHLIL)
        self.assertNotIn("tasdiqlayman", karta)
        for frag in ("<b>Perebroska yaratildi</b>",
                     "Manba: <code>1817ZUR24HW</code> — Abdukadirov Alisher Abdurasilovich", "Obyekt: <b>ЗУРСАН</b>",
                     "Summa: <b>95 000 000 so'm</b>", "Sana: 05.10.2026", "Maqsad (1):",
                     "• <code>1818ZUR24QB</code> · +95 000 000 so'm — Abdukadirov Alisher Abdurasilovich",
                     "Arizachi: Abdukadirov Alisher (maqsad egasiga mos)", "Agent xulosasi: hujjat mos",
                     "OplatyKv: 2 qator qo'shildi (manba -95 000 000, maqsad +95 000 000 so'm).",
                     "Kim: TR Support (samar)", "Guruh ID: <code>pg_7f3a</code>",
                     "Orqaga qaytarish: OplatyKv &gt; + &gt; AI Perebroska &gt; Tarix."):
            self.assertIn(frag, karta)
        self.assertNotRegex(karta.replace("<b>", "").replace("</b>", "").replace("<code>", "").replace("</code>", ""),
                            r"[<>]")                                      # Telegram HTML: ekranlanmagan < > yo'q

    async def test_bir_fayl_bir_marta(self):
        await PB.handle("PEREBROSKA: fayl=%s" % FAYL, self.out)
        self.assertEqual(self.calls[1]["body"]["tasdiq"], C.PEREBROSKA_KIM_DEFAULT)     # ism aytilmasa ham yaratadi
        await PB.handle("PEREBROSKA: fayl=%s" % FAYL, self.out)
        self.assertIn("allaqachon yaratilgan (guruh ID pg_7f3a)", self.texts()[-1])
        self.assertEqual(self._yollar().count(C.PEREBROSKA_KOPRIK_YARAT), 1)
        self.assertEqual(self._yollar().count(C.PEREBROSKA_KOPRIK_TAHLIL), 1)         # AI qayta chaqirilmadi

    async def test_toskiq_va_takror_yaratilmaydi(self):
        self.javob["tahlil"] = {**TAHLIL, "warnings": ["Takror bo'lishi mumkin"],
                                "duplicates": [{"date": "2026-10-01", "amount": 95000000}]}
        await PB.handle("PEREBROSKA: fayl=%s tasdiq=S" % FAYL, self.out)
        t = self.texts()[-1]
        for frag in ("<b>Perebroska yaratilmadi</b>", "Maqsad (1):", "<b>Sabab:</b> takror bo'lishi mumkin",
                     "Panelda OplatyKv &gt; + &gt; AI Perebroska orqali"):
            self.assertIn(frag, t)
        self.assertNotIn(C.PEREBROSKA_KOPRIK_YARAT, self._yollar())
        self.assertEqual(self.kv, {})
        self.javob["tahlil"] = {**TAHLIL, "extracted": {**TAHLIL["extracted"], "destinations": [
            {"contractNo": "1818ZUR24QB", "amount": 95000000, "found": False}]}}
        await PB.handle("PEREBROSKA: fayl=%s" % FAYL, self.out)
        self.assertIn("maqsadli shartnoma 1818ZUR24QB topilmadi", self.texts()[-1])
        self.assertIn("(TOPILMADI)", self.texts()[-1])
        self.assertNotIn(C.PEREBROSKA_KOPRIK_YARAT, self._yollar())

    async def test_yaratish_xatosi_qayta_urinish_mumkin(self):
        self.javob["yarat"] = TZ.KoprikXato("HTTP 400: Manba qoldig'i yetarli emas")
        await PB.handle("PEREBROSKA: fayl=%s" % FAYL, self.out)
        self.assertIn("Perebroska yaratilmadi: HTTP 400: Manba qoldig'i yetarli emas", self.texts()[-1])
        self.assertEqual(self.kv, {})                                                 # belgi olib tashlandi
        self.javob["yarat"] = YARAT
        await PB.handle("PEREBROSKA: fayl=%s" % FAYL, self.out)
        self.assertIn("<b>Perebroska yaratildi</b>", self.texts()[-1])

    async def test_word_fayl_va_faylsiz(self):
        word = "leader_bot_00000000000000aa.docx"
        (self.dir / word).write_bytes(b"doc")
        await PB.handle("PEREBROSKA: fayl=%s" % word, self.out)
        self.assertIn("faqat PDF yoki rasmni o'qiydi", self.texts()[-1])
        await PB.handle("PEREBROSKA:", self.out)
        self.assertIn("faylini yuboring", self.texts()[-1])
        self.assertEqual(self.calls, [])


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
                                                task="PEREBROSKA: fayl=%s tasdiq=samar" % FAYL))]
        await self.handle(_msg(903, "shu perebroska arizasini qil"))
        self.assertEqual(chaqiruv, [("PEREBROSKA: fayl=%s tasdiq=samar" % FAYL, 903)])


if __name__ == "__main__":
    unittest.main()
