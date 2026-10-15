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
from urllib.parse import parse_qs, unquote, urlparse

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/124.0 Safari/537.36")
# Agregadores de link, redes e diretórios: nunca contam como site próprio.
AGREGADORES = ("linktr.ee", "linktree", "beacons.ai", "bio.link", "campsite.bio", "lnk.bio", "taplink", "allmylinks",
               "linkin.bio", "solo.to", "msha.ke", "hotmart", "wa.me", "whatsapp.com", "api.whatsapp", "bit.ly", "tinyurl")
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
    # Bio: texto entre o nome e o botão "Mostrar mais"/links
    bio = re.split(r"\n", corpo)
    out["bio_texto"] = " | ".join(x.strip() for x in bio[3:12] if x.strip())[:400]
    links = []
    for a in page.query_selector_all("header a[href], main a[href]"):
        href = a.get_attribute("href") or ""
        if "l.instagram.com/?u=" in href:
            href = unquote(parse_qs(urlparse(href).query).get("u", [""])[0])
        if href.startswith("http") and "instagram.com" not in href:
            links.append(href.split("?")[0] if "wa.me" not in href else href)
    out["links_bio"] = list(dict.fromkeys(links))[:5]
    # Última publicação visível sem login (quando o Instagram entrega as miniaturas)
    datas = [t.get_attribute("datetime") for t in page.query_selector_all("time[datetime]")]
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


def link_externo(page, url):
    """Abre o link da bio/site e diz se parece site próprio de verdade."""
    host = urlparse(url).netloc.lower().replace("www.", "")
    base = {"url": url, "dominio": host}
    if any(a in host or a in url.lower() for a in AGREGADORES):
        return {**base, "tipo": "agregador_links"}
    status = abrir(page, url, 2000)
    if not status or status >= 400:
        return {**base, "tipo": "site_fora_do_ar", "http": status}
    titulo = (page.title() or "")[:120]
    texto = norm(page.inner_text("body")[:6000]) if page.query_selector("body") else ""
    paginas = len(page.query_selector_all("a[href]"))
    fraco = len(texto) < 400 or paginas < 4
    return {**base, "tipo": "site_fraco" if fraco else "site_proprio", "http": status, "titulo": titulo,
            "tem_https": url.startswith("https://"), "tamanho_texto": len(texto), "links_internos": paginas}


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
            if not host or any(d in host for d in DIRETORIOS + AGREGADORES):
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
    elif site["situacao"] == "so_agregador":
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
        page = ctx.new_page()
        ig = instagram(page, a.instagram)
        fb = facebook(page, a.facebook)
        site = {"situacao": "nao_verificado", "detalhe": []}
        candidatos = [a.site] if a.site else []
        candidatos += [u for u in ig.get("links_bio", [])]
        achados_busca, busca_ok = [], True
        for u in candidatos:
            info = link_externo(page, u)
            site["detalhe"].append(info)
        if not any(d["tipo"] in ("site_proprio", "site_fraco", "site_fora_do_ar") for d in site["detalhe"]):
            achados_busca, busca_ok = buscar_site(page, a.nome, a.cidade)
            for u in achados_busca[:2]:
                info = link_externo(page, u)
                # Domínio parecido não basta: a página precisa citar a cidade, o telefone ou o @ do negócio.
                if info["tipo"] in ("site_proprio", "site_fraco"):
                    texto = norm(page.inner_text("body")[:20000])
                    digitos = re.sub(r"\D", "", a.telefone)[-8:]
                    brutos = re.sub(r"\D", "", page.inner_text("body")[:20000])
                    if not (norm(a.cidade) in texto or (digitos and digitos in brutos) or (a.instagram and norm(a.instagram.lstrip("@")) in texto)):
                        continue
                site["detalhe"].append({**info, "origem": "busca"})
        tipos = [d["tipo"] for d in site["detalhe"]]
        if "site_proprio" in tipos:
            site["situacao"] = "site_proprio"
        elif "site_fraco" in tipos:
            site["situacao"] = "site_fraco"
        elif "site_fora_do_ar" in tipos:
            site["situacao"] = "site_fora_do_ar"
        elif "agregador_links" in tipos:
            site["situacao"] = "so_agregador"
        elif busca_ok:
            site["situacao"] = "sem_site"
        browser.close()
    r = {"nome": a.nome, "cidade": a.cidade, "verificado_em": agora(), "instagram": ig, "facebook": fb, "site": site}
    comp, nota, conf = pontuar(r, a.servicos, bool(a.telefone))
    r["nota_sugerida"], r["componentes"], r["confianca"] = nota, comp, conf
    r["site_status_sugerido"] = {"site_proprio": "site_proprio_encontrado", "site_fraco": "site_proprio_encontrado",
                                 "site_fora_do_ar": "site_proprio_encontrado", "so_agregador": "apenas_redes_sociais",
                                 "sem_site": "apenas_redes_sociais" if (ig.get("status") == "ok" or fb.get("status") == "ok") else "site_nao_localizado",
                                 "nao_verificado": "site_nao_localizado"}[site["situacao"]]
    r["evidencias"] = evidencias(r)
    r["avisos"] = [m for m in (
        "A busca na web não respondeu: NÃO afirme que não há site; tente de novo ou pesquise manualmente." if site["situacao"] == "nao_verificado" else None,
        "Instagram não abriu sem login (perfil restrito ou @ errado): confira o @ e use outra fonte para atividade." if ig.get("status") in ("indisponivel", "bloqueado_login") and a.instagram else None,
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
            partes.append("sem link de site na bio")
        ev.append({"kind": "instagram", "url": ig["url"], "summary": "; ".join(partes), "observed_at": ts})
    if fb.get("status") == "ok":
        ev.append({"kind": "busca", "url": fb["url"], "summary": f"Facebook aberto sem login: {fb.get('titulo', '')}; {fb.get('descricao', '')}".strip()[:300], "observed_at": ts})
    for d in site["detalhe"]:
        txt = {"agregador_links": "agregador de links (não é site próprio)", "site_proprio": "site próprio no ar",
               "site_fraco": "página muito simples, sem conteúdo suficiente", "site_fora_do_ar": f"endereço não abre (HTTP {d.get('http')})"}[d["tipo"]]
        ev.append({"kind": "site" if d["tipo"].startswith("site") else "busca", "url": d["url"], "summary": f"Link {d['dominio']}: {txt}", "observed_at": ts})
    if site["situacao"] == "sem_site":
        ev.append({"kind": "busca", "url": "https://www.bing.com/search?q=" + (r["nome"] + " " + r["cidade"]).replace(" ", "+"),
                   "summary": f"Busca por '{r['nome']} {r['cidade']}' e conferência do link da bio: nenhum site ou landing page próprio localizado", "observed_at": ts})
    return ev


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
