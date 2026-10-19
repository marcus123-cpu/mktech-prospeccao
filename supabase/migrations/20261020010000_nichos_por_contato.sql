-- Visão geral de leads separada em "nichos não contatados" e "nichos contatados".
-- Cada nicho só aparece num grupo se tiver pelo menos um lead daquele grupo. Contatos do WhatsApp pessoal não entram.
create or replace function public.admin_lead_dashboard_grupo(p_contacted boolean) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'Acesso negado' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(n) order by n.grupo_total desc, n.niche), '[]') from (
    select coalesce(nullif(btrim(niche), ''), 'Sem nicho') as niche,
      count(*) filter (where contacted = p_contacted) as grupo_total,
      count(*) filter (where contacted) as contatados_total,
      count(*) filter (where not contacted) as novos_total,
      count(*) filter (where contacted = p_contacted and phone_e164 ~ '^\+55[0-9]{2}9[0-9]{8}$') as celular,
      count(*) filter (where contacted = p_contacted and phone_e164 is null and instagram_handle is not null) as instagram_only,
      count(*) filter (where contacted = p_contacted and phone_e164 ~ '^\+55[0-9]{10}$') as landline,
      count(*) filter (where contacted = p_contacted and phone_e164 is null) as no_phone,
      count(*) filter (where contacted = p_contacted and stage = 'contatado') as sem_resposta,
      count(*) filter (where contacted = p_contacted and stage <> 'contatado') as responderam
    from leads where source_name is distinct from 'WhatsApp'
    group by 1 having count(*) filter (where contacted = p_contacted) > 0) n);
end $$;
revoke all on function public.admin_lead_dashboard_grupo(boolean) from public, anon;
grant execute on function public.admin_lead_dashboard_grupo(boolean) to authenticated;
