"""tuzatish: to'lovni tahrirlash (TR Support) — ko'prik, DB kv va tarix soxta; tarmoq yo'q."""
from __future__ import annotations

import json
import os
import unittest
import urllib.request
from typing import Any, Dict, List
from unittest import mock
from urllib.parse import parse_qs, urlsplit

from agents import config
from agents import contract as C
from agents import notify
from agents import tuzatish as TZ
from agents.tests.test_leader_reply import LB, _FlowBase, _leader_json, _msg

KALIT = "".join(["kp", "Q9", "zx", "31", "Lm", "Nv", "8r", "Tq", "Wy", "5e", "Hd", "0s", "Fg", "Uo", "2c", "Aa"])
TX = "1069900024938_10904304_29.09.2026_20208000_29824000_813200000_-"
TX_VIEW = {"id": "ctx1", "externalId": TX, "date": "2026-09-29T05:00:00.000Z", "amount": 8132000, "direction": "IN",
           "editable": True, "description": "...", "kontragent": {"code": "CLIENT", "name": "Клиент / Физ.Л / Юр.Л"},
           "kategoriya": {"code": "CLIENT_VZNOS_KV", "name": "Взносы за квартиры"}, "shartnoma": None,
           "isContractManual": False}
OPTIONS = {"ok": True, "tx": TX_VIEW, "kontragentlar": [
    {"code": "CLIENT", "name": "Клиент / Физ.Л / Юр.Л", "kategoriyalar": [
        {"code": "CLIENT_VZNOS_KV", "name": "Взносы за квартиры"}, {"code": "CLIENT_SCHETCHIK", "name": "За счетчик"}]},
    {"code": "BANK", "name": "Банк", "kategoriyalar": [{"code": "BANK_USLUGI", "name": "Услуги банка"}]},
    {"code": "SALARY", "name": "Зарплата", "kategoriyalar": []},
]}


class FakeResp:
    def __init__(self, body: bytes) -> None:
        self.body = body

    def read(self, n: int = -1) -> bytes:
        return self.body

    def __enter__(self) -> "FakeResp":
        return self

    def __exit__(self, *a: Any) -> bool:
        return False


class _Base(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.kv: Dict[str, Any] = {}
        self.calls: List[Any] = []
        self.hist: List[str] = []
        self.javob: Dict[str, Any] = {}
        env = {C.TOLOV_KOPRIK_ENV_KEY: KALIT}
        p = mock.patch.dict(os.environ, env, clear=False)
        p.start()
        self.addCleanup(p.stop)
        for k in (C.TOLOV_KOPRIK_ENV_URL, C.TOLOV_KOPRIK_ENV_PORT):
            os.environ.pop(k, None)
        for tgt, name, val in (
            (config, "load_env_file", lambda path=None: {}),
            (TZ, "_urlopen", self._net),
            (TZ.db, "kv_set_json", lambda k, v: self.kv.__setitem__(k, json.loads(json.dumps(v)))),
            (TZ.db, "kv_get_json", lambda k, d=None: self.kv.get(k, d)),
            (TZ.db, "kv_del", lambda k: self.kv.pop(k, None)),
            (TZ.db, "kv_claim", lambda k, v="1": self.kv.setdefault(k, v) == v and self.kv[k] is v),
            (TZ.db, "kv_del_prefix", lambda pre: len([self.kv.pop(k) for k in list(self.kv) if k.startswith(pre)])),
            (TZ.db, "kv_keys", lambda pre: [k for k in self.kv if k.startswith(pre)]),
            (TZ.history, "add_history", lambda role, text, **kw: self.hist.append(text)),
        ):
            pp = mock.patch.object(tgt, name, val)
            pp.start()
            self.addCleanup(pp.stop)
        self.out = notify.PrintOutbox()
        pr = mock.patch("builtins.print")
        pr.start()
        self.addCleanup(pr.stop)

    def _net(self, req: urllib.request.Request, timeout: float) -> Any:
        u = urlsplit(req.full_url)
        body = json.loads(req.data.decode()) if req.data else None
        self.calls.append({"path": u.path, "q": parse_qs(u.query, keep_blank_values=True), "body": body,
                           "method": req.get_method(), "headers": dict(req.header_items()), "url": req.full_url})
        r = self.javob.get(u.path.rsplit("/", 1)[-1])
        if callable(r):
            r = r(body, parse_qs(u.query, keep_blank_values=True))
        if isinstance(r, BaseException):
            raise r
        return FakeResp(json.dumps(r, ensure_ascii=False).encode())

    def texts(self) -> List[str]:
        return [s["text"] for s in self.out.sent if s["kind"] == "text"]

    def _token(self, tpl: str) -> str:
        """Oxirgi kutilayotgan tasdiq tokeni (kv dan; tugma yo'q — egasi qarori 2026-10-01)."""
        pre = tpl.split("{", 1)[0]
        keys = [k for k in self.kv if k.startswith(pre)]
        return keys[-1][len(pre):] if keys else ""

    def _sorov_xabari(self, belgi: str) -> Dict[str, Any]:
        s = [x for x in self.out.sent if x["kind"] == "text" and belgi in (x.get("text") or "")][-1]
        assert s.get("keyboard") is None, "inline tugma bo'lmasligi kerak"
        return s


class ParseTest(unittest.TestCase):
    def test_qiymatlar_bo_shliq_bilan_va_nomalum(self):
        [q] = TZ.parse("TUZATISH: tx=%s kontragent=qolsin kategoriya=Взносы за квартиры shartnoma=206FZO25A2 "
                       "tasdiq=Samar izoh=chek bo'yicha, CRM'da bor" % TX)
        self.assertEqual((q.tx, q.kontragent, q.kategoriya, q.shartnoma, q.tasdiq, q.izoh),
                         (TX, "qolsin", "Взносы за квартиры", "206FZO25A2", "Samar", "chek bo'yicha, CRM'da bor"))
        self.assertEqual(q.yetishmaydi(), [])
        [q] = TZ.parse("TUZATISH: tx=%s kontragent=? shartnoma=?" % TX)
        self.assertEqual(q.yetishmaydi(), ["kontragent", "kategoriya", "shartnoma", "tasdiq", "izoh"])
        self.assertEqual(len(TZ.parse("TUZATISH: tx=A1234567\nmatn\nTUZATISH: tx=B1234567")), 2)
        self.assertEqual(TZ.parse("oddiy matn"), [])

    def test_crm_bank_hujjat_raqami(self):
        [q] = TZ.parse("TUZATISH: tx=6617414180/30.09.2026 kontragent=qolsin kategoriya=Za schetchik shartnoma=qolsin")
        self.assertEqual((q.tx, q.kategoriya), ("6617414180_30.09.2026", "Za schetchik"))

    def test_contract(self):
        self.assertIn(C.INTENT_TUZATISH, C.INTENTS)
        self.assertEqual(C.kv_key(C.KV_TZ_APPR, token="a" * 16), "tz_appr_" + "a" * 16)


class OqimTest(_Base):
    async def test_yetishmasa_variantlar_bilan_soraydi(self):
        self.javob["options"] = OPTIONS
        self.javob["preview"] = {"ok": True, "valid": True, "errors": [], "tx": TX_VIEW, "harf": None,
                                 "xato": {"inList": False}, "changes": [{"field": "shartnoma", "from": None, "to": "206FZO25A2"}]}
        self.assertTrue(await TZ.handle("TUZATISH: tx=%s shartnoma=206FZO25A2" % TX, self.out))
        # aniq shartnoma: avval tekshiruv (harf qoidasi uchun), keyin yetishmagan ma'lumot so'raladi
        self.assertEqual([x["path"] for x in self.calls], [C.TUZATISH_KOPRIK_PREVIEW, C.TUZATISH_KOPRIK_OPTIONS])
        c = self.calls[1]
        self.assertEqual((c["path"], c["q"], c["method"]), (C.TUZATISH_KOPRIK_OPTIONS, {"tx": [TX]}, "GET"))
        self.assertEqual({k.lower(): v for k, v in c["headers"].items()}[C.TOLOV_KOPRIK_HEADER], KALIT)
        [t] = self.texts()
        for s in ("Hozir: Kontragent: Клиент / Физ.Л / Юр.Л; Kategoriya: Взносы за квартиры; Shartnoma: yo'q",
                  "Ma'lum: Shartnoma: 206FZO25A2", "Kontragent (yoki \"qolsin\"): Клиент / Физ.Л / Юр.Л · Банк · Зарплата",
                  "   Банк: Услуги банка", "   Зарплата: kategoriyasiz", "Kim tasdiqlaydi", "Izoh"):
            self.assertIn(s, t)
        self.assertNotIn("Shartnoma raqami (CRM", t)          # ma'lum: qayta so'ralmaydi
        self.assertEqual(self.hist, [t])                        # Leader keyingi javobda ko'radi
        self.assertEqual(self.kv, {})

    async def test_crm_da_yoq_boshqa_shartnoma_so_raladi(self):
        self.javob["preview"] = {"ok": True, "valid": False, "tx": TX_VIEW, "changes": [], "crm": None,
                                 "errors": ["Shartnoma 999X CRM'da topilmadi — boshqa shartnoma bering"]}
        await TZ.handle("TUZATISH: tx=%s kontragent=qolsin kategoriya=qolsin shartnoma=999X tasdiq=Samar izoh=x" % TX,
                        self.out)
        [t] = self.texts()
        self.assertIn("Tahrirlab bo'lmaydi", t)
        self.assertIn("CRM'da topilmadi — boshqa shartnoma bering", t)
        self.assertFalse(any(s.get("keyboard") for s in self.out.sent))
        self.assertEqual(self.kv, {})
        self.assertEqual(self.calls[0]["q"], {"tx": [TX], "kontragent": [""], "kategoriya": [""], "shartnoma": ["999X"]})

    async def _tasdiq_sorovi(self) -> str:
        self.javob["preview"] = {"ok": True, "valid": True, "errors": [], "tx": TX_VIEW,
                                 "changes": [{"field": "shartnoma", "from": None, "to": "206FZO25A2"}],
                                 "crm": {"contract": "206FZO25A2", "found": True, "customerName": "Ismoilova", "objectName": "FZO"}}
        await TZ.handle("TUZATISH: tx=%s kontragent=qolsin kategoriya=qolsin shartnoma=206FZ025A2 tasdiq=Samar "
                        "izoh=chek bo'yicha" % TX, self.out)
        s = self._sorov_xabari("To'lovni tahrirlash")
        token = self._token(C.KV_TZ_APPR)
        for frag in ("Shartnoma: yo'q -&gt; 206FZO25A2", "CRM: Ismoilova, FZO", "O'zgarmaydi: Kontragent, Kategoriya",
                     "Tasdiqladi: <b>Samar</b>", "Izoh: chek bo'yicha", "OplatyKv sync bir marta",
                     'Tasdiqlash uchun "tasdiqlayman" deb yozing'):
            self.assertIn(frag, s["text"])
        return token

    async def test_ha_tahrirlaydi_bir_marta(self):
        token = await self._tasdiq_sorovi()
        payload = self.kv[C.kv_key(C.KV_TZ_APPR, token=token)]
        self.assertEqual(payload["items"], [{"tx": TX, "kontragent": "", "kategoriya": "", "shartnoma": "206FZ025A2"}])
        self.javob["apply"] = {"ok": True, "batchId": "b1", "results": [
            {"tx": TX, "id": "e1", "status": "applied", "errors": [], "changes": [{"field": "shartnoma", "from": None, "to": "206FZO25A2"}]}],
            "sync": {"ok": True, "added": 1, "updated": 0, "skipped": 0}}
        toast = await TZ.decide(token, True, self.out, 7)
        self.assertEqual(toast, C.MSG_TUZATISH_QABUL)
        await asyncio_gather()
        apply = [c for c in self.calls if c["path"] == C.TUZATISH_KOPRIK_APPLY]
        self.assertEqual(len(apply), 1)
        self.assertEqual(apply[0]["method"], "POST")
        self.assertEqual(apply[0]["body"], {"items": payload["items"], "approvedBy": "Samar", "comment": "chek bo'yicha"})
        t = self.texts()[-1]
        self.assertIn("bajarildi", t)
        self.assertIn("Shartnoma: yo'q -> 206FZO25A2", t)
        self.assertIn("OplatyKv sync bajarildi: qo'shildi 1", t)
        self.assertIn(C.MSG_TUZATISH_PANEL, t)
        self.assertIn({"kind": "edit_keyboard", "target": 7, "keyboard": None},
                      [{k: v for k, v in s.items() if k in ("kind", "target", "keyboard")} for s in self.out.sent])
        self.assertEqual(await TZ.decide(token, True, self.out, 7), C.MSG_MUDDAT_OTGAN)   # ikkinchi bosish
        self.assertEqual(len([c for c in self.calls if c["path"] == C.TUZATISH_KOPRIK_APPLY]), 1)

    async def test_yoq_va_muddat(self):
        token = await self._tasdiq_sorovi()
        self.assertEqual(await TZ.decide(token, False, self.out, None), C.MSG_TUZATISH_BEKOR)
        self.assertFalse([c for c in self.calls if c["path"] == C.TUZATISH_KOPRIK_APPLY])
        token = await self._tasdiq_sorovi()
        key = C.kv_key(C.KV_TZ_APPR, token=token)
        self.kv[key]["created_ts"] -= C.APPROVAL_TTL_S + 5
        self.assertEqual(await TZ.decide(token, True, self.out, None), C.MSG_MUDDAT_OTGAN)
        self.assertFalse([c for c in self.calls if c["path"] == C.TUZATISH_KOPRIK_APPLY])
        self.assertEqual(await TZ.decide("zz", True, self.out, None), C.MSG_MUDDAT_OTGAN)

    async def test_xato_royxatida_savol_yoq_ariza(self):
        xabar = ("Bu to'lov XATO to'lovlar ro'yxatida (shartnoma 217VHA23EU). Tahrir qilinmaydi: XATO to'lovlar"
                 " ro'yxatidan ariza biriktiring")
        self.javob["options"] = dict(OPTIONS, xato={"inList": True, "contractNo": "217VHA23EU", "pending": False, "xabar": xabar})
        await TZ.handle("TUZATISH: tx=%s shartnoma=?" % TX, self.out)
        [t] = self.texts()
        self.assertIn(xabar, t)
        self.assertNotIn("Kim tasdiqlaydi", t)                   # variantlar so'ralmaydi
        self.assertFalse([c for c in self.calls if c["path"] != C.TUZATISH_KOPRIK_OPTIONS])
        # to'liq qator bilan ham: preview xato.inList -> tugmasiz, "Bot orqali tahrirlanmaydi"
        self.javob["preview"] = {"ok": True, "valid": False, "tx": TX_VIEW, "changes": [], "crm": None, "errors": [xabar],
                                 "xato": {"inList": True, "xabar": xabar}}
        await TZ.handle("TUZATISH: tx=%s kontragent=qolsin kategoriya=qolsin shartnoma=217VHA26EU tasdiq=Samar izoh=x" % TX,
                        self.out)
        t = self.texts()[-1]
        self.assertIn("Bot orqali tahrirlanmaydi (XATO to'lovlar ro'yxatida)", t)
        self.assertIn(xabar, t)
        self.assertNotIn("to'g'rilang", t)
        self.assertFalse(any(s.get("keyboard") for s in self.out.sent))
        self.assertEqual(self.kv, {})

    async def test_tx_idsiz_va_koprik_kalitsiz(self):
        await TZ.handle("TUZATISH: kontragent=qolsin", self.out)
        self.assertIn("To'lov ID si yo'q", self.texts()[-1])
        os.environ.pop(C.TOLOV_KOPRIK_ENV_KEY, None)
        await TZ.handle("TUZATISH: tx=%s" % TX, self.out)
        self.assertIn("Variantlar olinmadi", self.texts()[-1])
        self.assertEqual(self.calls, [])
        with self.assertRaises(ValueError):
            TZ._koprik("/api/agent-bridge/exports/s1/run")

    async def test_bir_nechta_tolov_bitta_tasdiq(self):
        self.javob["preview"] = lambda body, q: {"ok": True, "valid": True, "errors": [], "tx": dict(TX_VIEW, externalId=q["tx"][0]),
                                                 "changes": [{"field": "kategoriya", "from": "Взносы за квартиры", "to": "За счетчик"}], "crm": None}
        await TZ.handle("TUZATISH: tx=AAAA1111 kontragent=qolsin kategoriya=За счетчик shartnoma=qolsin tasdiq=Samar izoh=sch\n"
                        "TUZATISH: tx=BBBB2222 kontragent=qolsin kategoriya=За счетчик shartnoma=qolsin", self.out)
        s = self._sorov_xabari("To'lovni tahrirlash")
        self.assertIn("1. ", s["text"])
        self.assertIn("2. ", s["text"])
        token = self._token(C.KV_TZ_APPR)
        self.assertEqual([i["tx"] for i in self.kv[C.kv_key(C.KV_TZ_APPR, token=token)]["items"]], ["AAAA1111", "BBBB2222"])


class QisqaRaqamTest(_Base):
    """05.10: CRM'dagi bank hujjat raqami bilan topish; apply to'liq ID ga; natijada OplatyKv qatori."""

    async def test_qisqa_raqam_toliq_id_bilan_tasdiq_va_okv(self):
        full = "6617414180_100412233_30.09.2026_20208000_29824000_370000000_-"
        self.javob["preview"] = {"ok": True, "valid": True, "errors": [], "harf": None, "xato": {"inList": False},
                                 "tx": dict(TX_VIEW, id="ctx9", externalId=full, amount=3700000, shartnoma="488ZUR235K"),
                                 "changes": [{"field": "kategoriya", "from": "Взносы за квартиры", "to": "За счетчик"}],
                                 "crm": None}
        await TZ.handle("TUZATISH: tx=6617414180/30.09.2026 kontragent=qolsin kategoriya=Za schetchik shartnoma=qolsin"
                        " tasdiq=Samar izoh=schetchik to'lovi", self.out)
        self.assertEqual(self.calls[0]["q"]["tx"], ["6617414180_30.09.2026"])
        s = self._sorov_xabari("To'lovni tahrirlash")
        self.assertIn("ID " + full, s["text"])                         # egasi to'liq ID ni ko'radi
        self.assertIn("Kategoriya: Взносы за квартиры -&gt; За счетчик", s["text"])
        self.assertIn("O'zgarmaydi: Kontragent, Shartnoma", s["text"])
        token = self._token(C.KV_TZ_APPR)
        self.assertEqual(self.kv[C.kv_key(C.KV_TZ_APPR, token=token)]["items"][0]["tx"], full)   # apply aynan shu to'lovga
        self.javob["apply"] = {"ok": True, "batchId": "b1", "results": [
            {"tx": full, "id": "e1", "status": "applied", "errors": [], "oplataKv": True,
             "changes": [{"field": "kategoriya", "from": "Взносы за квартиры", "to": "За счетчик"}]}],
            "sync": {"ok": True, "added": 0, "updated": 1, "skipped": 0}}
        await TZ.decide(token, True, self.out, None)
        await asyncio_gather()
        t = self.texts()[-1]
        self.assertIn("Kategoriya: Взносы за квартиры -> За счетчик", t)
        self.assertIn("OplatyKv qatori ham yangilandi", t)


class HarfQoidaTest(_Base):
    """Harf farqi qoidasi (egasi, 2026-10-03): XATO to'lov, oxirgi 1-2 harf -> arizasiz va TASDIQSIZ."""

    def _preview(self, body: Any, q: Dict[str, List[str]]) -> Dict[str, Any]:
        tx, sh = q["tx"][0], q["shartnoma"][0]
        tv = dict(TX_VIEW, externalId=tx, shartnoma=self.eski.get(tx))
        if tx in self.eski and sh[:-2] == self.eski[tx][:-2]:
            return {"ok": True, "valid": True, "errors": [], "tx": tv, "harf": {"from": self.eski[tx], "to": sh},
                    "xato": {"inList": True, "xabar": "XATO ro'yxatida"},
                    "changes": [{"field": "shartnoma", "from": self.eski[tx], "to": sh}],
                    "crm": {"contract": sh, "found": True, "customerName": "KARIMOV", "objectName": "AFS"}}
        if tx in self.eski:
            return {"ok": True, "valid": False, "tx": tv, "harf": None, "changes": [], "crm": None,
                    "xato": {"inList": True, "xabar": "XATO ro'yxatida, ariza biriktiring"},
                    "errors": ["XATO ro'yxatida, ariza biriktiring"]}
        return {"ok": True, "valid": True, "errors": [], "tx": tv, "harf": None, "xato": {"inList": False},
                "changes": [{"field": "shartnoma", "from": None, "to": sh}], "crm": None}

    def setUp(self) -> None:
        super().setUp()
        self.eski = {"6610873215_A": "217AFS24YK", "6610873139_B": "217AFS24YI", "6607927615_C": "656AFS25ZO"}
        self.javob["preview"] = self._preview
        self.javob["apply"] = lambda body, q: {"ok": True, "batchId": "b1", "results": [
            {"tx": it["tx"], "id": "e%d" % i, "status": "applied", "errors": [],
             "changes": [{"field": "shartnoma", "from": self.eski[it["tx"]], "to": it["shartnoma"]}]}
            for i, it in enumerate(body["items"], 1)], "sync": {"ok": True, "added": 0, "updated": 3, "skipped": 0}}

    async def test_uch_tolov_darrov_tasdiqsiz(self):
        await TZ.handle("TUZATISH: tx=6610873215_A kontragent=qolsin kategoriya=qolsin shartnoma=217AFS24YL\n"
                        "TUZATISH: tx=6610873139_B shartnoma=217AFS24YL\n"
                        "TUZATISH: tx=6607927615_C shartnoma=656AFS25ZU tasdiq=? izoh=?", self.out)
        await asyncio_gather()
        self.assertEqual(self.kv, {})                                   # tasdiq so'rovi yo'q
        self.assertFalse([c for c in self.calls if c["path"] == C.TUZATISH_KOPRIK_OPTIONS])   # savol yo'q
        [apply] = [c for c in self.calls if c["path"] == C.TUZATISH_KOPRIK_APPLY]
        self.assertEqual(apply["body"]["items"], [
            {"tx": "6610873215_A", "kontragent": "", "kategoriya": "", "shartnoma": "217AFS24YL"},
            {"tx": "6610873139_B", "kontragent": "", "kategoriya": "", "shartnoma": "217AFS24YL"},
            {"tx": "6607927615_C", "kontragent": "", "kategoriya": "", "shartnoma": "656AFS25ZU"}])
        self.assertEqual(apply["body"]["approvedBy"], C.HARF_TASDIQ)
        self.assertEqual(apply["body"]["comment"], C.HARF_IZOH + ": 217AFS24YK -> 217AFS24YL, 217AFS24YI -> 217AFS24YL,"
                                                                 " 656AFS25ZO -> 656AFS25ZU")
        boshi, natija = self.texts()
        self.assertTrue(boshi.startswith(C.HARF_BOSHI))
        self.assertIn("1. 29.09.2026 10:00 · 8 132 000 so'm · ID 6610873215_A: 217AFS24YK -> 217AFS24YL (CRM: KARIMOV, AFS)",
                      boshi)
        self.assertTrue(natija.startswith(C.HARF_NATIJA))
        self.assertEqual(natija.count("bajarildi"), 4)                  # 3 to'lov + sync
        self.assertFalse(any(s.get("keyboard") for s in self.out.sent))

    async def test_aralash_harf_darrov_qolgani_tasdiq_bilan_rad_alohida(self):
        await TZ.handle("TUZATISH: tx=6610873215_A shartnoma=217AFS24YL tasdiq=Samar izoh=chek\n"
                        "TUZATISH: tx=6607927615_C shartnoma=999XXX99\n"
                        "TUZATISH: tx=NORMAL_123 kontragent=qolsin kategoriya=qolsin shartnoma=206FZO25A2", self.out)
        await asyncio_gather()
        [apply] = [c for c in self.calls if c["path"] == C.TUZATISH_KOPRIK_APPLY]
        self.assertEqual([i["tx"] for i in apply["body"]["items"]], ["6610873215_A"])
        self.assertEqual(apply["body"]["approvedBy"], "Samar")         # egasi ism bergan bo'lsa o'sha
        self.assertEqual(apply["body"]["comment"], "chek; " + C.HARF_IZOH + ": 217AFS24YK -> 217AFS24YL")
        t = "\n".join(self.texts())
        self.assertIn("Bot orqali tahrirlanmaydi (XATO to'lovlar ro'yxatida)", t)
        self.assertIn("XATO ro'yxatida, ariza biriktiring", t)
        # oddiy to'lov: odatdagi oqim (tasdiq so'rovi), tekshiruv qayta chaqirilmaydi
        token = self._token(C.KV_TZ_APPR)
        self.assertEqual([i["tx"] for i in self.kv[C.kv_key(C.KV_TZ_APPR, token=token)]["items"]], ["NORMAL_123"])
        self.assertEqual(len([c for c in self.calls if c["path"] == C.TUZATISH_KOPRIK_PREVIEW]), 3)

    def test_aniq_shartnoma(self):
        for v in ("217AFS24YL", " 656afs25zu "):
            self.assertTrue(TZ._aniq_shartnoma(v), v)
        for v in (None, "", "qolsin", "tozalash", "XATO", "xato:217AFS24YL", "?", "yo'q", "ABC", "1234"):
            self.assertFalse(TZ._aniq_shartnoma(v), v)


async def asyncio_gather() -> None:
    import asyncio
    await asyncio.gather(*list(TZ._BG_TASKS))


class LeaderOqimTest(_FlowBase):
    """Leader javobida TUZATISH qatori -> tuzatish.handle (delegatsiya ham, human_reply ham yo'q)."""

    async def test_tuzatish_qatori_botga(self):
        chaqiruv: List[Any] = []

        class FakeTZ:
            @staticmethod
            async def handle(text: Any, outbox: Any, reply_to: Any = None) -> bool:
                chaqiruv.append((text, reply_to))
                return True

        self._patch(LB, "_mod", lambda name: FakeTZ if name == "tuzatish" else None)
        self.replies = [(C.RUN_OK, _leader_json("Tekshiryapman", delegate_to="checker", intent=C.INTENT_TUZATISH,
                                                task="TUZATISH: tx=%s shartnoma=206FZO25A2" % TX))]
        await self.handle(_msg(900, "shu to'lovga 206FZO25A2 shartnomasini qo'y"))
        self.assertEqual(len(chaqiruv), 1)
        self.assertIn("TUZATISH: tx=%s shartnoma=206FZO25A2" % TX, chaqiruv[0][0])
        self.assertEqual(chaqiruv[0][1], 900)
        self.assertEqual([a for a, _t in self.runs], ["leader"])      # checker chaqirilmadi
        self.assertFalse(any("Tekshiryapman" in (getattr(s, "text", "") or "") for s in self.outbox.sent))


if __name__ == "__main__":
    unittest.main()
