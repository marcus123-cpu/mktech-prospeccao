import { createHash, randomUUID } from "node:crypto";
import pg from "pg";

// Banco local isolado (tests/db/reset.sh). Nunca aponta para o Supabase real.
const testHost=process.env.PGHOST ?? (process.platform==="win32" ? "127.0.0.1" : "/tmp");
if (!["127.0.0.1","localhost","/tmp"].includes(testHost) || Number(process.env.PGPORT ?? 54329)!==54329 || !/^crm_test(?:_[a-z0-9]+)?$/.test(process.env.TEST_DB ?? "crm_test")) {
  throw new Error("Testes destrutivos permitidos somente no banco crm_test local na porta 54329.");
}
export const pool = new pg.Pool({
  host: testHost,
  port: Number(process.env.PGPORT ?? 54329),
  user: process.env.PGUSER ?? "postgres",
  database: process.env.TEST_DB ?? "crm_test",
  max: 12,
});

export const ADMIN_ID = "00000000-0000-4000-8000-000000000001";
export const OUTSIDER_ID = "00000000-0000-4000-8000-000000000002";

export async function resetData() {
  await pool.query(`
    truncate public.leads, public.lead_evidences, public.contact_events, public.stage_events, public.lead_notes,
      public.proposals, public.lead_diagnoses, public.lead_messages, public.lead_message_uses, public.outreach_messages, public.outreach_replies, public.duplicate_reviews, public.dedupe_events, public.hermes_runs,
      public.idempotency_keys, public.integration_tokens, public.app_admins, public.commercial_campaigns, public.lead_lists, auth.users cascade;
    update public.prospecting_settings set daily_target = 20, max_run_minutes = 45, routine_enabled = false, restock_enabled = false, restock_min = 20, restock_batch = 20;
    delete from public.outreach_settings;
    insert into public.outreach_settings (id) values (1);
    truncate public.commercial_products;
    insert into public.commercial_settings(id) values(1) on conflict(id) do nothing;
    update public.commercial_settings set v6_validation_run=null,engine_version='v4',new_contacts_enabled=true,enabled=false,channel_authorized=false,test_mode=true,test_phones='{}',
      video_configured=false,allowed_strategies=array['A','B','C'],experiment_enabled=true,max_messages=15,last_worker_at=null,last_sender_at=null,bridge_connected=null,bridge_state_changed_at=null;
  `);
  await pool.query(`insert into auth.users (id, email) values ($1, 'admin@teste.local'), ($2, 'outro@teste.local')`, [
    ADMIN_ID,
    OUTSIDER_ID,
  ]);
  await pool.query(`insert into public.app_admins (user_id) values ($1)`, [ADMIN_ID]);
}

type Role = "anon" | "authenticated" | "service_role";

export async function as<T>(role: Role, userId: string | null, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query(`set local role ${role}`);
    await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId ?? ""]);
    const result = await fn(c);
    await c.query("commit");
    return result;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

export const asAdmin = <T>(fn: (c: pg.PoolClient) => Promise<T>) => as("authenticated", ADMIN_ID, fn);
export const asService = <T>(fn: (c: pg.PoolClient) => Promise<T>) => as("service_role", null, fn);

export async function rpc<T = any>(c: pg.PoolClient, sql: string, params: unknown[] = []): Promise<T> {
  const r = await c.query(sql, params);
  return Object.values(r.rows[0] ?? {})[0] as T;
}

export const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

export async function createToken(): Promise<{ id: string; token: string }> {
  return asAdmin((c) => rpc(c, `select public.admin_create_integration_token('teste')`));
}

export async function tokenId(token: string, scope = "candidatos:criar"): Promise<string | null> {
  return asService((c) => rpc(c, `select public.api_token_check($1, $2)`, [sha256(token), scope]));
}

export function candidate(overrides: Record<string, unknown> = {}) {
  return {
    business_name: "Clínica Bella Pelle",
    city: "Votuporanga",
    state: "SP",
    phone: "(17) 99123-4567",
    instagram: "@bellapelle.estetica",
    selection_reason: "Estética facial com WhatsApp comercial e sem site próprio localizado.",
    site_status: "site_nao_localizado",
    priority: "alta",
    evidences: [
      {
        kind: "instagram",
        url: "https://instagram.com/bellapelle.estetica",
        summary: "Perfil comercial com botox e harmonização na bio.",
        observed_at: "2026-10-09",
      },
    ],
    ...overrides,
  };
}

export async function register(tokenUuid: string, payload: object, key = randomUUID(), run: string | null = null) {
  return asService((c) =>
    rpc(c, `select public.api_register_candidate($1, $2, $3::jsonb, $4)`, [tokenUuid, key, JSON.stringify(payload), run]),
  );
}

export async function count(table: string, where = "true"): Promise<number> {
  const r = await pool.query(`select count(*)::int as n from ${table} where ${where}`);
  return r.rows[0].n;
}

// Coloca o lead em uma campanha já ativa (sem passar pelas validações do painel).
export async function enroll(leadId: string, mode: "simulacao" | "autonomo" = "autonomo", status = "ativa"): Promise<string> {
  const camp = (await pool.query("insert into public.commercial_campaigns(name,mode,status) values ('Teste',$1,$2) returning id", [mode, status])).rows[0].id;
  await pool.query("insert into public.commercial_campaign_leads(lead_id,campaign_id,baseline) select lead_id,$2,to_jsonb(c) from public.commercial_leads c where lead_id=$1", [leadId, camp]);
  return camp;
}
