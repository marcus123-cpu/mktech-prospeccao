-- Diagnóstico comercial do lead feito pelo Hermes: quem é o negócio, que
-- dores aparecem nas evidências, qual serviço da MKTech faz sentido e como
-- abordar. É material para o Marcos decidir e abordar; o Hermes não contata
-- ninguém. Cada pesquisa gera uma versão nova (histórico preservado); a ficha
-- guarda a nota e a oferta da versão mais recente para filtrar e ordenar.

create table public.lead_diagnoses (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  run_id uuid,
  fit_score integer not null check (fit_score between 0 and 100),
  confidence text not null check (confidence in ('baixa', 'media', 'alta')),
  summary text not null check (length(summary) between 1 and 2000),
  audience text check (length(audience) <= 1000),
  digital_presence text check (length(digital_presence) <= 2000),
  pains jsonb not null default '[]' check (jsonb_typeof(pains) = 'array'),
  opportunities text[] not null default '{}',
  offer text not null check (offer in (
    'landing_page', 'landing_por_procedimento', 'site_institucional', 'site_com_agendamento', 'nao_recomendado'
  )),
  offer_reason text not null check (length(offer_reason) between 1 and 2000),
  approach text check (length(approach) <= 2000),
  objections text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index lead_diagnoses_lead_idx on public.lead_diagnoses (lead_id, created_at desc);

alter table public.leads
  add column fit_score integer check (fit_score between 0 and 100),
  add column recommended_offer text;
create index leads_fit_score_idx on public.leads (fit_score desc nulls last);

alter table public.lead_diagnoses enable row level security;
revoke all on public.lead_diagnoses from anon, authenticated;
grant select on public.lead_diagnoses to authenticated;
create policy admin_le on public.lead_diagnoses for select to authenticated using (public.is_admin());

-- Grava o diagnóstico que vier no candidato. Diagnóstico malformado é
-- ignorado aqui porque a API já o recusa antes; o banco só não quebra o
-- cadastro por causa dele.
create or replace function public.insert_diagnosis(p_lead uuid, p jsonb, p_run uuid) returns void
language plpgsql
set search_path = public
as $$
declare
  d jsonb := p -> 'diagnosis';
begin
  if d is null or jsonb_typeof(d) <> 'object' then
    return;
  end if;
  begin
    insert into lead_diagnoses (
      lead_id, run_id, fit_score, confidence, summary, audience, digital_presence,
      pains, opportunities, offer, offer_reason, approach, objections
    ) values (
      p_lead, p_run,
      (d ->> 'fit_score')::int,
      d ->> 'confidence',
      d ->> 'summary',
      nullif(btrim(d ->> 'audience'), ''),
      nullif(btrim(d ->> 'digital_presence'), ''),
      coalesce(d -> 'pains', '[]'),
      coalesce(array(select jsonb_array_elements_text(d -> 'opportunities')), '{}'),
      d ->> 'offer',
      d ->> 'offer_reason',
      nullif(btrim(d ->> 'approach'), ''),
      coalesce(array(select jsonb_array_elements_text(d -> 'objections')), '{}')
    );
    update leads set fit_score = (d ->> 'fit_score')::int, recommended_offer = d ->> 'offer' where id = p_lead;
  exception when check_violation or not_null_violation or invalid_text_representation or data_exception then
    raise warning 'diagnóstico ignorado para o lead %: %', p_lead, sqlerrm;
  end;
end
$$;

-- Todo caminho que grava evidências (cadastro novo, lead existente e
-- resolução da fila de duplicados) passa por aqui, então o diagnóstico
-- acompanha as evidências.
create or replace function public.insert_evidences(p_lead uuid, p jsonb, p_run uuid) returns void
language plpgsql
set search_path = public
as $$
begin
  insert into lead_evidences (lead_id, kind, url, summary, observed_at, limitation, run_id)
  select p_lead,
         ev ->> 'kind',
         nullif(ev ->> 'url', ''),
         ev ->> 'summary',
         coalesce(nullif(ev ->> 'observed_at', '')::timestamptz, now()),
         nullif(ev ->> 'limitation', ''),
         p_run
  from jsonb_array_elements(coalesce(p -> 'evidences', '[]'::jsonb)) ev;
  perform insert_diagnosis(p_lead, p, p_run);
end
$$;

revoke execute on function public.insert_diagnosis(uuid, jsonb, uuid) from public, anon, authenticated;
revoke execute on function public.insert_evidences(uuid, jsonb, uuid) from public, anon, authenticated;
