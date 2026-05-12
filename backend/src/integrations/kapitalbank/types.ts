// KapitalBank OpenAPI v3 (tz/KapitalAPI V3.pdf) yozuvlari ↓

export interface KapitalbankError {
  code: number;
  message: string;
}

export interface KapitalbankResponse<T> {
  error: KapitalbankError | null;
  id: number;
  result: T;
}

export interface KbAccount {
  aid: number;
  branch: string;
  account: string;
  name: string;
  val: string;
  o_date?: string;
  l_date?: string;
  s_in?: number;
  s_out?: number;
  dt?: number;
  ct?: number;
  canpay?: number;
  state?: number;
  stateName?: string;
}

export interface KbClient {
  id: number | string;
  branch: string;
  code: string;
  name: string;
  oper_day?: string;
  inn?: string;
  accounts?: KbAccount[];
}

export interface KbLoginResult {
  login: string;
  sid: string;
  clients: KbClient[];
}

/** GetDoc1C dagi bitta yozuv (content[]) — PDF §4.1 */
export interface KbDoc1CItem {
  time?: string;
  input_date?: string;
  input_time?: string;
  client_id?: number;
  num?: string;
  branch?: string;
  general_id?: string;
  b2_id?: string;          // bank bo'yicha noyob — externalId sifatida ishlatamiz
  uniq?: string;
  ddate?: string;          // dd.MM.yyyy
  vdate?: string;
  stime?: string;
  mfo_dt?: string;
  acc_dt?: string;
  name_dt?: string;
  inn_dt?: string;
  mfo_ct?: string;
  acc_ct?: string;
  name_ct?: string;
  inn_ct?: string;
  purpose?: string;
  purp_code?: string;
  amount?: number;         // tiyin/tiin (eng kichik birlik)
  dtype?: string;
  state?: number;
  dir?: number;            // 1 — chiqim, 2 — kirim (PDF §9.7)
  err?: string;
  err_msg?: string;
  anor?: number;
}

export interface KbDoc1CResult {
  content: KbDoc1CItem[];
  total_debit?: number;
  total_credit?: number;
  saldo_in?: number;
  saldo_out?: number;
  fin?: number;
  oper_day?: string;
}
