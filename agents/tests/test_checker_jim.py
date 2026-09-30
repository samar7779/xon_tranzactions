"""checker_worker: jim komponentlar (AGENTS_CHECKER_JIM) — tekshiriladi, lekin egasiga ogohlantirish yo'q."""
from __future__ import annotations

import os
import unittest
from typing import Any, List
from unittest import mock

from agents import checker_worker as CW
from agents import config
from agents import contract as C
from agents import notify


def _r(component: str, status: str, msg: str = "x") -> Any:
    return CW.CheckResult(component, status, msg, None)


class JimTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.natijalar: List[Any] = []
        self.sorov: List[str] = []
        for tgt, name, val in (
            (config, "load_env_file", lambda path=None: {}),
            (CW, "run_all_checks_once", lambda record=True: list(self.natijalar)),
            (CW, "_should_alert", lambda component, status: True),
            (CW, "_record_alert", lambda *a: None),
            (CW, "_ask_claude", self._fake_claude),
            (CW.history, "add_history", lambda *a, **k: None),
        ):
            p = mock.patch.object(tgt, name, val)
            p.start()
            self.addCleanup(p.stop)
        self.out = notify.PrintOutbox()
        pr = mock.patch("builtins.print")
        pr.start()
        self.addCleanup(pr.stop)

    def _fake_claude(self, target: Any) -> Any:
        self.sorov.append(target.component)
        return CW.runner.AgentResult(agent="checker", status=C.RUN_OK, text="Shefim, e'tibor kerak: %s." % target.component)

    async def _tick(self) -> List[str]:
        async def teacher(*a: Any) -> None:
            return None
        await CW.checker_tick(self.out, teacher)
        return [s["text"] for s in self.out.sent if s["kind"] == "text"]

    def test_default_sverka_jim(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop(C.CHECKER_JIM_ENV, None)
            self.assertEqual(CW.jim_komponentlar(), ("sverka",))
        with mock.patch.dict(os.environ, {C.CHECKER_JIM_ENV: " Sverka, xonpay ,"}):
            self.assertEqual(CW.jim_komponentlar(), ("sverka", "xonpay"))
        with mock.patch.dict(os.environ, {C.CHECKER_JIM_ENV: ""}):
            self.assertEqual(CW.jim_komponentlar(), ())

    async def test_faqat_sverka_bolsa_xabar_yoq(self):
        os.environ.pop(C.CHECKER_JIM_ENV, None)
        self.natijalar = [_r("sverka", "warn", "sverka: 2 hisobda ochiq farq"), _r("db", "ok")]
        self.assertEqual(await self._tick(), [])
        self.assertEqual(self.sorov, [])

    async def test_boshqa_muammo_xabari_boradi_sverka_qoshilmaydi(self):
        os.environ.pop(C.CHECKER_JIM_ENV, None)
        self.natijalar = [_r("sverka", "warn"), _r("oplatykv_sync", "warn"), _r("services", "error")]
        [t] = await self._tick()
        self.assertEqual(self.sorov, ["services"])
        self.assertIn("Boshqa ogohlantirishlar: oplatykv_sync (WARN).", t)
        self.assertNotIn("sverka", t)

    async def test_env_bosh_bolsa_sverka_yana_ogohlantiradi(self):
        with mock.patch.dict(os.environ, {C.CHECKER_JIM_ENV: ""}):
            self.natijalar = [_r("sverka", "warn")]
            [t] = await self._tick()
        self.assertEqual(self.sorov, ["sverka"])


if __name__ == "__main__":
    unittest.main()
