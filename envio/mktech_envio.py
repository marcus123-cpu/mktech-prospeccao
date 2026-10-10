#!/usr/bin/env python3
"""Enviador do envio automático do CRM MKTech (roda no PC do Marcos).

Só usa a biblioteca padrão do Python (funciona no Windows sem instalar nada).
Lê MKTECH_CRM_URL e MKTECH_ENVIO_TOKEN do ambiente ou de um arquivo .env
(caminho em MKTECH_ENVIO_ENV_FILE, ou .env ao lado deste script).

Quem decide o que sai e quando é o servidor do CRM (chave global, pausa,
horário, limite diário, tempo de espera). Este script só:
  1. pergunta a próxima etapa (saudação ou mensagem principal);
  2. confere o texto de novo e entrega ao transporte;
  3. confirma o resultado;
  4. repassa as mensagens recebidas para o CRM classificar.
Ele nunca escreve texto próprio e nunca responde ao cliente.

Transportes:
  simulacao  (padrão) não contata ninguém; grava em envio-simulado.log
  whatsapp   WhatsApp Business Cloud API (oficial) com o número de prospecção.
             A primeira mensagem para quem nunca falou com o número TEM de ser um
             modelo aprovado pela Meta: saudação e texto vão juntos como variáveis
             do modelo, no passo da mensagem (o passo da saudação só guarda a saudação).
             ENVIO_SO_PARA=5517... limita os destinos (use no teste).

Comandos (saída em JSON no stdout; logs no stderr):
  selftest                               verifica URL, token e estado da chave
  rodar [--transporte T] [--uma-vez]     laço de envio (Ctrl+C para parar)
  resposta --telefone N --texto "..."    registra uma mensagem recebida
           [--segundos S] [--tipo audio] (segundos desde a nossa mensagem; tipo)

Códigos de saída: 0 ok · 2 dados inválidos · 5 falha temporária/rede · 6 configuração/token.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import random
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

TIMEOUT_SECONDS = 20
MAX_ATTEMPTS = 4
POLL_SECONDS = 30
MAX_TEXT = 700

EXIT_OK, EXIT_INVALID, EXIT_TEMPORARY, EXIT_CONFIG = 0, 2, 5, 6

# Última barreira antes do cliente: texto com cara de erro ou saída técnica
# do agente nunca é entregue, mesmo que tenha passado pelo servidor.
_TECHNICAL = re.compile(
    r"\berr(o|or)\b|ocorreu um (erro|problema)|exception|traceback|undefined|\bnull\b|\bnan\b|\bjson\b|\bapi\b|"
    r"https?:|\bstatus\b|tente novamente|timeout|\btoken\b|\bprompt\b|como (um )?(modelo|assistente)|"
    r"nao (posso|consigo) (ajudar|gerar|escrever)|\bdesculpe\b|\blead\b|diagnostico|[\[\]{}<>`]|\*\*|\\n"
)


def log(msg: str) -> None:
    token = os.environ.get("MKTECH_ENVIO_TOKEN", "")
    if token:
        msg = msg.replace(token, "mkt_***")
    print(f"[mktech_envio] {msg}", file=sys.stderr, flush=True)


def load_env() -> None:
    env_file = os.environ.get("MKTECH_ENVIO_ENV_FILE") or str(Path(__file__).resolve().parent / ".env")
    path = Path(env_file)
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip().strip('"').strip("'")
        if key.startswith(("MKTECH_CRM_", "MKTECH_ENVIO_")) and key not in os.environ:
            os.environ[key] = value


class ConfigError(Exception):
    pass


def config() -> tuple[str, str]:
    url = os.environ.get("MKTECH_CRM_URL", "").rstrip("/")
    token = os.environ.get("MKTECH_ENVIO_TOKEN", "")
    if not url.startswith(("http://", "https://")):
        raise ConfigError("MKTECH_CRM_URL não configurada (ex.: https://mktech-prospeccao.vercel.app)")
    if not token.startswith("mkt_"):
        raise ConfigError("MKTECH_ENVIO_TOKEN não configurado (crie na tela Envio automático do painel)")
    return url, token


def request(method: str, path: str, body: Any = None) -> tuple[int, dict[str, Any]]:
    """Requisição com timeout e poucas tentativas em falha de rede/429/5xx."""
    url, token = config()
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "User-Agent": "mktech-envio/1.0",
        **({"Content-Type": "application/json"} if data is not None else {}),
    }
    last_error = "falha desconhecida"
    for attempt in range(1, MAX_ATTEMPTS + 1):
        req = urllib.request.Request(url + path, data=data, method=method, headers=headers)
        retry_after = None
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
                return resp.status, json.loads(resp.read().decode("utf-8") or "{}")
        except urllib.error.HTTPError as e:
            payload: dict[str, Any] = {}
            try:
                payload = json.loads(e.read().decode("utf-8") or "{}")
            except (ValueError, OSError):
                pass
            if e.code in (429, 502, 503, 504):
                retry_after = e.headers.get("Retry-After")
                last_error = f"HTTP {e.code}"
            else:
                return e.code, payload
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            last_error = f"rede: {getattr(e, 'reason', e)}"
        if attempt < MAX_ATTEMPTS:
            delay = min(float(retry_after) if retry_after and retry_after.isdigit() else 2 ** attempt, 60)
            log(f"{method} {path}: {last_error}; nova tentativa em {delay:.0f}s")
            time.sleep(delay + random.uniform(0, 0.5))
    return 0, {"status": "falha_temporaria", "errors": [last_error]}


def _plain(text: str) -> str:
    return unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()


def safe_text(text: Any) -> str | None:
    """Devolve o texto se puder ir ao cliente; None se não puder."""
    if not isinstance(text, str):
        return None
    t = text.strip()
    if not t or len(t) > MAX_TEXT or _TECHNICAL.search(_plain(t)):
        return None
    return t


# Transportes ---------------------------------------------------------------


class Transporte:
    nome = "base"

    def enviar(self, telefone: str, texto: str) -> None:  # levanta exceção se falhar
        raise NotImplementedError

    def recebidas(self) -> list[dict[str, Any]]:
        """Mensagens novas recebidas: [{telefone, texto, tipo (texto/audio/imagem/outro), recebida_em}]."""
        return []


class Simulacao(Transporte):
    """Não contata ninguém: só registra o que seria enviado."""

    nome = "simulacao"

    def __init__(self, arquivo: Path | None = None) -> None:
        self.arquivo = arquivo or Path(__file__).resolve().parent / "envio-simulado.log"

    def enviar(self, telefone: str, texto: str) -> None:
        linha = json.dumps(
            {"em": datetime.now(timezone.utc).isoformat(), "telefone": telefone, "texto": texto}, ensure_ascii=False
        )
        with self.arquivo.open("a", encoding="utf-8") as f:
            f.write(linha + "\n")
        log(f"[simulação] para {telefone}: {texto[:80]}")


class WhatsAppNaoConfigurado(Transporte):
    nome = "whatsapp"

    def enviar(self, telefone: str, texto: str) -> None:
        raise RuntimeError("transporte whatsapp ainda não configurado")


def _digits(telefone: str) -> str:
    return re.sub(r"\D", "", telefone or "")


def template_param(text: str) -> str:
    """Variáveis de modelo da Meta não aceitam quebra de linha, tab nem 4+ espaços seguidos."""
    return re.sub(r"\s+", " ", text).strip()


class WhatsAppCloud(Transporte):
    """WhatsApp Business Cloud API. Só envia o modelo aprovado, nunca texto livre.

    Modelo (categoria MARKETING, idioma pt_BR), nome em WHATSAPP_TEMPLATE_NAME:
      MKTech Dev. {{1}} {{2}} Se não quiser receber mais mensagens, responda PARAR.
    {{1}} = saudação por horário, {{2}} = mensagem escrita pelo Hermes.
    """

    nome = "whatsapp"
    MAX_PARAM = 900

    def __init__(self, env: dict[str, str] | None = None) -> None:
        e = env if env is not None else os.environ
        self.phone_id = e.get("WHATSAPP_PHONE_NUMBER_ID", "").strip()
        self.access_token = e.get("WHATSAPP_ACCESS_TOKEN", "").strip()
        self.template = e.get("WHATSAPP_TEMPLATE_NAME", "mktech_primeiro_contato").strip()
        self.lang = e.get("WHATSAPP_TEMPLATE_LANG", "pt_BR").strip()
        self.version = e.get("WHATSAPP_API_VERSION", "v21.0").strip()
        self.base = e.get("WHATSAPP_API_BASE", "https://graph.facebook.com").rstrip("/")
        self.only_to = {_digits(x) for x in e.get("ENVIO_SO_PARA", "").split(",") if _digits(x)}
        if not self.phone_id or not self.access_token:
            raise ConfigError("WHATSAPP_PHONE_NUMBER_ID e WHATSAPP_ACCESS_TOKEN são obrigatórios no .env")
        self.etapa = "mensagem"
        self._saudacao: dict[str, str] = {}

    def _post(self, payload: dict[str, Any]) -> None:
        req = urllib.request.Request(
            f"{self.base}/{self.version}/{self.phone_id}/messages",
            data=json.dumps(payload).encode(),
            method="POST",
            headers={"Authorization": f"Bearer {self.access_token}", "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
                body = json.loads(resp.read() or b"{}")
        except urllib.error.HTTPError as e:
            detail = ""
            with contextlib.suppress(Exception):
                detail = json.loads(e.read()).get("error", {}).get("message", "")
            raise RuntimeError(f"Meta recusou (HTTP {e.code}): {detail}"[:300]) from None
        if not body.get("messages"):
            raise RuntimeError("Meta não confirmou a mensagem")

    def enviar(self, telefone: str, texto: str) -> None:
        fone = _digits(telefone)
        if self.only_to and fone not in self.only_to:
            raise RuntimeError("destino fora de ENVIO_SO_PARA; nada enviado")
        if self.etapa == "saudacao":
            self._saudacao[fone] = template_param(texto)  # sai junto com a mensagem, no modelo
            return
        saudacao = self._saudacao.pop(fone, "Olá! Tudo bem?")
        corpo = template_param(texto)
        if len(saudacao) + len(corpo) > self.MAX_PARAM:
            raise RuntimeError("texto grande demais para o modelo; nada enviado")
        self._post(
            {
                "messaging_product": "whatsapp",
                "to": fone,
                "type": "template",
                "template": {
                    "name": self.template,
                    "language": {"code": self.lang},
                    "components": [
                        {"type": "body", "parameters": [{"type": "text", "text": saudacao}, {"type": "text", "text": corpo}]}
                    ],
                },
            }
        )


def _make_whatsapp() -> Transporte:
    return WhatsAppCloud()


TRANSPORTES: dict[str, Callable[[], Transporte]] = {"simulacao": Simulacao, "whatsapp": _make_whatsapp}


# Laço ------------------------------------------------------------------------


def report(item_id: str, etapa: str, ok: bool, erro: str | None = None) -> dict[str, Any]:
    status, payload = request("POST", f"/api/hermes/v1/envio/{item_id}/resultado", {"etapa": etapa, "ok": ok, "erro": erro})
    if status == 0:
        log(f"não consegui confirmar {etapa} de {item_id}; o servidor marca como falhou e não reenvia")
    return payload


def forward_replies(transporte: Transporte) -> int:
    n = 0
    for msg in transporte.recebidas():
        body = {"telefone": msg["telefone"], "texto": msg.get("texto") or None, "tipo": msg.get("tipo") or "texto"}
        if msg.get("recebida_em"):
            body["recebida_em"] = msg["recebida_em"]
        if msg.get("segundos_desde_envio") is not None:
            body["segundos_desde_envio"] = msg["segundos_desde_envio"]
        status, payload = request("POST", "/api/hermes/v1/envio/respostas", body)
        if payload.get("status") == "registrada":
            quem = "PESSOA" if payload.get("conversa") else "automática"
            log(f"resposta de {msg['telefone']} registrada como {quem}")
        n += 1
    return n


def step(transporte: Transporte) -> tuple[str, float]:
    """Executa uma rodada. Devolve (status, segundos até a próxima)."""
    forward_replies(transporte)
    status, nxt = request("POST", "/api/hermes/v1/envio/proximo", {})
    if status in (401, 403):
        raise ConfigError("token do enviador inválido, revogado ou sem permissão")
    s = nxt.get("status", "falha_temporaria")
    if s != "enviar":
        wait = float(nxt.get("segundos") or POLL_SECONDS) if s == "aguardar" else POLL_SECONDS
        return s, max(1.0, min(wait, POLL_SECONDS))

    item, etapa, telefone = nxt.get("id"), nxt.get("etapa"), nxt.get("telefone")
    texto = safe_text(nxt.get("texto"))
    if not item or etapa not in ("saudacao", "mensagem") or not telefone:
        log(f"resposta inesperada do servidor; nada enviado: {nxt}")
        return "invalido", POLL_SECONDS
    if texto is None:
        report(item, etapa, False, "texto recusado pelo enviador (parece erro ou texto técnico); nada enviado")
        return "recusado", 5.0
    transporte.etapa = etapa  # type: ignore[attr-defined]
    try:
        transporte.enviar(telefone, texto)
    except Exception as e:  # noqa: BLE001 - qualquer falha do transporte vira "falhou"
        report(item, etapa, False, f"{transporte.nome}: {e}"[:400])
        return "falhou", POLL_SECONDS
    report(item, etapa, True)
    return "enviado", 3.0


def cmd_rodar(args: argparse.Namespace) -> int:
    transporte = TRANSPORTES[args.transporte]()
    log(f"enviador iniciado (transporte: {transporte.nome}); Ctrl+C para parar")
    last = None
    try:
        while True:
            s, wait = step(transporte)
            if s != last or s in ("enviado", "falhou", "recusado"):
                log(f"estado: {s}")
                last = s
            if args.uma_vez:
                print(json.dumps({"ok": True, "status": s}, ensure_ascii=False))
                return EXIT_OK
            time.sleep(wait)
    except KeyboardInterrupt:
        log("parado pelo usuário")
        return EXIT_OK


def cmd_selftest(_: argparse.Namespace) -> int:
    status, payload = request("GET", "/api/hermes/v1/envio/estado")
    print(json.dumps({"http": status, **payload}, ensure_ascii=False))
    if status in (401, 403):
        return EXIT_CONFIG
    return EXIT_OK if payload.get("status") == "ok" else EXIT_TEMPORARY


def cmd_resposta(args: argparse.Namespace) -> int:
    body: dict[str, Any] = {"telefone": args.telefone, "texto": args.texto or None, "tipo": args.tipo}
    if args.segundos is not None:
        body["segundos_desde_envio"] = args.segundos
    status, payload = request("POST", "/api/hermes/v1/envio/respostas", body)
    print(json.dumps({"http": status, **payload}, ensure_ascii=False))
    if status == 0:
        return EXIT_TEMPORARY
    return EXIT_INVALID if status >= 400 else EXIT_OK


def main(argv: list[str] | None = None) -> int:
    load_env()
    p = argparse.ArgumentParser(description="Enviador do envio automático do CRM MKTech")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("selftest").set_defaults(fn=cmd_selftest)
    r = sub.add_parser("rodar")
    r.add_argument("--transporte", choices=sorted(TRANSPORTES), default="simulacao")
    r.add_argument("--uma-vez", action="store_true", help="faz uma rodada e sai (para testes)")
    r.set_defaults(fn=cmd_rodar)
    a = sub.add_parser("resposta")
    a.add_argument("--telefone", required=True)
    a.add_argument("--texto")
    a.add_argument("--tipo", choices=["texto", "audio", "imagem", "outro"], default="texto")
    a.add_argument("--segundos", type=float)
    a.set_defaults(fn=cmd_resposta)
    args = p.parse_args(argv)
    try:
        return args.fn(args)
    except ConfigError as e:
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False))
        log(str(e))
        return EXIT_CONFIG


if __name__ == "__main__":
    sys.exit(main())
