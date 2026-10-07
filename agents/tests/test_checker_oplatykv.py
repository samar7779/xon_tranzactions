"""checker_worker._check_oplatykv_sync: kelajak updated_at yolg'iz warn bermaydi, soni info matnida qoladi."""
from __future__ import annotations

import unittest
from unittest import mock

from agents import checker_worker as CW


def _sec(kelajak: int) -> dict:
    return {"tushmagan": {"soni": 0}, "kelajak_updated_at": kelajak}


class KelajakJimTest(unittest.TestCase):
    def test_kelajak_ok_va_info(self):
        with mock.patch.object(CW, "_facts_section", lambda name: (_sec(10), None)):
            st, msg, _ = CW._check_oplatykv_sync()
        self.assertEqual(st, "ok")
        self.assertIn("kelajak updated_at: 10 (ogohlantirish jim)", msg)
        self.assertNotIn("updated_at kelajakda", msg)

    def test_kelajak_nol_info_yoq(self):
        with mock.patch.object(CW, "_facts_section", lambda name: (_sec(0), None)):
            st, msg, _ = CW._check_oplatykv_sync()
        self.assertEqual(st, "ok")
        self.assertNotIn("kelajak", msg)


class SyncXatolarTest(unittest.TestCase):
    def test_sabab_bilan_warn(self):
        sec = {"tushmagan": {"soni": 1}, "kelajak_updated_at": 0, "sync_xatolar": {
            "vaqt": "2026-10-07 15:20", "soni": 1,
            "namunalar": [{"tx": "6617414180_1_07.10.2026_A_B_100_-", "shartnoma": "1234ZURXXXXXXXXXXXXXXXXXXXX",
                           "sabab": "shartnoma raqami 50 belgidan uzun (60 belgi)"}]}}
        with mock.patch.object(CW, "_facts_section", lambda name: (sec, None)):
            st, msg, _ = CW._check_oplatykv_sync()
        self.assertEqual(st, "warn")
        self.assertIn("sync 1 ta to'lovni yoza olmadi (2026-10-07 15:20) — 6617414180_1_07.10.2026_A_B_100_- "
                      "(1234ZURXXXXXXXXXXXXXXXXXXXX): shartnoma raqami 50 belgidan uzun (60 belgi)", msg)

    def test_xato_yoq_ok(self):
        with mock.patch.object(CW, "_facts_section", lambda name: ({**_sec(0), "sync_xatolar": None}, None)):
            st, _msg, _ = CW._check_oplatykv_sync()
        self.assertEqual(st, "ok")


class FactsXatolarTest(unittest.TestCase):
    def test_json_parse(self):
        from agents import support_facts as SF
        r = SF._okv_sync_xatolar('{"vaqt": "2026-10-07T10:20:00.000Z", "actor": "cron · day", "soni": 2, "namunalar":'
                                 ' [{"tx": "IP_1_07.10.2026_A_B_1_-", "shartnoma": "X1", "sabab": "s"}]}')
        self.assertEqual(r["soni"], 2)
        self.assertEqual(r["vaqt"], "2026-10-07 15:20")
        self.assertEqual(r["namunalar"], [{"tx": "IP_1_07.10.2026_A_B_1_-", "shartnoma": "X1", "sabab": "s"}])
        self.assertIsNone(SF._okv_sync_xatolar(None))
        self.assertIsNone(SF._okv_sync_xatolar("buzuq"))
        self.assertIsNone(SF._okv_sync_xatolar('{"soni": 0}'))


if __name__ == "__main__":
    unittest.main()