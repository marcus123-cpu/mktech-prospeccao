import { createHash, randomUUID } from "node:crypto";
import pg from "pg";

// Banco local isolado (tests/db/reset.sh). Nunca aponta para o Supabase real.
export const pool = new pg.Pool({
  host: process.env.PGHOST ?? "/tmp",
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
      public.proposals, public.lead_diagnoses, public.duplicate_reviews, public.dedupe_events, public.hermes_runs,
      public.idempotency_keys, public.integration_tokens, public.app_admins, auth.users cascade;
    update public.prospecting_settings set daily_target = 20, max_run_minutes = 45, routine_enabled = false;
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
