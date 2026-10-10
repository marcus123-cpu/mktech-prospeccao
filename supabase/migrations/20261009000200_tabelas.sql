-- Tabelas do CRM. Instantes ficam em timestamptz (UTC); a conversão para
-- America/Sao_Paulo é feita nas consultas e na interface.

create type public.lead_stage as enum (
  'novo', 'contatado', 'respondeu', 'interessado', 'proposta_enviada', 'fechado', 'sem_interesse', 'desqualificado'
);
create type public.site_status as enum (
  'site_proprio_encontrado', 'site_nao_localizado', 'apenas_redes_sociais', 'verificacao_pendente'
);
create type public.lead_origin as enum ('hermes', 'importacao', 'manual');
create type public.lead_priority as enum ('alta', 'media', 'baixa');

-- Administradores do painel. Só quem está aqui enxerga os dados, mesmo que
-- alguém consiga criar uma conta no Auth.
create table public.app_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  business_name text not null check (length(btrim(business_name)) between 1 and 200),
  responsible_name text,
  niche text,
  services text[] not null default '{}',
  city text not null check (length(btrim(city)) between 1 and 120),
  state text not null default 'SP' check (state ~ '^[A-Z]{2}$'),
  neighborhood text,
  unit_label text,
  phone_raw text,
  phone_e164 text check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  instagram_raw text,
  instagram_handle text,
  whatsapp_url text,
  website_url text,
  website_domain text,
  source_name text,
  source_place_id text,
  research_date date,
  selection_reason text,
  pending_items text,
  priority public.lead_priority not null default 'media',
  site_status public.site_status not null default 'verificacao_pendente',
  origin public.lead_origin not null,
  stage public.lead_stage not null default 'novo',
  -- Resumo do histórico de contatos, mantido por gatilho a partir de contact_events.
  contacted boolean not null default false,
  contact_date_unknown boolean not null default false,
  first_contact_at timestamptz,
  last_contact_at timestamptz,
  contact_count integer not null default 0,
  next_follow_up_at timestamptz,
  proposal_value numeric(12, 2) check (proposal_value >= 0),
  proposal_sent_at timestamptz,
  closed_value numeric(12, 2) check (closed_value >= 0),
  closed_at timestamptz,
  loss_reason text,
  -- Campos normalizados, sempre recalculados pelo gatilho leads_normalize.
  name_norm text not null,
  name_core text not null,
  city_norm text not null,
  unit_key text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leads_fechado_completo check (stage <> 'fechado' or (closed_value is not null and closed_at is not null))
);

-- Restrições fortes: o mesmo perfil na mesma unidade e o mesmo identificador
-- da fonte nunca geram duas fichas. Telefone e domínio não são únicos porque
-- podem ser compartilhados por negócios diferentes (vão para revisão).
create unique index leads_instagram_unidade_uq on public.leads (instagram_handle, unit_key) where instagram_handle is not null;
create unique index leads_fonte_uq on public.leads (coalesce(source_name, ''), source_place_id) where source_place_id is not null;
create index leads_phone_idx on public.leads (phone_e164) where phone_e164 is not null;
create index leads_domain_idx on public.leads (website_domain) where website_domain is not null;
create index leads_city_name_idx on public.leads (city_norm, name_core);
create index leads_name_trgm_idx on public.leads using gin (name_core extensions.gin_trgm_ops);
create index leads_stage_idx on public.leads (stage);
create index leads_created_idx on public.leads (created_at desc);
create index leads_follow_up_idx on public.leads (next_follow_up_at) where next_follow_up_at is not null;

create table public.lead_evidences (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  kind text not null check (kind in ('site', 'instagram', 'google', 'whatsapp', 'diretorio', 'busca', 'outro')),
  url text,
  summary text not null check (length(summary) <= 2000),
  observed_at timestamptz not null default now(),
  limitation text check (length(limitation) <= 1000),
  run_id uuid,
  created_at timestamptz not null default now()
);
create index lead_evidences_lead_idx on public.lead_evidences (lead_id, observed_at);

-- Cada contato realizado é um evento. Correções anulam o evento (voided_at)
-- sem apagá-lo, preservando a auditoria. occurred_at nulo = data desconhecida
-- (ex.: planilha importada que só dizia "Sim").
create table public.contact_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  occurred_at timestamptz,
  channel text not null default 'whatsapp' check (channel in ('whatsapp', 'instagram', 'telefone', 'email', 'presencial', 'outro')),
  note text check (length(note) <= 2000),
  source text not null default 'manual' check (source in ('manual', 'importacao')),
  voided_at timestamptz,
  void_reason text,
  corrects_event_id uuid references public.contact_events (id),
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint contact_void_reason check (voided_at is null or length(btrim(coalesce(void_reason, ''))) > 0)
);
create index contact_events_lead_idx on public.contact_events (lead_id);
create index contact_events_occurred_idx on public.contact_events (occurred_at) where voided_at is null;

create table public.stage_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  from_stage public.lead_stage,
  to_stage public.lead_stage not null,
  changed_at timestamptz not null default now(),
  note text,
  source text not null default 'manual'
);
create index stage_events_lead_idx on public.stage_events (lead_id, changed_at);
create index stage_events_to_idx on public.stage_events (to_stage, changed_at);

create table public.lead_notes (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  body text not null check (length(btrim(body)) between 1 and 5000),
  source text not null default 'manual' check (source in ('manual', 'importacao')),
  created_by uuid,
  created_at timestamptz not null default now()
);
create index lead_notes_lead_idx on public.lead_notes (lead_id, created_at);

create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  value numeric(12, 2) not null check (value >= 0),
  sent_at timestamptz not null,
  note text,
  created_at timestamptz not null default now()
);
create index proposals_lead_idx on public.proposals (lead_id, sent_at);

-- Execuções do Hermes. O índice único parcial impede duas execuções
-- simultâneas da mesma rotina.
create table public.hermes_runs (
  id uuid primary key default gen_random_uuid(),
  routine text not null default 'prospeccao-diaria',
  status text not null default 'em_andamento'
    check (status in ('em_andamento', 'concluida', 'parcial', 'falhou', 'abandonada')),
  token_id uuid,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  config jsonb not null default '{}',
  searched integer not null default 0,
  approved integer not null default 0,
  created integer not null default 0,
  existing integer not null default 0,
  possible_duplicates integer not null default 0,
  discarded integer not null default 0,
  invalid integer not null default 0,
  errors integer not null default 0,
  error_details jsonb not null default '[]',
  end_reason text,
  notes text
);
create unique index hermes_runs_uma_por_rotina on public.hermes_runs (routine) where status = 'em_andamento';
create index hermes_runs_started_idx on public.hermes_runs (started_at desc);

alter table public.lead_evidences
  add constraint lead_evidences_run_fk foreign key (run_id) references public.hermes_runs (id) on delete set null;

-- Fila de possíveis duplicados. O Hermes nunca mescla nem apaga: o candidato
-- fica aqui até o administrador decidir.
create table public.duplicate_reviews (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null,
  candidate jsonb not null,
  business_name text not null,
  city text not null,
  reason text not null,
  matched_lead_ids uuid[] not null default '{}',
  origin public.lead_origin not null,
  run_id uuid references public.hermes_runs (id) on delete set null,
  status text not null default 'pendente' check (status in ('pendente', 'criado_novo', 'vinculado', 'descartado')),
  resolution_lead_id uuid references public.leads (id) on delete set null,
  resolution_note text,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index duplicate_reviews_pendente_uq on public.duplicate_reviews (fingerprint) where status = 'pendente';
create index duplicate_reviews_status_idx on public.duplicate_reviews (status, created_at desc);

-- Cada tentativa de cadastro barrada (já existente ou enviada para revisão),
-- base do indicador "duplicados bloqueados".
create table public.dedupe_events (
  id uuid primary key default gen_random_uuid(),
  outcome text not null check (outcome in ('existente', 'revisao')),
  lead_id uuid references public.leads (id) on delete set null,
  review_id uuid references public.duplicate_reviews (id) on delete set null,
  matched_on text not null,
  origin public.lead_origin not null,
  run_id uuid references public.hermes_runs (id) on delete set null,
  created_at timestamptz not null default now()
);
create index dedupe_events_created_idx on public.dedupe_events (created_at);

-- Credenciais da integração. Guardamos só o hash SHA-256 do token.
create table public.integration_tokens (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  token_hash text not null unique,
  token_prefix text not null,
  scopes text[] not null default array['duplicados:ler', 'candidatos:criar', 'execucoes:registrar', 'config:ler'],
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_used_at timestamptz,
  constraint integration_scopes_validos check (
    scopes <@ array['duplicados:ler', 'candidatos:criar', 'execucoes:registrar', 'config:ler']
  )
);

alter table public.hermes_runs
  add constraint hermes_runs_token_fk foreign key (token_id) references public.integration_tokens (id) on delete set null;

create table public.idempotency_keys (
  scope text not null,
  key text not null check (length(key) between 8 and 200),
  request_hash text not null,
  response jsonb,
  created_at timestamptz not null default now(),
  primary key (scope, key)
);

create table public.prospecting_settings (
  id smallint primary key default 1 check (id = 1),
  daily_target integer not null default 20 check (daily_target between 1 and 100),
  cities text[] not null default array['Fernandópolis', 'Votuporanga', 'São José do Rio Preto', 'Bauru', 'Marília'],
  state text not null default 'SP',
  niches text[] not null default array['estética facial', 'botox', 'harmonização facial', 'estética avançada', 'clínica de estética'],
  max_run_minutes integer not null default 45 check (max_run_minutes between 5 and 240),
  max_searches integer not null default 60 check (max_searches between 1 and 500),
  max_cost_usd numeric(8, 2) not null default 0 check (max_cost_usd >= 0),
  routine_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.prospecting_settings (id) values (1);
