# -*- coding: utf-8 -*-
"""
config.py
PyCharm loyihasi uchun umumiy konfiguratsiya fayli.
MySQL, Google Sheets, Drive va vaqt sozlamalari shu yerda saqlanadi.
"""

# --- MySQL ulanish sozlamalari ---
MYSQL_CONFIG = {
    "host": "localhost",
    "user": "xonappuz_samar_pm",
    "password": "pV?mIbypj(4r@rDo",
    "database": "xonappuz_ipak_yoli",
    "charset": "utf8mb4"
}

# --- Google Sheets & Drive sozlamalari ---
SERVICE_ACCOUNT_FILE = "/home/xonappuz/bank/ipak/data/abc_sheets.json"

# --- Asosiy Google Sheets fayllari ---
SHEETS = {
    "TRANZACTIONS": {
        "name": "Tranzactions",  # jadval nomi
        "file_id": "1bi5fWZwvE9P30IjzJx54eD0JnSN7ds1YfCg8Zd_gWdI"           # agar kerak bo‘lsa fayl ID yozish mumkin
    },
    "IPAK": {
        "name": "ipak",  # jadval nomi
        "file_id": "1sm4mqUVh1JS1qG-h-0tsGbCv185KCZ5FNM48wEvPoxY"
    }
}

# --- Avtomatik ishga tushish vaqti (24-soat formatda) ---
RUN_TIME = "09:00"  # har kuni ertalab soat 09:00 da ishga tushadi

# --- Qo‘shimcha sozlamalar ---
TIMEZONE = "Asia/Tashkent"  # O‘zbekiston vaqt zonasi
LOG_FILE = "run_log.txt"     # ishga tushish log fayli
