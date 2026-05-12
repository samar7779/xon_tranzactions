# -*- coding: utf-8 -*-
import base64
import sys
from datetime import datetime
from dateutil import tz

import pymysql
import requests
import gspread
from google.oauth2.service_account import Credentials

from config import MYSQL_CONFIG, SERVICE_ACCOUNT_FILE, SHEETS, TIMEZONE

# ====== API endpoints (Ipak Yuli Bank) ======
API_BASE = "https://mb.ipakyulibank.uz:2713/Mobile.svc"
API_LOGIN_URL = f"{API_BASE}/APILogin"
API_GETDOC_URL = f"{API_BASE}/GetDoc1C"

# ---------- MySQL identifikatorlarini xavfsiz qadoqlash ----------
def qident(name: str) -> str:
    """MySQL identifikatorlari (jadval/ustun) uchun backtick-escape."""
    return "`" + name.replace("`", "``") + "`"

# ====== Google Sheets helpers ======
def gs_client():
    scopes = [
        "https://www.googleapis.com/auth/spreadsheets.readonly",
        "https://www.googleapis.com/auth/drive.readonly",
    ]
    creds = Credentials.from_service_account_file(SERVICE_ACCOUNT_FILE, scopes=scopes)
    return gspread.authorize(creds)

def read_map_rows():
    """
    SHEETS['IPAK'] faylidagi SHEETS['IPAK']['name'] (masalan, 'ipak') varaqdan o'qiydi.
    Ustunlar: A (rs), B (bank_name), C (login), D (password) – 2-qatordan.
    Bo'sh rs bo'lgan satrlar o'tkazib yuboriladi.
    """
    gc = gs_client()
    file_id = SHEETS["IPAK"]["file_id"]
    sheet_name = SHEETS["IPAK"]["name"]  # 'ipak'
    sh = gc.open_by_key(file_id)

    try:
        ws = sh.worksheet(sheet_name)
    except gspread.WorksheetNotFound:
        names = [w.title for w in sh.worksheets()]
        print(f"❌ Google Sheet varaq topilmadi: '{sheet_name}'. Mavjud varaqlar: {names}")
        sys.exit(1)

    data = ws.get_all_values()
    rows = []
    for i, row in enumerate(data[1:], start=2):  # 1-qator: sarlavha
        vals = row + ["", "", "", ""]
        rs        = vals[0].strip()
        bank_name = vals[1].strip()
        login     = vals[2].strip()
        password  = vals[3].strip()
        if not rs:
            continue
        rows.append({
            "rs": rs,
            "bank_name": bank_name,
            "login": login,
            "password": password,
            "sheet_row": i,
        })
    return rows

# ====== MySQL helpers ======
def get_db():
    return pymysql.connect(
        host=MYSQL_CONFIG["host"],
        user=MYSQL_CONFIG["user"],
        password=MYSQL_CONFIG["password"],
        database=MYSQL_CONFIG["database"],
        charset=MYSQL_CONFIG.get("charset", "utf8mb4"),
        autocommit=True,
        cursorclass=pymysql.cursors.DictCursor,
    )

def ensure_map_table(conn):
    """
    Agar 'map' mavjud bo'lmasa – lotin nomlari bilan yaratadi.
    Mavjud bo'lsa – hech narsani o'zgartirmaydi.
    """
    ddl = """
    CREATE TABLE IF NOT EXISTS `map` (
      `rs` VARCHAR(64) PRIMARY KEY,
      `bank_name` VARCHAR(255) NULL,
      `login` VARCHAR(255) NULL,
      `password` VARCHAR(255) NULL,
      `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    """
    with conn.cursor() as cur:
        cur.execute(ddl)

def detect_map_columns(conn):
    """
    Jadvaldagi haqiqiy ustun nomlarini aniqlaydi va canonical nomlarga map qiladi:
      rs         -> 'rs' yoki 'Р/С' (yoki 'Р/Ñ')
      bank_name  -> 'bank_name' yoki 'Банк Название' (yoki yo'q)
      login      -> 'login' yoki 'логин' (yoki yo'q)
      password   -> 'password' yoki 'пароль'/'пароль' (yoki yo'q)
    Shuningdek, PRIMARY KEY birgina rs ekanini tekshiradi (is_pk_rs).
    """
    with conn.cursor() as cur:
        cur.execute("SHOW COLUMNS FROM `map`")
        cols = {row["Field"] for row in cur.fetchall()}

    mapping = {}

    # rs
    if "rs" in cols:
        mapping["rs"] = "rs"
    elif "Р/С" in cols:
        mapping["rs"] = "Р/С"
    elif "Р/Ñ" in cols:
        mapping["rs"] = "Р/Ñ"
    else:
        raise RuntimeError("map jadvalida 'rs' yoki 'Р/С' ustuni topilmadi.")

    # bank_name
    if "bank_name" in cols:
        mapping["bank_name"] = "bank_name"
    elif "Банк Название" in cols:
        mapping["bank_name"] = "Банк Название"
    else:
        mapping["bank_name"] = None

    # login
    if "login" in cols:
        mapping["login"] = "login"
    elif "логин" in cols:
        mapping["login"] = "логин"
    else:
        mapping["login"] = None

    # password
    if "password" in cols:
        mapping["password"] = "password"
    elif "пароль" in cols:
        mapping["password"] = "пароль"
    elif "парольь" in cols:
        mapping["password"] = "парольь"
    else:
        mapping["password"] = None

    # PRIMARY KEY aniqlash
    with conn.cursor() as cur:
        cur.execute("""
            SELECT k.COLUMN_NAME
            FROM information_schema.TABLE_CONSTRAINTS t
            JOIN information_schema.KEY_COLUMN_USAGE k
              ON t.CONSTRAINT_NAME = k.CONSTRAINT_NAME
             AND t.TABLE_SCHEMA = DATABASE()
             AND t.TABLE_NAME = 'map'
            WHERE t.CONSTRAINT_TYPE = 'PRIMARY KEY'
        """)
        pk_cols = [r["COLUMN_NAME"] for r in cur.fetchall()]
    is_pk_rs = (len(pk_cols) == 1 and pk_cols[0] == mapping["rs"])

    return mapping, is_pk_rs

def upsert_map(conn, rows):
    """
    Ustun nomlarini autodetect qiladi va shunga mos INSERT/UPDATE bajaradi.
    Agar rs ustuni PK bo'lsa – ON DUPLICATE KEY UPDATE ishlatiladi,
    bo'lmasa – mavjudligini tekshirib turib UPDATE yoki INSERT qilinadi.
    """
    mapping, is_pk_rs = detect_map_columns(conn)
    col_rs        = mapping["rs"]
    col_bank_name = mapping["bank_name"]
    col_login     = mapping["login"]
    col_password  = mapping["password"]

    changed = 0
    with conn.cursor() as cur:
        for r in rows:
            rs_val = r["rs"]
            bank_val = r["bank_name"] if col_bank_name else None
            login_val = r["login"] if col_login else None
            pass_val = r["password"] if col_password else None

            # SELECT (identifikatorlarni backtick bilan o'raymiz)
            select_cols = [col_rs]
            if col_bank_name: select_cols.append(col_bank_name)
            if col_login:     select_cols.append(col_login)
            if col_password:  select_cols.append(col_password)
            select_list = ", ".join(qident(c) for c in select_cols)

            cur.execute(
                f"SELECT {select_list} FROM {qident('map')} WHERE {qident(col_rs)}=%s",
                (rs_val,)
            )
            old = cur.fetchone()

            if is_pk_rs:
                # PK bo'lsa: ON DUPLICATE KEY UPDATE
                ins_cols = [col_rs]
                ins_vals = [rs_val]
                upd_sets = []

                if col_bank_name:
                    ins_cols.append(col_bank_name); ins_vals.append(bank_val)
                    upd_sets.append(f"{qident(col_bank_name)}=VALUES({qident(col_bank_name)})")
                if col_login:
                    ins_cols.append(col_login); ins_vals.append(login_val)
                    upd_sets.append(f"{qident(col_login)}=VALUES({qident(col_login)})")
                if col_password:
                    ins_cols.append(col_password); ins_vals.append(pass_val)
                    upd_sets.append(f"{qident(col_password)}=VALUES({qident(col_password)})")

                sql = f"""
                    INSERT INTO {qident('map')} ({', '.join(qident(c) for c in ins_cols)})
                    VALUES ({', '.join(['%s']*len(ins_cols))})
                    ON DUPLICATE KEY UPDATE {', '.join(upd_sets) if upd_sets else f'{qident(col_rs)}={qident(col_rs)}'}
                """
                cur.execute(sql, tuple(ins_vals))

                if old is None:
                    print(f"➕ map INSERT: {col_rs}={rs_val}")
                    changed += 1
                else:
                    changed_flag = False
                    if col_bank_name and old.get(col_bank_name) != bank_val:
                        changed_flag = True
                    if col_login and old.get(col_login) != login_val:
                        changed_flag = True
                    if col_password and old.get(col_password) != pass_val:
                        changed_flag = True
                    if changed_flag:
                        print(f"✏️  map UPDATE: {col_rs}={rs_val}")
                        changed += 1
            else:
                # PK emas: mavjud bo'lsa UPDATE, bo'lmasa INSERT
                if old:
                    set_parts = []
                    params = []
                    if col_bank_name:
                        set_parts.append(f"{qident(col_bank_name)}=%s"); params.append(bank_val)
                    if col_login:
                        set_parts.append(f"{qident(col_login)}=%s"); params.append(login_val)
                    if col_password:
                        set_parts.append(f"{qident(col_password)}=%s"); params.append(pass_val)
                    if set_parts:
                        params.append(rs_val)
                        sql = f"UPDATE {qident('map')} SET {', '.join(set_parts)} WHERE {qident(col_rs)}=%s"
                        cur.execute(sql, tuple(params))

                        changed_flag = False
                        if col_bank_name and old.get(col_bank_name) != bank_val:
                            changed_flag = True
                        if col_login and old.get(col_login) != login_val:
                            changed_flag = True
                        if col_password and old.get(col_password) != pass_val:
                            changed_flag = True
                        if changed_flag:
                            print(f"✏️  map UPDATE: {col_rs}={rs_val}")
                            changed += 1
                else:
                    ins_cols = [col_rs]; ins_vals = [rs_val]
                    if col_bank_name: ins_cols.append(col_bank_name); ins_vals.append(bank_val)
                    if col_login:     ins_cols.append(col_login);     ins_vals.append(login_val)
                    if col_password:  ins_cols.append(col_password);  ins_vals.append(pass_val)

                    sql = f"""
                        INSERT INTO {qident('map')} ({', '.join(qident(c) for c in ins_cols)})
                        VALUES ({', '.join(['%s']*len(ins_cols))})
                    """
                    cur.execute(sql, tuple(ins_vals))
                    print(f"➕ map INSERT: {col_rs}={rs_val}")
                    changed += 1

    print(f"✅ map sync tugadi. O'zgargan qatorlar: {changed}")

# ====== API helpers ======
def basic_auth(login, password):
    """
    IP-based autorizatsiya uchun: faqat login:password
    """
    token = base64.b64encode(f"{login}:{password}".encode("utf-8")).decode("ascii")
    return {"Authorization": f"Basic {token}", "Content-Type": "application/json"}

def api_login_get_clients(login, password):
    """
    APILogin: Basic header (login:password), body bo'sh.
    IP-based autorizatsiya ishlatiladi.
    Natija: result -> clients (u yerda accounts[ {account, branch}, ... ]) bo'ladi.
    """
    headers = basic_auth(login, password)
    
    try:
        resp = requests.post(API_LOGIN_URL, headers=headers, json={},
                             timeout=30, verify=True)
        data = resp.json()
    except requests.exceptions.RequestException as e:
        raise RuntimeError(f"APILogin request error: {e}")
    except Exception as e:
        raise RuntimeError(f"APILogin JSON parse error: HTTP {resp.status_code} text={resp.text[:200]}")
    
    # Xatolikni tekshirish
    if data.get("error"):
        error_code = data["error"].get("code")
        error_msg = data["error"].get("message")
        
        if error_code == 60102:
            raise RuntimeError(f"IP manzildan kirish taqiqlangan. Bank bilan bog'laning va IP manzilni ro'yxatdan o'tkazing.")
        elif error_code == 61004:
            raise RuntimeError(f"SMS kod talab qilinmoqda: {error_msg}")
        else:
            raise RuntimeError(f"APILogin error: code={error_code}, message={error_msg}")
    
    return data.get("result", {})  # {'clients': [...]}

def resolve_branch_for_account(clients_result, account):
    """
    Berilgan account uchun branch kodini topadi (APILogin natijasi ichidan).
    """
    clients = clients_result.get("clients") or []
    for c in clients:
        for acc in c.get("accounts") or []:
            if acc.get("account") == account:
                return acc.get("branch")
    return None

def get_doc1c(login, password, branch, account, date_str):
    """
    GetDoc1C: Basic header + body: {branch, account, date: 'DD.MM.YYYY'}.
    IP-based autorizatsiya ishlatiladi.
    """
    headers = basic_auth(login, password)
    body = {"branch": branch, "account": account, "date": date_str}
    
    try:
        resp = requests.post(API_GETDOC_URL, headers=headers, json=body,
                             timeout=60, verify=True)
        data = resp.json()
    except requests.exceptions.RequestException as e:
        raise RuntimeError(f"GetDoc1C request error: {e}")
    except Exception as e:
        raise RuntimeError(f"GetDoc1C JSON parse error: HTTP {resp.status_code} text={resp.text[:200]}")
    
    if data.get("error"):
        error_info = data["error"]
        raise RuntimeError(f"GetDoc1C error: code={error_info.get('code')}, message={error_info.get('message')}")
    
    return data.get("result") or {}

# ====== main flow ======
def main():
    print("=" * 60)
    print("IPAK YULI BANK - Ko'chirma Olish Dasturi")
    print("=" * 60)
    
    # 1) Google Sheets'dan o'qish
    print("\n📊 Google Sheets'dan ma'lumotlar o'qilmoqda...")
    rows = read_map_rows()
    if not rows:
        print("⚠️  Varaqdan qator topilmadi (rs bo'sh bo'lganlari o'tkazildi).")
        return
    print(f"✅ {len(rows)} ta hisob raqami topildi")

    # 2) MySQL'ga ulanish va jadval yaratish (agar bo'lmasa)
    print("\n💾 MySQL bazasiga ulanish...")
    conn = get_db()
    ensure_map_table(conn)

    # 3) Avto-detect schema va sync
    print("\n🔄 Ma'lumotlar sinxronlanmoqda...")
    upsert_map(conn, rows)

    # 4) KUNLIK KO'CHIRMA – konsolga qisqacha hisobot
    tzinfo = tz.gettz(TIMEZONE)
    today = datetime.now(tzinfo).strftime("%d.%m.%Y")

    print(f"\n{'=' * 60}")
    print(f"📅 KUNLIK KO'CHIRMA - {today}")
    print(f"{'=' * 60}\n")
    
    success_count = 0
    error_count = 0
    
    for idx, r in enumerate(rows, 1):
        rs = r["rs"]
        login = r["login"]
        password = r["password"]
        bank_name = r.get("bank_name", "")
        
        print(f"\n[{idx}/{len(rows)}] 🏦 {bank_name if bank_name else 'Bank'}")
        print(f"    📌 Hisob raqami: {rs}")
        
        if not login or not password:
            print(f"    ⭐️ Login yoki parol bo'sh – o'tkazib yuborildi.")
            error_count += 1
            continue

        try:
            # a) APILogin → shu account uchun branch topish
            print(f"    🔐 Autorizatsiya qilinmoqda...")
            clients_res = api_login_get_clients(login, password)
            
            branch = resolve_branch_for_account(clients_res, rs)
            if not branch:
                print(f"    ❌ APILogin'dan branch topilmadi (bu login hisobida ushbu R/S yo'q bo'lishi mumkin).")
                error_count += 1
                continue
            
            print(f"    ✅ Branch topildi: {branch}")

            # b) GetDoc1C → bugungi sana bo'yicha ko'chirma
            print(f"    📥 Ko'chirma yuklanmoqda...")
            doc = get_doc1c(login, password, branch, rs, today)
            
            oper_day = doc.get("oper_day")
            fin = doc.get("fin")
            saldo_in = doc.get("saldo_in", 0)
            saldo_out = doc.get("saldo_out", 0)
            total_credit = doc.get("total_credit", 0)
            total_debit = doc.get("total_debit", 0)
            items = doc.get("content") or []

            print(f"\n    📊 Hisobot:")
            print(f"       Operatsion kun: {oper_day}")
            print(f"       Yakuniy: {'Ha' if fin == 1 else 'Yo\'q'}")
            print(f"       Kiruvchi saldo: {saldo_in / 100:,.2f} so'm")
            print(f"       Chiquvchi saldo: {saldo_out / 100:,.2f} so'm")
            print(f"       Kredit: {total_credit / 100:,.2f} so'm")
            print(f"       Debet: {total_debit / 100:,.2f} so'm")
            print(f"       Operatsiyalar soni: {len(items)}")

            # dastlabki 5 ta item'ni ko'rsatamiz
            if items:
                print(f"\n    📄 Dastlabki operatsiyalar:")
                for i, it in enumerate(items[:5], 1):
                    ddate = it.get('ddate')
                    ttime = it.get('time')
                    dir_  = it.get('dir')
                    dtype = it.get('dtype')
                    amount = it.get('amount', 0)
                    name_dt = it.get('name_dt', '')
                    name_ct = it.get('name_ct', '')
                    purpose = str(it.get('purpose') or '')
                    
                    direction = "➡️" if dir_ == 2 else "⬅️"
                    print(f"       {i}. {direction} {ddate} {ttime}")
                    print(f"          Summa: {amount / 100:,.2f} so'm")
                    print(f"          {name_dt[:40]} → {name_ct[:40]}")
                    print(f"          Maqsad: {purpose[:60]}")

                if len(items) > 5:
                    print(f"       … va yana {len(items)-5} ta operatsiya")
            
            success_count += 1
            print(f"    ✅ Muvaffaqiyatli yakunlandi")

        except Exception as e:
            print(f"    🔥 Xatolik yuz berdi: {e}")
            error_count += 1
    
    # Yakuniy hisobot
    print(f"\n{'=' * 60}")
    print(f"📈 YAKUNIY HISOBOT")
    print(f"{'=' * 60}")
    print(f"✅ Muvaffaqiyatli: {success_count}")
    print(f"❌ Xatolik: {error_count}")
    print(f"📊 Jami: {len(rows)}")
    print(f"{'=' * 60}\n")

if __name__ == "__main__":
    main()