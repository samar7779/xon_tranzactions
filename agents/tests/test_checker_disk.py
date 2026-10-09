"""checker_worker._check_disk: disk to'lsa eng katta papkalar va DB jadvallari sabab sifatida ko'rinadi (2026-10-09)."""
from __future__ import annotations

import unittest
from collections import namedtuple
from unittest import mock

from agents import checker_worker as CW

_U = namedtuple("_U", "total used free")
GB = 1024 ** 3


class DiskTest(unittest.TestCase):
    def setUp(self) -> None:
        CW._disk_kesh.update({"ts": 0.0, "papkalar": [], "jadvallar": [], "db_gb": None})

    def _db(self, sql, *a, **k):
        if "pg_database_size" in sql:
            return [{"b": 14 * GB}]
        return [{"nom": "public.transactions", "b": 6 * GB}, {"nom": "public.sync_logs", "b": int(3.2 * GB)}]

    def test_warn_da_sabablar(self):
        hajm = {"/var/log/journal": 3900.0, "/var/lib/postgresql": 14500.0, "/tmp": 50.0}
        with mock.patch.object(CW.shutil, "disk_usage", lambda p: _U(45 * GB, 38.25 * GB, 6.75 * GB)), \
                mock.patch.object(CW, "_du_mb", lambda p: hajm.get(
                    p, 2150.0 if p.replace("\\", "/").endswith(".next/cache") else None)), \
                mock.patch.object(CW.db, "fetchall", self._db):
            st, msg, d = CW._check_disk()
        self.assertEqual(st, "warn")
        self.assertIn("disk / 85.0% band, bo'sh 6.8 GB", msg)
        self.assertIn("eng kattalari: PostgreSQL ma'lumotlari 14.2 GB, tizim jurnali (journald) 3.8 GB,"
                      " frontend .next/cache 2.1 GB", msg)
        self.assertIn("DB 14.0 GB, katta jadvallar: public.transactions 6.0 GB, public.sync_logs 3.2 GB", msg)
        self.assertNotIn("/tmp", msg)                                     # 100 MB dan kichik ko'rsatilmaydi
        self.assertEqual(d["db_gb"], 14.0)

    def test_ok_da_hisoblanmaydi_va_kesh(self):
        du = mock.Mock(return_value=500.0)
        with mock.patch.object(CW.shutil, "disk_usage", lambda p: _U(100 * GB, 50 * GB, 50 * GB)), \
                mock.patch.object(CW, "_du_mb", du):
            st, msg, _ = CW._check_disk()
        self.assertEqual(st, "ok")
        du.assert_not_called()
        with mock.patch.object(CW.shutil, "disk_usage", lambda p: _U(100 * GB, 90 * GB, 10 * GB)), \
                mock.patch.object(CW, "_du_mb", du), mock.patch.object(CW.db, "fetchall", self._db):
            CW._check_disk()
            n = du.call_count
            CW._check_disk()                                              # soatlik kesh: qayta du yo'q
        self.assertEqual(du.call_count, n)


if __name__ == "__main__":
    unittest.main()
