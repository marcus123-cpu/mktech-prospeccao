-- V6 permanece desativado até validação. Histórico e CRM existentes preservados.
alter table public.commercial_settings add column engine_version text not null default 'v4' check(engine_version in ('v4','v6'));
alter table public.commercial_settings add column new_contacts_enabled boolean not null default true;
alter table public.commercial_leads add column conversation_phase text not null default 'NEEDS_RESEARCH';
alter table public.commercial_leads add column recipient_timezone text;
alter table public.commercial_leads add column readiness jsonb not null default '{}';
alter table public.commercial_leads add column commercial_memory jsonb not null default '{"summary":"","confirmed_facts":[],"uncertain_facts":[],"answered_questions":[],"objections":[],"next_action":"","solution":null,"introduced":false,"channel_confirmed":false,"wait_acknowledged":[]}';
alter table public.commercial_leads add column lease_id uuid;
alter table public.commercial_leads add column lease_token uuid;
alter table public.commercial_leads add column lease_until timestamptz;
alter table public.commercial_leads add column lease_context jsonb;
alter table public.commercial_leads add column inference_failures integer not null default 0;
alter table public.commercial_leads add column retry_not_before timestamptz;
alter table public.outreach_replies add column semantic_interpretation jsonb;
alter table public.commercial_decisions add column semantic_metadata jsonb;
create index commercial_v6_pending_idx on public.outreach_replies(lead_id,received_at,id) where semantic_interpretation is null;
create table public.commercial_test_runs (
 id uuid primary key default gen_random_uuid(),lead_id uuid not null references leads(id),started_at timestamptz not null default now(),ended_at timestamptz,
 profile_snapshot jsonb not null,lead_snapshot jsonb not null,memory_snapshot jsonb,final_snapshot jsonb,research jsonb not null,
 check(research->>'simulation'='true')
);
alter table public.commercial_test_runs enable row level security;
revoke all on public.commercial_test_runs from anon,authenticated;
grant select on public.commercial_test_runs to authenticated;
grant all on public.commercial_test_runs to service_role;
create policy commercial_test_admin_read on public.commercial_test_runs for select to authenticated using(is_admin());
alter table public.commercial_leads add column active_test_run uuid references commercial_test_runs(id);
alter table public.commercial_outbox add column test_run_id uuid references commercial_test_runs(id);
drop index public.commercial_demo_once;
create unique index commercial_demo_once on public.commercial_outbox(lead_id,demonstration_id) where kind='demo' and status<>'cancelada' and test_run_id is null;
create unique index commercial_demo_test_once on public.commercial_outbox(test_run_id,demonstration_id) where kind='demo' and status<>'cancelada' and test_run_id is not null;
