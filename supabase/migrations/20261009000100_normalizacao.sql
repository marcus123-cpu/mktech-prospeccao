-- Extensões e funções de normalização usadas pelo controle de duplicados.
-- O banco é a fonte de verdade da normalização: os valores normalizados
-- das fichas são sempre recalculados aqui, nunca confiados ao cliente.

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

create or replace function public.f_unaccent(t text) returns text
language sql immutable parallel safe strict
set search_path = ''
as $$ select extensions.unaccent('extensions.unaccent'::regdictionary, t) $$;

-- Texto em minúsculas, sem acento e só com letras/números separados por espaço.
create or replace function public.norm_text(t text) returns text
language sql immutable parallel safe
set search_path = ''
as $$
  select nullif(btrim(regexp_replace(lower(public.f_unaccent(coalesce(t, ''))), '[^a-z0-9]+', ' ', 'g')), '')
$$;

-- Núcleo do nome comercial, sem palavras genéricas do nicho. Serve só para
-- comparar semelhança; nunca autoriza mesclar sozinho.
create or replace function public.norm_business_core(t text) returns text
language sql immutable parallel safe
set search_path = ''
as $$
  select coalesce(
    nullif(btrim(regexp_replace(regexp_replace(coalesce(public.norm_text(t), ''),
      '\m(clinica|clinicas|estetica|esteticas|estetic|studio|estudio|espaco|centro|instituto|dra|dr|de|da|do|das|dos|e|beauty|beleza|harmonizacao|facial|avancada|ltda|me|eireli|epp)\M',
      '', 'g'), '\s+', ' ', 'g')), ''),
    public.norm_text(t)
  )
$$;

-- Identificador da unidade (ex.: "Centro", "Shopping"). Vazio quando não informado.
create or replace function public.norm_unit(t text) returns text
language sql immutable parallel safe
set search_path = ''
as $$ select coalesce(public.norm_text(t), '') $$;

-- Instagram: aceita @perfil, perfil, URLs com ou sem www/protocolo/parâmetros.
-- Retorna null quando não é um perfil válido (post, reel, outro domínio).
create or replace function public.norm_instagram(t text) returns text
language plpgsql immutable parallel safe
set search_path = ''
as $$
declare
  s text;
  is_url boolean;
begin
  if t is null then
    return null;
  end if;
  s := lower(btrim(t));
  is_url := s ~ '^https?://';
  s := regexp_replace(s, '^https?://', '');
  -- "clinica.bella" é um perfil válido; só tratamos como URL quando há
  -- protocolo, barra ou o próprio domínio do Instagram.
  if is_url or s ~ '^([a-z0-9-]+\.)+[a-z]{2,}/' or s ~ '^(www\.|m\.)?(instagram\.com|instagr\.am)$' then
    if s !~ '^(www\.|m\.)?(instagram\.com|instagr\.am)(/|$)' then
      return null;
    end if;
    s := regexp_replace(s, '^(www\.|m\.)?(instagram\.com|instagr\.am)/?', '');
  end if;
  s := regexp_replace(s, '^@+', '');
  s := split_part(split_part(split_part(s, '?', 1), '#', 1), '/', 1);
  s := btrim(s);
  if s in ('', 'p', 'reel', 'reels', 'explore', 'stories', 'accounts', 'tv', 'direct') then
    return null;
  end if;
  if s !~ '^[a-z0-9._]{1,30}$' then
    return null;
  end if;
  return s;
end
$$;

-- Domínio do site: minúsculo, sem www, porta, caminho ou parâmetros.
create or replace function public.norm_domain(t text) returns text
language plpgsql immutable parallel safe
set search_path = ''
as $$
declare
  s text;
begin
  if t is null then
    return null;
  end if;
  s := lower(btrim(t));
  s := regexp_replace(s, '^[a-z][a-z0-9+.-]*://', '');
  s := regexp_replace(s, '^[^/@]*@', '');
  s := split_part(split_part(split_part(s, '/', 1), '?', 1), '#', 1);
  s := split_part(s, ':', 1);
  s := regexp_replace(s, '^www\d?\.', '');
  s := rtrim(s, '.');
  if s !~ '^([a-z0-9-]+\.)+[a-z]{2,}$' then
    return null;
  end if;
  return s;
end
$$;

-- Domínios que não contam como site próprio: redes sociais, menus de links,
-- mensageiros, encurtadores, mapas e diretórios/agendadores.
create or replace function public.is_social_or_link_domain(d text) returns boolean
language sql immutable parallel safe
set search_path = ''
as $$
  select d is not null and exists (
    select 1
    from unnest(array[
      'instagram.com', 'instagr.am', 'facebook.com', 'fb.com', 'fb.me', 'tiktok.com', 'youtube.com', 'youtu.be',
      'x.com', 'twitter.com', 'threads.net', 'pinterest.com', 'linkedin.com', 'kwai.com',
      'wa.me', 'whatsapp.com', 'wa.link', 't.me', 'telegram.me',
      'linktr.ee', 'linkin.bio', 'lnk.bio', 'beacons.ai', 'bio.site', 'taplink.cc', 'taplink.at', 'msha.ke',
      'linkbio.co', 'bio.link', 'campsite.bio', 'hoo.be', 'solo.to', 'link.bio', 'linklist.bio',
      'bit.ly', 'tinyurl.com', 'cutt.ly', 'encurtador.com.br',
      'google.com', 'google.com.br', 'goo.gl', 'g.page', 'g.co', 'business.site',
      'doctoralia.com.br', 'booksy.com', 'trinks.com', 'agendor.com.br', 'gendo.app', 'avec.app', 'simplesagenda.com.br'
    ]) as s(dom)
    where (d = s.dom or d like '%.' || s.dom)
      and d <> 'sites.google.com'
  )
$$;

-- Telefone brasileiro em E.164 (+55DDDNÚMERO). Insere o nono dígito em
-- celulares antigos de 8 dígitos. Números estrangeiros precisam vir com "+".
-- Retorna null quando não dá para identificar DDD e número com segurança.
create or replace function public.norm_phone(t text) returns text
language plpgsql immutable parallel safe
set search_path = ''
as $$
declare
  d text;
begin
  if t is null then
    return null;
  end if;
  d := regexp_replace(t, '\D', '', 'g');
  if d = '' then
    return null;
  end if;
  if btrim(t) ~ '^\+' and d !~ '^55' then
    return case when length(d) between 8 and 15 and d !~ '^0' then '+' || d end;
  end if;
  if d ~ '^00' then
    d := substr(d, 3);
  end if;
  if d ~ '^55' and length(d) in (12, 13) then
    d := substr(d, 3);
  elsif d ~ '^0' then
    d := ltrim(d, '0');
    -- 0 + código de operadora (2 dígitos) + DDD + número
    if length(d) in (12, 13) then
      d := substr(d, 3);
    end if;
  end if;
  if length(d) = 10 and substr(d, 3, 1) in ('6', '7', '8', '9') then
    d := substr(d, 1, 2) || '9' || substr(d, 3);
  end if;
  if length(d) not in (10, 11) then
    return null;
  end if;
  if substr(d, 1, 1) = '0' or substr(d, 2, 1) = '0' then
    return null;
  end if;
  if length(d) = 11 and substr(d, 3, 1) <> '9' then
    return null;
  end if;
  return '+55' || d;
end
$$;
