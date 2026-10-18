#!/usr/bin/env python3
"""Inspeção real da presença digital de um lead com Playwright (Chromium).

Abre o Instagram e o Facebook públicos, o link da bio e procura site próprio.
Não faz login, não segue, não curte, não comenta e não envia nada: só lê o que
qualquer visitante vê. Devolve JSON com evidências prontas para o candidato e
uma nota determinística focada na dor: lead SEM site/landing é o alvo.

Uso:
  python inspecionar_presenca.py --nome "Nice Leal Estética" --cidade Votuporanga \
      --instagram draniceleal [--facebook URL] [--site URL] [--telefone 5517...] [--servicos 3]
Requer: pip install playwright && python -m playwright install chromium
"""
import argparse
import json
import re
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlparse
# Alguns lotes carregam este arquivo por runpy/importlib a partir de outra pasta.
# Resolva o módulo auxiliar pela localização da skill, não pelo diretório atual.
_scripts = str(Path(__file__).resolve().parent)
if _scripts not in sys.path:
    sys.path.insert(0, _scripts)
from presenca_links import (classificar_pagina, dominio, pertence, url_publica,
                           tipo_destino, links_para_conferir, resumir_presenca, WHATSAPP)

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/124.0 Safari/537.36")
# Filtro de busca nominal; plataformas de páginas/links são lidas pelo conteúdo.
DIRETORIOS = ("microsoft.com", "instagram.com", "facebook.com", "fb.com", "google.", "doctoralia", "guiamais", "apontador", "tripadvisor",
              "yelp", "telelistas", "magicpin", "olx.", "mercadolivre", "youtube.com", "tiktok.com", "linkedin.com",
              "twitter.com", "x.com", "pinterest", "waze", "ifood", "reclameaqui", "cylex", "solutudo", "econodata",
              "cnpj", "casadosdados", "wikipedia", "bing.com", "duckduckgo", "booksy", "trinks", "salaovip", "cnpja")


def norm(s):
    s = unicodedata.normalize("NFD", s or "")
    return re.sub(r"[^a-z0-9 ]", " ", "".join(c for c in s if unicodedata.category(c) != "Mn").lower()).strip()


def agora():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def numero(txt):
    """'1,2 mil' / '268M' / '12.345' -> inteiro."""
    t = (txt or "").lower().replace("\xa0", " ").strip()
    m = re.match(r"([\d.,]+)\s*(mil|k|mi|m)?", t)
    if not m:
        return None
    raw, suf = m.group(1), m.group(2)
    if suf:
        v = float(raw.replace(".", "").replace(",", ".")) if "," in raw else float(raw)
        return int(v * (1000 if suf in ("mil", "k") else 1_000_000))
    return int(re.sub(r"[.,]", "", raw) or 0)


def meta(page, prop):
    el = page.query_selector(f'meta[property="{prop}"],meta[name="{prop}"]')
    return (el.get_attribute("content") or "") if el else ""


def abrir(page, url, espera=2500):
    try:
        resp = page.goto(url, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(espera)
        return resp.status if resp else 0
    except Exception:
        return 0


def instagram(page, handle):
    handle = (handle or "").lstrip("@").strip().strip("/")
    out = {"handle": handle, "status": "nao_informado"}
    if not handle:
        return out
    url = f"https://www.instagram.com/{handle}/"
    abrir(page, url, 3500)
    corpo = page.inner_text("body")[:4000] if page.query_selector("body") else ""
    out["url"] = url
    low = norm(corpo)
    if "nao esta disponivel" in low or "not available" in low or "pagina nao encontrada" in low:
        out["status"] = "indisponivel"  # perfil inexistente/removido: handle provavelmente errado
        return out
    desc = meta(page, "og:description")
    m = re.match(r"\s*([\d.,]+\s*(?:mil|mi|[kKmM])?)\s+seguidores?,\s*seguindo\s+([\d.,]+\s*(?:mil|mi|[kKmM])?),\s*([\d.,]+\s*(?:mil|mi|[kKmM])?)\s+posts?", desc, re.I) \
        or re.match(r"\s*([\d.,]+\s*(?:[kKmM])?)\s+followers?,\s*([\d.,]+\s*(?:[kKmM])?)\s+following,\s*([\d.,]+\s*(?:[kKmM])?)\s+posts?", desc, re.I)
    if m:
        out.update(status="ok", seguidores=numero(m.group(1)), seguindo=numero(m.group(2)), posts=numero(m.group(3)))
    elif "entrar" in low and ("seguidores" in low or "followers" in low):
        out["status"] = "ok"
    else:
        out["status"] = "bloqueado_login"
    header = page.query_selector("main header")
    bio = header.inner_text() if header else desc
    out["bio_texto"] = bio[:2000]
    # Texto truncado ou links adicionais ocultos não comprovam ausência de página.
    out["bio_verificada"] = bool(header and bio.strip() and out["status"] == "ok" and not re.search(r"(?:\.\.\.|…|mostrar mais|show more|e mais \d|e outros|and \d more)", bio, re.I))
    links = []
    for a in page.query_selector_all("header a[href], main a[href]"):
        href = a.get_attribute("href") or ""
        if "l.instagram.com/?u=" in href:
            href = parse_qs(urlparse(href).query).get("u", [""])[0]
        if url_publica(href) and not pertence(dominio(href), ("instagram.com",)):
            links.append(href)  # Preserve query strings: they can identify a personalized page.
    out["links_bio"] = list(dict.fromkeys(links))[:8]
    if len(set(links)) > 8:
        out["bio_verificada"] = False
    # Última publicação visível sem login (quando o Instagram entrega as miniaturas)
    datas = [d for t in page.query_selector_all("time[datetime]") if (d := t.get_attribute("datetime"))]
    if datas:
        out["ultima_publicacao"] = max(d for d in datas if d)[:10]
    return out


def facebook(page, url):
    out = {"status": "nao_informado"}
    if not url:
        return out
    out["url"] = url
    abrir(page, url, 3000)
    low = norm(page.inner_text("body")[:2500]) if page.query_selector("body") else ""
    if "conteudo nao esta disponivel" in low or "pagina nao encontrada" in low or "this content isn" in low:
        out["status"] = "indisponivel"
        return out
    out["titulo"] = (page.title() or "")[:120]
    desc = meta(page, "og:description")
    out["descricao"] = desc[:300]
    m = re.search(r"([\d.,]+\s*(?:mil|[kKmM])?)\s+(?:curtidas|likes|seguidores|followers)", desc + " " + low, re.I)
    if m:
        out["curtidas_ou_seguidores"] = numero(m.group(1))
    out["status"] = "ok" if (desc or out["titulo"] not in ("", "Facebook")) else "bloqueado_login"
    return out


def link_externo(page, url, nome="", telefone="", instagram=""):
    """Lê a página final após redirecionamentos e confirma conteúdo e identidade."""
    try:
        return ler_link_externo(page, url, nome, telefone, instagram)
    except Exception:
        return {"url": url, "url_final": url, "dominio": dominio(url), "tipo": "verificacao_pendente",
                "motivo": "Falha ao ler o conteúdo da página. Confira manualmente; não foi confirmada ausência de página personalizada."}


def ler_link_externo(page, url, nome="", telefone="", instagram=""):
    base = {"url": url, "dominio": dominio(url), "url_final": url}
    if not url_publica(url):
        return {**base, "tipo": "verificacao_pendente", "motivo": "Endereço não é uma página pública HTTP(S)."}
    direto = tipo_destino(url)
    if direto:
        return {**base, "tipo": direto, "motivo": "Destino direto identificado pelo domínio; não foi aberto nem contatado."}
    status = abrir(page, url, 2000)
    final = page.url
    base.update(url_final=final, dominio=dominio(final))
    direto = tipo_destino(final)
    if direto:
        return {**base, "tipo": direto, "motivo": "Redirecionamento para canal social ou WhatsApp; nenhum contato realizado."}
    if not status or status >= 400:
        return {**base, "tipo": "verificacao_pendente", "http": status, "motivo": "Página não abriu; não é possível concluir existência nem ausência de página personalizada."}
    titulo = (page.title() or "")[:120]
    texto = page.inner_text("body")[:16000] if page.query_selector("body") else ""
    paragrafos = [p.inner_text()[:2000] for p in page.query_selector_all("main p, article p, section p, p")[:60]]
    from urllib.parse import urljoin
    links = [urljoin(final, a.get_attribute("href") or "") for a in page.query_selector_all("a[href]")[:100]]
    resultado = classificar_pagina(final, titulo, texto, paragrafos, links, nome, telefone, instagram)
    destinos = links_para_conferir(links, final, limite=5)
    return {**base, **resultado, "http": status, "titulo": titulo, "links_encontrados": destinos[:4], "links_limitados": len(destinos) > 4,
            "tem_https": final.startswith("https://"), "tamanho_texto": len(texto)}


def resolver_bing(href):
    """Bing às vezes devolve link de rastreio (bing.com/ck/a?...&u=a1<base64>)."""
    if "bing.com/ck/" in href:
        u = parse_qs(urlparse(href).query).get("u", [""])[0]
        if u.startswith("a1"):
            import base64
            try:
                return base64.urlsafe_b64decode(u[2:] + "=" * (-len(u[2:]) % 4)).decode()
            except Exception:
                return ""
    return href


def buscar_site(page, nome, cidade):
    """Procura site próprio no Bing e confere se o domínio é do negócio.
    Devolve (links, busca_funcionou). Se a busca não abriu, NÃO se conclui 'sem site'."""
    nucleo = [w for w in norm(nome).split() if len(w) > 2 and w not in ("estetica", "clinica", "studio", "espaco", "centro", "dra", "dr")]
    achados, funcionou = [], False
    for q in (f'"{nome}" {cidade}', f"{nome} {cidade} site oficial"):
        if not abrir(page, f"https://www.bing.com/search?q={q.replace(' ', '+')}&setlang=pt-BR", 1500):
            continue
        links = page.query_selector_all("li.b_algo h2 a")
        funcionou = funcionou or len(links) > 0
        for a in links:
            href = resolver_bing(a.get_attribute("href") or "")
            host = urlparse(href).netloc.lower().replace("www.", "")
            if not host or any(d in host for d in DIRETORIOS) or tipo_destino(href):
                continue
            if nucleo and not any(w in norm(host) or w in norm(a.inner_text()) for w in nucleo[:3]):
                continue
            achados.append(href)
        if achados:
            break
    return list(dict.fromkeys(achados))[:3], funcionou


def pontuar(r, servicos, tem_contato):
    """Nota 0-100 voltada para a dor: sem site/landing próprio é o alvo."""
    site = r["site"]
    ig, fb = r["instagram"], r["facebook"]
    redes_ok = ig.get("status") == "ok" or fb.get("status") == "ok"
    # Lacuna digital (até 50)
    if site["situacao"] == "sem_site":
        lacuna = 50 if redes_ok else 35  # sem confirmar a rede, a dor existe mas a prova é menor
    elif site["situacao"] in ("so_agregador", "so_agendamento", "so_whatsapp"):
        lacuna = 45
    elif site["situacao"] in ("site_fraco", "site_fora_do_ar"):
        lacuna = 25
    else:
        lacuna = 0
    posts = ig.get("posts") or 0
    atividade = 20 if posts >= 30 else 14 if posts >= 10 else 8 if posts >= 1 else (6 if fb.get("status") == "ok" else 0)
    if ig.get("ultima_publicacao"):
        try:
            dias = (datetime.now(timezone.utc) - datetime.fromisoformat(ig["ultima_publicacao"] + "T00:00:00+00:00")).days
            atividade = min(20, atividade + (4 if dias <= 30 else 0)) if dias <= 180 else 0
        except ValueError:
            pass
    seg = ig.get("seguidores") or fb.get("curtidas_ou_seguidores") or 0
    demanda = 15 if seg >= 5000 else 11 if seg >= 1000 else 7 if seg >= 300 else 3 if seg > 0 else 0
    potencial = (8 if tem_contato else 0) + (7 if servicos >= 2 else 3 if servicos == 1 else 0)
    comp = {"lacuna_digital": lacuna, "atividade": atividade, "demanda": demanda, "potencial_comercial": potencial}
    fontes = sum(1 for s in (ig, fb) if s.get("status") == "ok") + (1 if site["situacao"] != "nao_verificado" else 0)
    return comp, sum(comp.values()), ("alta" if fontes >= 3 else "media" if fontes == 2 else "baixa")


def inspecionar(a):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(locale="pt-BR", user_agent=UA, viewport={"width": 1280, "height": 900})
        # Read public pages only; never load a WhatsApp conversation, including redirects.
        ctx.route("**/*", lambda route: route.abort() if pertence(dominio(route.request.url), WHATSAPP) or not url_publica(route.request.url) else route.continue_())
        page = ctx.new_page()
        try:
            ig = instagram(page, a.instagram)
        except Exception:
            ig = {"handle": a.instagram, "status": "erro_leitura", "bio_verificada": False}
        try:
            fb = facebook(page, a.facebook)
        except Exception:
            fb = {"status": "erro_leitura"}
        site = {"situacao": "nao_verificado", "detalhe": []}
        candidatos = [a.site] if a.site else []
        candidatos += [u for u in ig.get("links_bio", [])]
        achados_busca, busca_ok = [], False
        visitados = set()
        def conferir(u, origem):
            if u in visitados:
                return
            if len(visitados) >= 16:
                site["detalhe"].append({"url": u, "url_final": u, "dominio": dominio(u), "tipo": "verificacao_pendente", "origem": origem, "motivo": "Limite de páginas da inspeção atingido; conferir o destino restante."})
                return
            visitados.add(u)
            info = link_externo(page, u, a.nome, a.telefone, a.instagram)
            site["detalhe"].append({**info, "origem": origem})
            if info["tipo"] in ("agregador_links", "verificacao_pendente"):
                if info.get("links_limitados"):
                    site["detalhe"].append({**info, "tipo": "verificacao_pendente", "motivo": "Há mais de quatro destinos na página de links; a conferência dos demais está pendente."})
                for filho in info.get("links_encontrados", [])[:4]:
                    if filho in visitados:
                        continue
                    if len(visitados) >= 16:
                        site["detalhe"].append({**info, "tipo": "verificacao_pendente", "motivo": "Limite de páginas atingido; ainda há destinos para conferir."})
                        break
                    visitados.add(filho)
                    detalhe = link_externo(page, filho, a.nome, a.telefone, a.instagram)
                    site["detalhe"].append({**detalhe, "origem": origem + "_link", "pagina_origem": info["url_final"]})
                    if detalhe.get("links_encontrados") and detalhe["tipo"] in ("agregador_links", "verificacao_pendente"):
                        site["detalhe"].append({**detalhe, "tipo": "verificacao_pendente", "motivo": "Outro intermediário de links encontrado; conferir os destinos adicionais manualmente."})
        for u in candidatos:
            conferir(u, "bio" if u in ig.get("links_bio", []) else "informado")
        if not any(d["tipo"] == "pagina_personalizada" for d in site["detalhe"]):
            try:
                achados_busca, busca_ok = buscar_site(page, a.nome, a.cidade)
            except Exception:
                achados_busca, busca_ok = [], False
            for u in achados_busca[:2]:
                conferir(u, "busca")
        site["situacao"], site["grupo"] = resumir_presenca(site["detalhe"], ig.get("bio_verificada", False), busca_ok)
        site["busca_funcionou"] = busca_ok
        browser.close()
    r = {"nome": a.nome, "cidade": a.cidade, "verificado_em": agora(), "instagram": ig, "facebook": fb, "site": site}
    comp, nota, conf = pontuar(r, a.servicos, bool(a.telefone))
    r["nota_sugerida"], r["componentes"], r["confianca"] = nota, comp, conf
    r["site_status_sugerido"] = {"site_proprio": "site_proprio_encontrado", "site_fraco": "site_proprio_encontrado",
                                 "site_fora_do_ar": "site_proprio_encontrado", "so_agregador": "apenas_redes_sociais",
                                 "so_whatsapp": "apenas_redes_sociais", "so_agendamento": "apenas_redes_sociais",
                                 "sem_site": "apenas_redes_sociais" if (ig.get("status") == "ok" or fb.get("status") == "ok") else "site_nao_localizado",
                                 "nao_verificado": "verificacao_pendente"}[site["situacao"]]
    r["pending_items"] = []
    if not ig.get("bio_verificada"):
        r["pending_items"].append("Conferir bio completa e todos os links do Instagram; acesso não confirmado ou texto truncado.")
    if site["situacao"] == "nao_verificado":
        r["pending_items"].append("Confirmar presença de página personalizada; não concluir ausência de site com as evidências atuais.")
    for d in site["detalhe"]:
        if d["tipo"] == "verificacao_pendente":
            r["pending_items"].append(d["url"] + ": " + d.get("motivo", "Conferência pendente."))
    pendencias = list(dict.fromkeys(r["pending_items"]))
    r["pending_items"] = []
    omitidas = 0
    for pendencia in pendencias:
        item = pendencia[:450]
        if sum(len(p) + 3 for p in r["pending_items"]) + len(item) <= 1800:
            r["pending_items"].append(item)
        else:
            omitidas += 1
    if omitidas:
        r["pending_items"].append(f"Há mais {omitidas} pendência(s) na inspeção completa; consultar site.detalhe antes de concluir ausência de página.")
    r["evidencias"] = evidencias(r)
    r["avisos"] = [m for m in (
        "Verificação inconclusiva da bio, do destino ou da busca: NÃO afirme que não há página personalizada; confira as pendências." if site["situacao"] == "nao_verificado" else None,
        "Instagram não abriu sem login ou não pôde ser lido: confira o @ e use outra fonte para atividade." if ig.get("status") in ("indisponivel", "bloqueado_login", "erro_leitura") and a.instagram else None,
        "Última publicação não apareceu sem login: não afirme atividade recente sem outra fonte." if ig.get("status") == "ok" and not ig.get("ultima_publicacao") else None,
    ) if m]
    return r


def evidencias(r):
    ev, ts = [], r["verificado_em"]
    ig, fb, site = r["instagram"], r["facebook"], r["site"]
    if ig.get("status") == "ok":
        partes = [f"Instagram @{ig['handle']} aberto sem login"]
        if ig.get("seguidores") is not None:
            partes.append(f"{ig['seguidores']} seguidores, {ig.get('posts', 0)} publicações")
        if ig.get("ultima_publicacao"):
            partes.append(f"Publicação em {ig['ultima_publicacao']}")
        if ig.get("links_bio"):
            partes.append("link da bio: " + ", ".join(ig["links_bio"][:2]))
        else:
            partes.append("nenhum link capturado na visualização disponível; isso não comprova ausência de página")
        item = {"kind": "instagram", "url": ig["url"], "summary": "; ".join(partes), "observed_at": ts}
        if not ig.get("bio_verificada"):
            item["limitation"] = "Bio completa e todos os links não foram confirmados."
        ev.append(item)
    if fb.get("status") == "ok":
        ev.append({"kind": "busca", "url": fb["url"], "summary": f"Facebook aberto sem login: {fb.get('titulo', '')}; {fb.get('descricao', '')}".strip()[:300], "observed_at": ts})
    for d in sorted(site["detalhe"], key=lambda d: d["tipo"] != "pagina_personalizada"):
        txt = {"pagina_personalizada": "página personalizada do negócio, com apresentação e serviços",
               "agregador_links": "lista de links/botões; não foi comprovada página personalizada neste endereço",
               "agendamento": "perfil em plataforma de agendamento", "whatsapp_direto": "link direto de WhatsApp, sem contato realizado",
               "rede_social": "link para rede social", "verificacao_pendente": "verificação pendente"}.get(d["tipo"], d["tipo"])
        resumo = f"Link {d['dominio']}: {txt}. {d.get('motivo', '')}"
        if d.get("sinais_identidade"):
            resumo += " Vínculo: " + ", ".join(d["sinais_identidade"]) + "."
        if d.get("trecho"):
            resumo += " Conteúdo observado: " + d["trecho"][:350]
        item = {"kind": "outro", "url": d.get("url_final", d["url"]), "summary": resumo, "observed_at": ts}
        if d["tipo"] == "verificacao_pendente":
            item["limitation"] = d.get("motivo", "Conferência inconclusiva.")
        ev.append(item)
    if site["situacao"] == "sem_site":
        ev.append({"kind": "busca", "url": "https://www.bing.com/search?q=" + (r["nome"] + " " + r["cidade"]).replace(" ", "+"),
                   "summary": f"Busca por '{r['nome']} {r['cidade']}' e conferência da bio: nenhuma página personalizada localizada nas fontes consultadas", "observed_at": ts,
                   "limitation": "Busca negativa não comprova inexistência de página não indexada ou publicada depois da inspeção."})
    # O CRM aceita até 20 evidências; todos os detalhes e pendências permanecem
    # no resultado completo. Páginas confirmadas têm prioridade na seleção.
    return ev[:20]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--nome", required=True)
    ap.add_argument("--cidade", required=True)
    ap.add_argument("--instagram", default="")
    ap.add_argument("--facebook", default="")
    ap.add_argument("--site", default="")
    ap.add_argument("--telefone", default="")
    ap.add_argument("--servicos", type=int, default=0, help="quantidade de serviços encontrados")
    a = ap.parse_args()
    try:
        r = inspecionar(a)
    except ImportError:
        print(json.dumps({"erro": "Instale: pip install playwright && python -m playwright install chromium"}, ensure_ascii=False))
        sys.exit(2)
    print(json.dumps(r, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
