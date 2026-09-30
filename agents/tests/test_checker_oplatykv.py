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


if __name__ == "__main__":
    unittest.main()