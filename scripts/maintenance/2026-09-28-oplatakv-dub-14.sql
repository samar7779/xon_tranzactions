-- =====================================================================
-- TOZALASH_OPLATAKV_14.sql  (2026-09-28)
-- oplata_kv: sana ko'chgan 14 ta dublikatdan YETIM qatorni o'chirish.
--
-- Sabab: bank to'lov sanasini o'zgartirgan (21.09 -> 18.09), Transaction.externalId
-- yangilangan, oplata_kv.source_tx_id eski ID da qolgan, tungi batch to'lovni
-- ikkinchi marta qo'shgan. YETIM o'chiriladi, BOG'LANGAN qoladi.
--
-- Ishga tushirish (serverda, root):
--   sudo -u postgres psql -d xon_tranzactions -v ON_ERROR_STOP=1 -f TOZALASH_OPLATAKV_14.sql
--
-- Xavfsizlik:
--   * Hammasi BITTA tranzaksiyada. Har qanday guard/xato -> ROLLBACK, hech narsa o'zgarmaydi.
--   * public sxemaga jadval yaratilmaydi (deploy db push --accept-data-loss).
--     Vaqtinchalik view/jadval pg_temp da, zaxira faqat "zaxira" sxemasida.
--   * Zaxira jadvallari public tiplaridan uziladi (payment_category enum -> text). Aks holda
--     schema.prisma'da OplataKvCategory o'zgarsa `prisma db push` eski tipni DROP qila
--     olmay ("other objects depend on it") deploy'ni yiqitadi.
--   * Juftliklar qulflanadi va qulfdan keyin BARCHA ustunlar bo'yicha qayta solishtiriladi
--     (kategoriya/first/monthly o'zgargan bo'lsa ham to'xtaydi).
--   * oplata_kv_history ga ilova formatida 'deleted' yozuvi yoziladi
--     (oplata-kv.service.ts remove(): fieldsChanged ['*'], changes {snapshot: {...}}),
--     shunda /v1/oplata-kv/changes va /v1/oplata-kv/deleted tombstone beradi.
--     Bu yozuv ENG OXIRIDA, COMMIT dan bevosita oldin, created_at =
--     greatest(hozir, oxirgi 'deleted' + 1ms) bilan yoziladi: keyset kursor
--     (createdAt, id) bizning tombstone'lardan oldinroq o'tib ketmasin.
--   * 1d/1e — shu shartnomalarning BOSHQA split qatorlari (faqat ma'lumot). Skript ularni
--     o'zgartirmaydi; kerak bo'lsa tozalashdan keyin qayta split qilinadi (1e ga qarang).
--   * Qayta ishga tushirish xavfsiz: 2-marta nomzod 0 ta bo'ladi -> guard to'xtatadi.
--   * f2) 2026-09-24 dagi 46 ta o'chirish tarixga yozilmagan edi (46/46, 637256640.00) —
--     ular uchun ham shu tranzaksiyada tombstone yoziladi (API iste'molchilari ham o'chirsin).
--     Jonli oplata_kv qatorining id YOKI source_tx_id si zaxiradagi id/source_tx_id ga teng
--     bo'lsa (relink eski kompozitni qayta olgan) — to'xtatadi (1f da oldindan ko'rinadi).
-- =====================================================================

\set ON_ERROR_STOP on
\encoding UTF8
\pset pager off
\pset null '-'
-- Vaqtlar UTC da (ilova Prisma orqali created_at ni UTC yozadi; DB soat mintaqasiga bog'lanmaymiz)
SET TIME ZONE 'UTC';

-- ---------------------------------------------------------------------
-- 0) Nomzodlar ta'rifi — TEMP VIEW (faqat shu seans, pg_temp; public'ga yozilmaydi)
--    Guruh kaliti: source_tx_id dagi dd.mm.yyyy sanani '@' ga almashtirish
--    ([.] = nuqta; backslash ishlatilmaydi, standard_conforming_strings ga bog'liq emas).
--    YETIM   = source_tx_id transactions.external_id da ham, transactions.id da ham yo'q.
--    BOG'LANGAN = transactions.external_id = source_tx_id.
-- ---------------------------------------------------------------------
CREATE TEMP VIEW v_nomzod AS
WITH r AS (
  SELECT k.id, k.contract_no, k.date, k.payment_amount,
         k.first_installment, k.monthly_amount, k.payment_category::text AS payment_category,
         k.source_tx_id, k.created_at, k.created_by_name,
         k.was_manually_edited, k.import_batch_id, k.perereboska_group_id,
         regexp_replace(k.source_tx_id, '_[0-9]{2}[.][0-9]{2}[.][0-9]{4}_', '_@_') AS gkey,
         t.status::text AS tx_status,
         (t.id IS NOT NULL) AS boglangan,
         (t.id IS NULL AND NOT EXISTS (SELECT 1 FROM transactions t2 WHERE t2.id = k.source_tx_id)) AS yetim
    FROM oplata_kv k
    LEFT JOIN transactions t ON t.external_id = k.source_tx_id
   WHERE k.source_tx_id IS NOT NULL
),
g AS (
  SELECT gkey
    FROM r
   GROUP BY gkey
  HAVING count(*) = 2
     AND count(*) FILTER (WHERE yetim) = 1
     AND count(*) FILTER (WHERE boglangan) = 1
)
SELECT d.contract_no,
       d.payment_amount,
       d.id                AS del_id,
       d.source_tx_id      AS del_source,
       d.date              AS del_date,
       d.created_at        AS del_created_at,
       d.created_by_name   AS del_by,
       d.payment_category  AS del_cat,
       d.first_installment AS del_first,
       d.monthly_amount    AS del_monthly,
       b.id                AS keep_id,
       b.source_tx_id      AS keep_source,
       b.date              AS keep_date,
       b.created_at        AS keep_created_at,
       b.created_by_name   AS keep_by,
       b.payment_category  AS keep_cat,
       b.first_installment AS keep_first,
       b.monthly_amount    AS keep_monthly,
       b.tx_status         AS keep_tx_status,
       g.gkey
  FROM g
  JOIN r d ON d.gkey = g.gkey AND d.yetim
  JOIN r b ON b.gkey = g.gkey AND b.boglangan
 WHERE d.created_by_name LIKE 'cron%'      AND b.created_by_name LIKE 'cron%'
   AND d.was_manually_edited = false       AND b.was_manually_edited = false
   AND d.import_batch_id IS NULL           AND b.import_batch_id IS NULL
   AND d.perereboska_group_id IS NULL      AND b.perereboska_group_id IS NULL
   AND d.contract_no = b.contract_no
   AND d.payment_amount = b.payment_amount;

-- ---------------------------------------------------------------------
-- 1) KO'RINISH (faqat o'qish) — BEGIN dan oldin
-- ---------------------------------------------------------------------
\echo '=== 1a. Nomzodlar xulosasi (kutilgan: 14 ta, 82315391.00) ==='
SELECT count(*)                    AS nomzod_soni,
       sum(payment_amount)         AS jami_summa,
       count(DISTINCT contract_no) AS shartnoma_soni
  FROM v_nomzod;

\echo '=== 1b. Nomzodlar royxati (del_* = OCHIRILADI, keep_* = QOLADI) ==='
SELECT contract_no, payment_amount,
       del_date, del_created_at, del_by, del_cat,
       keep_date, keep_created_at, keep_by, keep_cat, keep_tx_status,
       del_id, keep_id
  FROM v_nomzod
 ORDER BY contract_no, del_date;

\echo '=== 1c. Tekshiruvlar (guard qiymatlari; kutilgan: ref/user/split = 0, global = 14) ==='
SELECT
  (SELECT count(*) FROM xato_correction_requests x
    WHERE x.oplata_kv_id IN (SELECT del_id FROM v_nomzod))                        AS ref_xato_ariza,
  (SELECT count(*) FROM oplata_kv_history h
    WHERE h.oplata_kv_id IN (SELECT del_id FROM v_nomzod) AND h.actor_type = 'user') AS yetimda_qolda_tarix,
  (SELECT count(*) FROM v_nomzod WHERE del_cat IS NOT NULL AND keep_cat IS NULL)  AS split_yoqolar_edi,
  (SELECT count(*) FROM transaction_change_logs c
    WHERE c.external_id IN (SELECT del_source FROM v_nomzod))                     AS info_changelog_eski_ext,
  (SELECT count(*) FROM chek_order o
    WHERE o.matched_tx_ext_id IN (SELECT del_source FROM v_nomzod))               AS info_chek_order_eski_ext,
  (SELECT count(*) FROM (
     SELECT r.gkey FROM (
       SELECT regexp_replace(k.source_tx_id, '_[0-9]{2}[.][0-9]{2}[.][0-9]{4}_', '_@_') AS gkey,
              (NOT EXISTS (SELECT 1 FROM transactions t WHERE t.external_id = k.source_tx_id)
               AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.id = k.source_tx_id)) AS yetim
         FROM oplata_kv k
        WHERE k.source_tx_id IS NOT NULL) r
      GROUP BY r.gkey
     HAVING count(*) > 1 AND bool_or(r.yetim)) q)                                  AS global_yetim_dub_guruh;

-- 1d/1e — FAQAT MA'LUMOT (guard emas). Split waterfall (oplata-kv.service.ts splitInstallments):
--   alreadyPaid = shartnomadagi date < firstDate qatorlarning first+monthly yig'indisi.
--   Shu sabab keep sanasidan (18.09) keyingi split qatorlar eskirgan bo'lishi mumkin:
--     * yetim sanasidan (21/22.09) keyin, yetim bor paytda split qilinganlar — bitta pulni
--       IKKI marta sanagan (yetim + keep);
--     * 18.09..21.09 oralig'ida, keep (09-25 01:00) yaratilishidan oldin split qilinganlar —
--       18.09 dagi to'lovni umuman sanamagan.
--   O'chirishdan keyin ular o'z-o'zidan qayta split qilinmaydi va /changes ularni eski
--   first/monthly bilan beradi. Qator chiqsa — tozalashdan keyin shu shartnomalarni qayta
--   split qiling: POST /oplata-kv/split-installments {"contractNo": "...", "force": true}.
--   DIQQAT: force shartnomaning source_tx_id li BARCHA qatorlarida first/monthly/kategoriyani
--   reset qiladi (qo'lda qo'yilganlarini ham) — avval 1e dagi qolda_* ustunlariga qarang.
\echo '=== 1d. Shu shartnomalarning BOSHQA split qatorlari (keep sanasidan boshlab) — waterfall eskirgan bolishi mumkin ==='
WITH n AS (SELECT * FROM v_nomzod),
     c AS (SELECT contract_no,
                  min(least(keep_date, del_date)) AS dan,
                  max(del_created_at)             AS yetim_yaratilgan,
                  max(keep_created_at)            AS keep_yaratilgan
             FROM n GROUP BY contract_no)
SELECT k.contract_no, k.id, k.date, k.payment_amount,
       k.payment_category::text AS cat, k.first_installment, k.monthly_amount,
       k.was_manually_edited, k.updated_at, c.yetim_yaratilgan, c.keep_yaratilgan
  FROM oplata_kv k
  JOIN c ON c.contract_no = k.contract_no
 WHERE k.date >= c.dan
   AND k.payment_category IS NOT NULL
   AND k.id NOT IN (SELECT del_id FROM n UNION ALL SELECT keep_id FROM n)
 ORDER BY k.contract_no, k.date, k.id;

\echo '=== 1e. Qayta split rejasi (yetimsiz holat). qolda_* > 0 bolsa force ISHLATMANG — avval qolda korib chiqing ==='
WITH n AS (SELECT * FROM v_nomzod),
     c AS (SELECT contract_no, min(least(keep_date, del_date)) AS dan FROM n GROUP BY contract_no),
     q AS (
       SELECT k.contract_no,
              (k.date >= c.dan AND k.payment_category IS NOT NULL
               AND k.id NOT IN (SELECT keep_id FROM n))                      AS eskirgan,
              k.was_manually_edited                                           AS qolda,
              EXISTS (SELECT 1 FROM oplata_kv_history h
                       WHERE h.oplata_kv_id = k.id AND h.actor_type = 'user'
                         AND h.fields_changed && ARRAY['paymentCategory','firstInstallment','monthlyAmount']::text[])
                                                                              AS qolda_split
         FROM oplata_kv k
         JOIN c ON c.contract_no = k.contract_no
        WHERE k.source_tx_id IS NOT NULL
          AND k.id NOT IN (SELECT del_id FROM n))
SELECT contract_no,
       count(*) FILTER (WHERE eskirgan)    AS eskirgan_bolishi_mumkin,
       count(*) FILTER (WHERE qolda)       AS qolda_tahrirlangan,
       count(*) FILTER (WHERE qolda_split) AS qolda_split_tarixi,
       count(*)                            AS force_reset_qiladigan_qator
  FROM q
 GROUP BY contract_no
 ORDER BY contract_no;

-- 1f — FAQAT MA'LUMOT (hal qiluvchi guard f2 blokida). 09-24 zaxirasining id/source_tx_id
--   si bilan to'qnashgan JONLI oplata_kv qatorlari. Kutilgan: 0 qator. Qator chiqsa f2
--   to'xtatadi (hammasi ROLLBACK) — tombstone sourceTxId jonli to'lovnikiga teng bo'lardi.
\echo '=== 1f. 09-24 zaxirasi bilan toqnashgan jonli qatorlar (kutilgan: 0 qator) ==='
SELECT k.id, k.source_tx_id, k.contract_no, k.date, k.payment_amount,
       z.id AS zaxira_id, z.source_tx_id AS zaxira_source
  FROM zaxira.oplata_kv_dub_zaxira z
  JOIN oplata_kv k
    ON k.id IN (z.id, z.source_tx_id)
    OR k.source_tx_id IN (z.id, z.source_tx_id)
 ORDER BY k.contract_no, k.id;

-- =====================================================================
-- 2) TRANZAKSIYA
--    Tartib: qulf -> guardlar -> zaxira -> DELETE -> yakuniy tekshiruvlar (og'ir skanlar)
--            -> history tombstone (ENG OXIRGI, yengil) -> COMMIT.
-- =====================================================================
BEGIN;
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '10min';

-- b) Nomzodlar (TEMP, commit'da o'chadi)
CREATE TEMP TABLE nomzod ON COMMIT DROP AS SELECT * FROM v_nomzod;

-- Juftlikning IKKALA qatorini qulflaymiz (cron / qo'lda tahrir / XATO oqimi o'rtada
-- o'zgartirmasin), keyin qulfdan keyingi JONLI holatni nomzod bilan BARCHA ustunlar
-- bo'yicha solishtiramiz (id juftligi, sana, kategoriya, first/monthly, source, tx status).
-- Qulfni kutish paytida kimdir commit qilgan bo'lsa — to'xtaymiz. Farq bo'lmasa nomzod =
-- jonli holat, qatorlar esa COMMIT gacha qulfda; keyingi guardlar shunga tayanadi.
DO $$
DECLARE n_diff int;
BEGIN
  PERFORM 1 FROM oplata_kv
   WHERE id IN (SELECT del_id FROM nomzod UNION ALL SELECT keep_id FROM nomzod)
   FOR UPDATE;

  SELECT count(*) INTO n_diff FROM (
    (SELECT * FROM nomzod   EXCEPT SELECT * FROM v_nomzod)
    UNION ALL
    (SELECT * FROM v_nomzod EXCEPT SELECT * FROM nomzod)
  ) x;
  IF n_diff <> 0 THEN
    RAISE EXCEPTION 'TOXTATILDI: qulfdan keyin nomzodlar ozgardi (farq=%). Qayta ishga tushiring.', n_diff;
  END IF;
END $$;

-- c) Guard: soni aynan 14, summa aynan 82315391.00, id lar noyob va kesishmaydi
DO $$
DECLARE v_n int; v_s numeric; nd int; nk int; nx int;
BEGIN
  SELECT count(*), sum(payment_amount), count(DISTINCT del_id), count(DISTINCT keep_id)
    INTO v_n, v_s, nd, nk FROM nomzod;
  SELECT count(*) INTO nx FROM nomzod a JOIN nomzod b ON a.del_id = b.keep_id;
  IF v_n <> 14 OR v_s IS DISTINCT FROM 82315391.00 OR nd <> 14 OR nk <> 14 OR nx <> 0 THEN
    RAISE EXCEPTION 'TOXTATILDI: nomzod=% summa=% noyob_del=% noyob_keep=% kesishma=% (kutilgan 14 / 82315391.00 / 14 / 14 / 0)',
      v_n, v_s, nd, nk, nx;
  END IF;
  RAISE NOTICE 'Guard OK: % ta nomzod, summa %', v_n, v_s;
END $$;

-- d) Boshqa jadvallardagi ishoralar.
--    oplata_kv.id ga FK yo'q. Qiymat sifatida saqlaydiganlar:
--      xato_correction_requests.oplata_kv_id  -> ishora bo'lsa TO'XTATAMIZ (inson tekkan qator,
--         pending ariza o'chgan qatorga qarab qotib qoladi; qaror qo'lda).
--      oplata_kv_history.oplata_kv_id         -> 'created'/'edited' (system) kutilgan, audit, qoladi.
--         Lekin actor_type='user' yozuvi bo'lsa TO'XTATAMIZ (qo'lda ish yo'qolmasin).
--    Split: yetim split qilingan, bog'langan qilinmagan bo'lsa TO'XTATAMIZ — aks holda API
--      iste'molchisi (faqat paymentCategory != null ni ko'radi) to'lovni butunlay yo'qotadi.
--      JONLI (qulflangan) oplata_kv qatorlaridan o'qiladi, nomzod nusxasidan emas.
DO $$
DECLARE n_x int; n_u int; n_s int; ids text;
BEGIN
  SELECT count(*), string_agg(x.oplata_kv_id || ' [' || x.status || ']', ', ')
    INTO n_x, ids
    FROM xato_correction_requests x WHERE x.oplata_kv_id IN (SELECT del_id FROM nomzod);
  IF n_x > 0 THEN
    RAISE EXCEPTION 'TOXTATILDI: xato_correction_requests % ta yozuv yetim qatorga ishora qiladi: %', n_x, ids;
  END IF;

  SELECT count(*), string_agg(DISTINCT h.oplata_kv_id, ', ')
    INTO n_u, ids
    FROM oplata_kv_history h
   WHERE h.oplata_kv_id IN (SELECT del_id FROM nomzod) AND h.actor_type = 'user';
  IF n_u > 0 THEN
    RAISE EXCEPTION 'TOXTATILDI: yetim qatorlarda qolda (user) tarix bor (% ta): %', n_u, ids;
  END IF;

  SELECT count(*), string_agg(nm.del_id, ', ')
    INTO n_s, ids
    FROM nomzod nm
    JOIN oplata_kv kd ON kd.id = nm.del_id
    JOIN oplata_kv kb ON kb.id = nm.keep_id
   WHERE kd.payment_category IS NOT NULL AND kb.payment_category IS NULL;
  IF n_s > 0 THEN
    RAISE EXCEPTION 'TOXTATILDI: % ta juftlikda yetim split qilingan, boglangan esa yoq (avval split qiling): %', n_s, ids;
  END IF;

  RAISE NOTICE 'Ishoralar OK: xato_ariza=0, user_tarix=0, split_farq=0';
END $$;

-- Soat tekshiruvi (erta to'xtash; hal qiluvchisi f) blokida, COMMIT oldidan qayta).
-- /changes (B-manba) va /deleted keyset kursori faqat action='deleted' yozuvlarning
-- (createdAt, id) siga qaraydi; created/edited d-kursorga ta'sir qilmaydi. DB va ilova
-- bitta xostda — tolerans yo'q: oxirgi 'deleted' DB UTC soatidan oldinda bo'lsa (kelajak
-- qator / soat mintaqasi xatosi) to'xtaymiz, aks holda f) dagi greatest() tombstone'ni
-- kelajakka surib yuborardi.
DO $$
DECLARE v_del timestamp; v_db timestamp := date_trunc('milliseconds', clock_timestamp() AT TIME ZONE 'UTC');
BEGIN
  SELECT max(created_at) INTO v_del FROM oplata_kv_history WHERE action = 'deleted';
  IF v_del > v_db THEN
    RAISE EXCEPTION 'TOXTATILDI: oxirgi deleted tarix (%) DB UTC soatidan (%) oldinda — kelajakdagi yozuv yoki soat farqi, avval tekshiring',
      v_del, v_db;
  END IF;
  RAISE NOTICE 'Soat OK: db_utc=% oxirgi_deleted=%', v_db, v_del;
END $$;

-- e) Zaxira (faqat "zaxira" sxemasi; jadval bor bo'lsa xato -> hammasi bekor)
CREATE SCHEMA IF NOT EXISTS zaxira;
CREATE TABLE zaxira.oplata_kv_dub_zaxira_20260928 AS
  SELECT * FROM oplata_kv WHERE id IN (SELECT del_id FROM nomzod);

-- e2) Zaxira jadvallarini public tiplaridan uzamiz. CREATE TABLE AS SELECT * payment_category
--     ni public."OplataKvCategory" tipida ko'chiradi; enum o'zgarsa `prisma db push` eski tipni
--     DROP qila olmay deploy'ni yiqitadi. Yangi zaxira va 09-24 zaxirasi (bor bo'lsa) —
--     public (pg_catalog'dan tashqari) tipdagi har ustun -> text. Boshqa jadvallarga tegmaymiz.
DO $$
DECLARE r record; n_left int; v_other text;
BEGIN
  FOR r IN
    SELECT c.oid::regclass AS tbl, a.attname, format_type(a.atttypid, a.atttypmod) AS typ
      FROM pg_class c
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
      JOIN pg_attribute a  ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      JOIN pg_type t       ON t.oid = a.atttypid
     WHERE ns.nspname = 'zaxira'
       AND c.relkind = 'r'
       AND c.relname IN ('oplata_kv_dub_zaxira_20260928', 'oplata_kv_dub_zaxira')
       AND t.typnamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
  LOOP
    EXECUTE format('ALTER TABLE %s ALTER COLUMN %I TYPE text USING %I::text', r.tbl, r.attname, r.attname);
    RAISE NOTICE 'Zaxira: %.% (%) -> text', r.tbl, r.attname, r.typ;
  END LOOP;

  SELECT count(*) INTO n_left
    FROM pg_class c
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    JOIN pg_attribute a  ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    JOIN pg_type t       ON t.oid = a.atttypid
   WHERE ns.nspname = 'zaxira'
     AND c.relkind = 'r'
     AND c.relname IN ('oplata_kv_dub_zaxira_20260928', 'oplata_kv_dub_zaxira')
     AND t.typnamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace);
  IF n_left <> 0 THEN
    RAISE EXCEPTION 'TOXTATILDI: zaxira jadvallarida hali % ta ustun public tipga bogliq', n_left;
  END IF;

  SELECT string_agg(DISTINCT c.relname, ', ') INTO v_other
    FROM pg_class c
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    JOIN pg_attribute a  ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    JOIN pg_type t       ON t.oid = a.atttypid
   WHERE ns.nspname = 'zaxira'
     AND c.relkind = 'r'
     AND c.relname NOT IN ('oplata_kv_dub_zaxira_20260928', 'oplata_kv_dub_zaxira')
     AND t.typnamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace);
  IF v_other IS NOT NULL THEN
    RAISE NOTICE 'DIQQAT (tegilmadi): zaxira sxemasidagi boshqa jadvallar ham public tipga bogliq: %', v_other;
  END IF;
  RAISE NOTICE 'Zaxira tiplari OK: public tipga bogliq ustun qolmadi';
END $$;

-- g) O'chirish (id + eski source_tx_id ikkalasi mos bo'lishi shart)
DO $$
DECLARE v_cnt int;
BEGIN
  DELETE FROM oplata_kv k
   USING nomzod nm
   WHERE k.id = nm.del_id
     AND k.source_tx_id = nm.del_source;
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  IF v_cnt <> 14 THEN
    RAISE EXCEPTION 'TOXTATILDI: % ta qator ochirildi (kutilgan 14)', v_cnt;
  END IF;
  RAISE NOTICE 'Ochirildi: % ta yetim qator', v_cnt;
END $$;

-- h) Yakuniy tekshiruv (og'ir skanlar shu yerda — history tombstone'dan OLDIN).
--    History soni f) blokida (v_cnt = 14) tekshiriladi.
\echo '=== 3. Yakuniy tekshiruv ==='
SELECT
  (SELECT count(*) FROM zaxira.oplata_kv_dub_zaxira_20260928)              AS zaxira_soni,
  (SELECT sum(payment_amount) FROM zaxira.oplata_kv_dub_zaxira_20260928)   AS zaxira_summa,
  (SELECT count(*) FROM oplata_kv WHERE id IN (SELECT del_id FROM nomzod))  AS yetim_qoldi,
  (SELECT count(*) FROM oplata_kv WHERE id IN (SELECT keep_id FROM nomzod)) AS boglangan_bor,
  (SELECT count(*) FROM v_nomzod)                                          AS nomzod_qoldi;

DO $$
DECLARE zc int; zs numeric; yq int; bb int; nq int; gq int;
BEGIN
  SELECT count(*), sum(payment_amount) INTO zc, zs FROM zaxira.oplata_kv_dub_zaxira_20260928;
  SELECT count(*) INTO yq FROM oplata_kv WHERE id IN (SELECT del_id FROM nomzod);
  SELECT count(*) INTO bb FROM oplata_kv WHERE id IN (SELECT keep_id FROM nomzod);
  SELECT count(*) INTO nq FROM v_nomzod;
  -- global: yetim qatnashgan dublikat guruh qolmasligi kerak
  SELECT count(*) INTO gq FROM (
    SELECT r.gkey FROM (
      SELECT regexp_replace(k.source_tx_id, '_[0-9]{2}[.][0-9]{2}[.][0-9]{4}_', '_@_') AS gkey,
             (NOT EXISTS (SELECT 1 FROM transactions t WHERE t.external_id = k.source_tx_id)
              AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.id = k.source_tx_id)) AS yetim
        FROM oplata_kv k
       WHERE k.source_tx_id IS NOT NULL) r
     GROUP BY r.gkey
    HAVING count(*) > 1 AND bool_or(r.yetim)) q;

  IF zc <> 14 OR zs IS DISTINCT FROM 82315391.00 OR yq <> 0 OR bb <> 14 OR nq <> 0 OR gq <> 0 THEN
    RAISE EXCEPTION 'TOXTATILDI (yakuniy): zaxira=% summa=% yetim_qoldi=% boglangan=% nomzod_qoldi=% global_dub=%',
      zc, zs, yq, bb, nq, gq;
  END IF;
  RAISE NOTICE 'Yakuniy OK: zaxira=14, yetim=0, boglangan=14, global yetim dublikat=0';
END $$;

\echo '=== 4. Qoldirilgan (boglangan) qatorlar — jonli holat (split holatini keyin tekshirish uchun) ==='
SELECT k.contract_no, k.payment_amount, k.id AS keep_id, k.date AS keep_date,
       k.payment_category::text AS keep_cat, k.first_installment AS keep_first, k.monthly_amount AS keep_monthly
  FROM oplata_kv k
  JOIN nomzod nm ON nm.keep_id = k.id
 ORDER BY k.contract_no;

-- f2 guard) 2026-09-24 dagi 46 ta o'chirish uchun tombstone. O'shanda qatorlar qo'lda SQL bilan
--     o'chirilgan va oplata_kv_history ga yozilmagan (tekshirildi: 46/46 tarixsiz,
--     637256640.00). Shu sabab /changes va /deleted ularni hech qachon bermagan —
--     delta iste'molchilarida o'sha dublikatlar hanuz turibdi. Format f) bilan bir xil,
--     created_at ham f) dagi qiymat (shu tranzaksiyada yozilgan), kursor ularni ham oladi.
--     Jonli to'qnashuv guardi: tombstone iste'molchiga id VA sourceTxId beradi, iste'molchi
--     sourceTxId bo'yicha ham solishtiradi. 09-24 dan beri relinkOplataKv (reconcile.service.ts)
--     jonli qatorning source_tx_id sini o'chirilgan yetimning eski kompozitiga ko'chirgan
--     bo'lishi mumkin (yetim o'chgach unique bo'shagan; id o'zgarmaydi). Shuning uchun jonli
--     oplata_kv da id YOKI source_tx_id zaxiradagi id/source_tx_id lardan biriga teng qator
--     bo'lsa TO'XTATAMIZ — aks holda iste'molchi (CRM) jonli to'lovni o'chirib yuborardi.
--     Kalitlar massivga yig'iladi: k.id = ANY / k.source_tx_id = ANY -> PK + unique indeks
--     (BitmapOr), COMMIT oldidan og'ir skan yo'q.
--     Bu blok faqat TEKSHIRADI; INSERT f) ichida (COMMIT oldidan faqat ikki INSERT qolsin).
DO $$
DECLARE
  v_n    int;
  v_nd   int;
  v_s    numeric;
  v_keys text[];
  v_live int;
  v_ids  text;
BEGIN
  SELECT count(*), count(DISTINCT z.id), sum(z.payment_amount) INTO v_n, v_nd, v_s
    FROM zaxira.oplata_kv_dub_zaxira z
   WHERE NOT EXISTS (SELECT 1 FROM oplata_kv_history h
                      WHERE h.oplata_kv_id = z.id AND h.action = 'deleted');

  SELECT array_agg(DISTINCT s.v) INTO v_keys
    FROM (SELECT z.id::text AS v           FROM zaxira.oplata_kv_dub_zaxira z
          UNION ALL
          SELECT z.source_tx_id::text      FROM zaxira.oplata_kv_dub_zaxira z) s
   WHERE s.v IS NOT NULL;

  SELECT count(*), string_agg(k.id || ' (source=' || coalesce(k.source_tx_id, '-') || ')', ', ')
    INTO v_live, v_ids
    FROM oplata_kv k
   WHERE k.id = ANY (v_keys) OR k.source_tx_id = ANY (v_keys);

  IF v_n <> 46 OR v_nd <> 46 OR v_s IS DISTINCT FROM 637256640.00 OR v_live <> 0 THEN
    RAISE EXCEPTION 'TOXTATILDI (f2): 09-24 zaxirasi tarixsiz=% noyob_id=% summa=% id_yoki_source_jonli=% (kutilgan 46 / 46 / 637256640.00 / 0). Jonli toqnashuvlar: %',
      v_n, v_nd, v_s, v_live, coalesce(v_ids, '-');
  END IF;
  RAISE NOTICE 'f2 guard OK: 09-24 zaxirasi 46 ta tarixsiz, 637256640.00, jonli toqnashuv yoq';
END $$;

-- f) oplata_kv_history tombstone — ENG OXIRGI buyruq, undan keyin darhol COMMIT.
--    Format ilova remove() bilan bir xil:
--    action='deleted', fields_changed={'*'}, changes={"snapshot": <to'liq qator>}.
--    Snapshot serializeForHistory() kabi: camelCase kalitlar, Date -> 'YYYY-MM-DD',
--    Decimal -> son. id: Prisma cuid() DB default emas — o'zimiz beramiz.
--    Zaxira jadvalidan o'qiladi (oplata_kv dagi qatorlar allaqachon o'chirilgan).
--    created_at: bitta qiymat, UTC, millisekundgacha (Prisma timestamp(3)),
--      = greatest(hozir, mavjud oxirgi 'deleted' + 1ms) — monoton: tombstone har doim
--      oxirgi ko'ringan 'deleted' dan KEYIN turadi, INSERT->COMMIT oralig'i millisekundlar.
--      Iste'molchi kursori (createdAt > cur.d) bizning yozuvdan o'tib ketmaydi.
DO $$
DECLARE
  v_now timestamp := date_trunc('milliseconds', clock_timestamp() AT TIME ZONE 'UTC');
  v_max timestamp;
  v_t   timestamp;
  v_cnt int;
BEGIN
  SELECT max(created_at) INTO v_max FROM oplata_kv_history WHERE action = 'deleted';
  IF v_max > v_now THEN
    RAISE EXCEPTION 'TOXTATILDI: oxirgi deleted tarix (%) DB UTC soatidan (%) oldinda — tombstone kelajakka surilardi',
      v_max, v_now;
  END IF;
  v_t := greatest(v_now, v_max + interval '1 millisecond');

  INSERT INTO oplata_kv_history
         (id, oplata_kv_id, action, actor_type, actor_id, actor_name,
          fields_changed, changes, note, created_at)
  SELECT 'c' || substr(md5(random()::text || clock_timestamp()::text || z.id), 1, 24),
         z.id,
         'deleted',
         'system',
         NULL,
         'system · sana-dublikat tozalash',
         ARRAY['*']::text[],
         jsonb_build_object('snapshot', jsonb_build_object(
           'id',                  z.id,
           'contractNo',          z.contract_no,
           'date',                to_char(z.date, 'YYYY-MM-DD'),
           'paymentAmount',       z.payment_amount::float8,
           'firstInstallment',    z.first_installment::float8,
           'monthlyAmount',       z.monthly_amount::float8,
           'purpose',             z.purpose,
           'txType',              z.tx_type,
           'note',                z.note,
           'paymentCategory',     z.payment_category::text,
           'object',              z.object,
           'client',              z.client,
           'paymentMethod',       z.payment_method,
           'createdAt',           to_char(z.created_at, 'YYYY-MM-DD'),
           'updatedAt',           to_char(z.updated_at, 'YYYY-MM-DD'),
           'createdById',         z.created_by_id,
           'createdByName',       z.created_by_name,
           'importBatchId',       z.import_batch_id,
           'sourceTxId',          z.source_tx_id,
           'perereboskaGroupId',  z.perereboska_group_id,
           'perereboskaFilePath', z.perereboska_file_path,
           'perereboskaFileName', z.perereboska_file_name,
           'perereboskaFileMime', z.perereboska_file_mime,
           'perereboskaFileSize', z.perereboska_file_size,
           'wasManuallyEdited',   z.was_manually_edited,
           'agentNotifiedAt',     to_char(z.agent_notified_at, 'YYYY-MM-DD')
         )),
         format('O''chirildi (%s · %s) — sana ko''chgan dublikat (yetim). To''lov %s qatorida qoladi (sana %s). Tozalash 2026-09-28',
                z.contract_no, to_char(z.date, 'YYYY-MM-DD'), nm.keep_id, to_char(nm.keep_date, 'YYYY-MM-DD')),
         v_t
    FROM zaxira.oplata_kv_dub_zaxira_20260928 z
    JOIN nomzod nm ON nm.del_id = z.id;
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  IF v_cnt <> 14 THEN
    RAISE EXCEPTION 'TOXTATILDI: history ga % ta yozildi (kutilgan 14)', v_cnt;
  END IF;
  RAISE NOTICE 'History: % ta deleted yozuvi, created_at=% (db_utc=%, oldingi_oxirgi_deleted=%)', v_cnt, v_t, v_now, v_max;

  -- f2) 2026-09-24 dagi 46 ta: guard yuqorida (f2 guard) tekshirilgan, shu v_t bilan.
  INSERT INTO oplata_kv_history
         (id, oplata_kv_id, action, actor_type, actor_id, actor_name,
          fields_changed, changes, note, created_at)
  SELECT 'c' || substr(md5(random()::text || clock_timestamp()::text || z.id), 1, 24),
         z.id,
         'deleted',
         'system',
         NULL,
         'system · sana-dublikat tozalash',
         ARRAY['*']::text[],
         jsonb_build_object('snapshot', jsonb_build_object(
           'id',                  z.id,
           'contractNo',          z.contract_no,
           'date',                to_char(z.date, 'YYYY-MM-DD'),
           'paymentAmount',       z.payment_amount::float8,
           'firstInstallment',    z.first_installment::float8,
           'monthlyAmount',       z.monthly_amount::float8,
           'purpose',             z.purpose,
           'txType',              z.tx_type,
           'note',                z.note,
           'paymentCategory',     z.payment_category::text,
           'object',              z.object,
           'client',              z.client,
           'paymentMethod',       z.payment_method,
           'createdAt',           to_char(z.created_at, 'YYYY-MM-DD'),
           'updatedAt',           to_char(z.updated_at, 'YYYY-MM-DD'),
           'createdById',         z.created_by_id,
           'createdByName',       z.created_by_name,
           'importBatchId',       z.import_batch_id,
           'sourceTxId',          z.source_tx_id,
           'perereboskaGroupId',  z.perereboska_group_id,
           'perereboskaFilePath', z.perereboska_file_path,
           'perereboskaFileName', z.perereboska_file_name,
           'perereboskaFileMime', z.perereboska_file_mime,
           'perereboskaFileSize', z.perereboska_file_size,
           'wasManuallyEdited',   z.was_manually_edited,
           'agentNotifiedAt',     to_char(z.agent_notified_at, 'YYYY-MM-DD')
         )),
         format('O''chirildi (%s · %s) — sana ko''chgan dublikat (yetim). Tozalash 2026-09-24, tombstone 2026-09-28 da yozildi',
                z.contract_no, to_char(z.date, 'YYYY-MM-DD')),
         v_t
    FROM zaxira.oplata_kv_dub_zaxira z
   WHERE NOT EXISTS (SELECT 1 FROM oplata_kv_history h
                      WHERE h.oplata_kv_id = z.id AND h.action = 'deleted');
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  IF v_cnt <> 46 THEN
    RAISE EXCEPTION 'TOXTATILDI (f2): history ga % ta yozildi (kutilgan 46)', v_cnt;
  END IF;
  RAISE NOTICE 'History (09-24): % ta deleted yozuvi, created_at=%', v_cnt, v_t;
END $$;

COMMIT;

-- 5) COMMIT dan keyin (faqat o'qish): tombstone'lar ko'rinadi
\echo '=== 5. Tombstone (kutilgan: bugungi 14 + 09-24 dagi 46, min = max created_at) ==='
SELECT (SELECT count(*) FROM oplata_kv_history h
         WHERE h.action = 'deleted' AND h.actor_name = 'system · sana-dublikat tozalash'
           AND h.oplata_kv_id IN (SELECT id FROM zaxira.oplata_kv_dub_zaxira_20260928)) AS bugungi_14,
       (SELECT count(*) FROM oplata_kv_history h
         WHERE h.action = 'deleted' AND h.actor_name = 'system · sana-dublikat tozalash'
           AND h.oplata_kv_id IN (SELECT id FROM zaxira.oplata_kv_dub_zaxira))          AS eski_46,
       (SELECT min(created_at) FROM oplata_kv_history
         WHERE action = 'deleted' AND actor_name = 'system · sana-dublikat tozalash')   AS created_at_min,
       (SELECT max(created_at) FROM oplata_kv_history
         WHERE action = 'deleted' AND actor_name = 'system · sana-dublikat tozalash')   AS created_at_max;

\echo '=== TAYYOR: 14 ta yetim ochirildi (zaxira.oplata_kv_dub_zaxira_20260928), 09-24 dagi 46 ta uchun tombstone yozildi ==='
\echo '    1d/1e da qator chiqqan bolsa: shu shartnomalarni qayta split qiling (qolda_* = 0 bolsa force:true).'
