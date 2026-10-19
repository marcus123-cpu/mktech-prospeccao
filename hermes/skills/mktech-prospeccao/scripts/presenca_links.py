"""Classificação conservadora da página pública: conteúdo e identidade, não domínio."""
import ipaddress
import re
import unicodedata
from urllib.parse import urlparse, urljoin

HUBS = ("linktr.ee", "beacons.ai", "bio.link", "campsite.bio", "lnk.bio", "taplink.cc", "allmylinks.com", "solo.to", "msha.ke", "bento.me", "linklist.bio", "abre.bio")
AGENDAS = ("booksy.com", "trinks.com", "salaovip.com.br", "calendly.com", "agendadigital.com.br")
WHATSAPP = ("wa.me", "whatsapp.com")
SOCIAIS = ("instagram.com", "facebook.com", "fb.com", "youtube.com", "youtu.be", "tiktok.com", "x.com", "twitter.com", "t.me")
HOSPEDAGENS = ("wixsite.com", "wordpress.com", "webflow.io", "my.canva.site", "canva.site", "carrd.co", "notion.site", "sites.google.com", "godaddysites.com")


def normalizar(texto):
    return re.sub(r"[^a-z0-9]+", " ", "".join(c for c in unicodedata.normalize("NFD", texto or "").lower() if unicodedata.category(c) != "Mn")).strip()


def dominio(url):
    try:
        return (urlparse(url).hostname or "").lower().rstrip(".")
    except ValueError:
        return ""


def pertence(host, dominios):
    return any(host == d or host.endswith("." + d) for d in dominios)


def url_publica(url):
    try:
        p = urlparse(url)
        host = dominio(url)
        if p.scheme not in ("http", "https") or not host or p.username or p.password:
            return False
        if host == "localhost" or host.endswith((".localhost", ".local", ".internal")) or "." not in host:
            return False
        try:
            return ipaddress.ip_address(host).is_global
        except ValueError:
            return True
    except ValueError:
        return False


def tipo_destino(url):
    host = dominio(url)
    # Só WhatsApp (ou o Threads do próprio perfil) na bio não é site: o negócio continua sem página própria.
    if pertence(host, WHATSAPP) or pertence(host, ("threads.com", "threads.net")):
        return "whatsapp_direto"
    if pertence(host, SOCIAIS):
        return "rede_social"
    return None


def identificar(texto, nome, telefone="", instagram=""):
    """Cidade ou domínio parecido, isoladamente, não comprovam identidade."""
    texto_norm = normalizar(texto)
    sinais = []
    tel = re.sub(r"\D", "", telefone)
    # Compare telefones completos; evite unir números não relacionados do corpo.
    if len(tel) >= 10:
        numeros = [re.sub(r"\D", "", n) for n in re.findall(r"\+?\d[\d\s().-]{8,22}\d", texto)]
        local = tel[2:] if tel.startswith("55") and len(tel) in (12, 13) else tel
        if any(n == tel or n == local or (n.startswith("55") and n[2:] == local) for n in numeros):
            sinais.append("telefone comercial coincidente")
    handle = instagram.strip().lstrip("@").lower()
    if handle and re.search(r"(?:@|instagram\.com/)" + re.escape(handle) + r"(?![a-z0-9_.])", texto, re.I):
        sinais.append("Instagram coincidente")
    genericos = {"clinica", "studio", "estudio", "espaco", "centro", "estetica", "massoterapia", "massagem", "terapias", "integrativas", "salao", "beleza", "dra", "dr", "de", "da", "do", "e", "corporais", "terapeuta", "massoterapeuta"}
    palavras = [p for p in normalizar(nome).split() if len(p) > 2 and p not in genericos]
    # Um nome curto/comum exige confirmação adicional pelo telefone ou Instagram.
    if len(palavras) >= 2 and all(re.search(r"\b" + re.escape(p) + r"\b", texto_norm) for p in palavras):
        sinais.append("nome do negócio coincidente")
    return sinais


def classificar_pagina(url, titulo, texto, paragrafos, links, nome, telefone="", instagram=""):
    """Links de agenda e hubs só são reconhecidos após leitura e vínculo com o lead."""
    host = dominio(url)
    sinais = identificar(titulo + "\n" + texto + "\n" + "\n".join(links), nome, telefone, instagram)
    resultado = {"tipo": "verificacao_pendente", "identidade_confirmada": bool(sinais), "sinais_identidade": sinais,
                 "hospedagem_terceiros": pertence(host, HOSPEDAGENS), "trecho": texto[:500]}
    if not sinais:
        return {**resultado, "motivo": "Não foi possível vincular a página ao negócio por nome, telefone ou Instagram."}
    t = normalizar(texto)
    if any(phrase in t for phrase in ("verify you are human", "verifique que voce e humano", "access denied", "checking your browser", "just a moment", "pagina nao encontrada", "site em construcao", "domain for sale")):
        return {**resultado, "motivo": "Página bloqueada, indisponível ou sem conteúdo verificável."}
    padrao_servicos = r"\b(servicos|tratamentos|procedimentos|massagem|massoterapia|terapias|portfolio|produtos|cursos|atendimento|especialidades|manicure|cabeleireir[ao]|psicoterapia|consultas|oferecemos)\b"
    servicos = bool(re.search(padrao_servicos, t))
    apresentacao = bool(re.search(r"\b(sobre mim|sobre nos|sobre meu trabalho|quem somos|experiencia|formacao|especialista|especializada|especializado|nossa historia|meu trabalho|beneficios)\b", t))
    conteudo = any(len(p.strip()) >= 100 and re.search(padrao_servicos, normalizar(p)) for p in paragrafos) or (not paragrafos and len(texto.strip()) >= 600 and apresentacao)
    # Uma landing page curta pode ser personalizada; número de links não define qualidade.
    if servicos and conteudo and (apresentacao or len(texto.strip()) >= 600):
        return {**resultado, "tipo": "pagina_personalizada", "motivo": "Identidade confirmada e conteúdo de apresentação dos serviços, além de botões de links."}
    if pertence(host, AGENDAS):
        return {**resultado, "tipo": "agendamento", "motivo": "Perfil do negócio em plataforma de agendamento; página personalizada não comprovada."}
    externos = [u for u in links if url_publica(u) and dominio(u) != host]
    if pertence(host, HUBS) or (len(externos) >= 2 and not conteudo and len(texto) < 1200):
        return {**resultado, "tipo": "agregador_links", "motivo": "Lista de links/botões identificada, sem apresentação suficiente para confirmar página personalizada."}
    return {**resultado, "motivo": "Identidade confirmada, mas conteúdo insuficiente para classificar como página personalizada ou lista de links."}


def links_para_conferir(links, origem, limite=4):
    """Abre destinos de um hub para não ignorar um site escondido atrás de botões."""
    resultado = []
    for href in links:
        url = urljoin(origem, href)
        if not url_publica(url) or tipo_destino(url) or dominio(url) == dominio(origem):
            continue
        if url not in resultado:
            resultado.append(url)
    return resultado[:limite]


def resumir_presenca(detalhes, bio_verificada, busca_ok):
    tipos = {d["tipo"] for d in detalhes}
    if "pagina_personalizada" in tipos:
        return "site_proprio", "tem_pagina_personalizada"
    if not bio_verificada or not busca_ok or "verificacao_pendente" in tipos or "rede_social" in tipos:
        return "nao_verificado", "precisa_conferir"
    if "agregador_links" in tipos:
        return "so_agregador", "so_links_ou_whatsapp"
    if "agendamento" in tipos:
        return "so_agendamento", "so_agendamento"
    if "whatsapp_direto" in tipos:
        return "so_whatsapp", "so_links_ou_whatsapp"
    return "sem_site", "nenhuma_pagina_localizada"
