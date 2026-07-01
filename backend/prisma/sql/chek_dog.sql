-- chek_dog jadvali — "Chek" sahifasi (shartnoma nazorati jurnali).
-- Prisma model: ChekDog (schema.prisma). DB'da hali yo'q bo'lsa shu SQL qo'llaniladi.
-- Qo'llash: `prisma db push` (tavsiya) YOKI to'g'ridan-to'g'ri shu SQL.

CREATE TABLE IF NOT EXISTS "chek_dog" (
  "id"              TEXT PRIMARY KEY,
  "contract_number" VARCHAR(128) NOT NULL,
  "manager"         VARCHAR(255),
  "manager_phone"   VARCHAR(64),
  "branch_name"     VARCHAR(255),
  "object_name"     VARCHAR(255),
  "data"            DATE NOT NULL,
  "vid_dogovora"    VARCHAR(48) NOT NULL,
  "kontrolyor"      VARCHAR(16) NOT NULL,
  "prichina_otkaza" TEXT,
  "shtrafy"         BIGINT,
  "dobavil_id"      TEXT,
  "dobavil_name"    VARCHAR(255),
  "tg_send"         BOOLEAN NOT NULL DEFAULT false,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3) NOT NULL
);

CREATE INDEX IF NOT EXISTS "chek_dog_created_at_idx" ON "chek_dog" ("created_at" DESC);
CREATE INDEX IF NOT EXISTS "chek_dog_contract_number_idx" ON "chek_dog" ("contract_number");
