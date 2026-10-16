#!/usr/bin/env python3
"""Enviador do envio automático do CRM MKTech (roda no PC do Marcos).

Só usa a biblioteca padrão do Python (funciona no Windows sem instalar nada).
Lê MKTECH_CRM_URL e MKTECH_ENVIO_TOKEN do ambiente ou de um arquivo .env
(caminho em MKTECH_ENVIO_ENV_FILE, ou .env ao lado deste script).

Quem decide o que sai e quando é o servidor do CRM (chave global, pausa,
horário, limite diário, tempo de espera). Este script só:
  1. pergunta a próxima etapa (saudação, mensagem principal, lembrete ou
     resposta do secretário);
  2. confere o texto de novo e entrega ao transporte;
  3. confirma o resultado;
  4. repassa as mensagens recebidas para o CRM classificar.
Ele nunca escreve texto próprio: as respostas do secretário são escritas pelo
Hermes, conferidas pelo CRM e só chegam aqui com o secretário ligado no painel.

Transportes:
  simulacao  (padrão) não contata ninguém; grava em envio-simulado.log
  whatsappweb  envio real pelo WhatsApp Web do chip de prospecção, via a ponte local
             envio/whatsapp-web/bridge.js (http://127.0.0.1:3799). Veja envio/WHATSAPP-WEB.md.
             ENVIO_SO_PARA=5517... limita os destinos (use no teste).
  whatsapp   reservado (não configurado)

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
POLL_SECONDS = 3
MAX_TEXT = 700

EXIT_OK, EXIT_INVALID, EXIT_TEMPORARY, EXIT_CONFIG = 0, 2, 5, 6

# Última barreira antes do cliente: texto com cara de erro ou saída técnica
# do agente nunca é entregue, mesmo que tenha passado pelo servidor.
_TECHNICAL = re.compile(
    r"\berr(o|or)\b|ocorreu um (erro|problema)|exception|traceback|undefined|\bnull\b|\bnan\b|\bjson\b|\bapi\b|"
    r"https?:|\bstatus\b|tente novamente|timeout|\btoken\b|\bprompt\b|como (um )?(modelo|assistente)|"
    r"nao (posso|consigo) (ajudar|gerar|escrever)|\bdesculpe\b|\blead\b|(?:^|\n)\s*diagnostico\s*:|[\[\]{}<>`]|\*\*|\\n"
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
        if (key.startswith(("MKTECH_CRM_", "MKTECH_ENVIO_", "MKTECH_COMMERCIAL_", "BRIDGE_")) or key in ("ENVIO_SO_PARA", "OPENROUTER_API_KEY")) and key not in os.environ:
            os.environ[key] = value


class ConfigError(Exception):
    pass

class BridgeRejected(RuntimeError):
    """Resposta explícita da ponte anterior ao envio; diferente de timeout ambíguo."""


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

    def enviar(self, telefone: str, texto: str) -> str | None:  # levanta exceção se falhar; devolve o ID da mensagem, se houver
        raise NotImplementedError

    def audio(self, msg: dict[str, Any]) -> tuple[bytes, str] | None:
        """Bytes e tipo do áudio guardado pela ponte para este evento (se houver)."""
        return None

    def apagar_audio(self, msg: dict[str, Any]) -> None:
        pass

    def comercial(self, item: dict[str, Any]) -> dict[str, Any]:
        raise BridgeRejected("transporte sem suporte V4; nada enviado")

    def ack(self, msg: dict[str, Any]) -> None:
        pass

    def resultados(self) -> list[dict[str, Any]]:
        return []

    def ack_result(self, item: dict[str, Any]) -> None:
        pass

    def health(self, ready: bool) -> None:
        pass

    def recebidas(self) -> list[dict[str, Any]]:
        """Mensagens novas recebidas: [{telefone, texto, tipo (texto/audio/imagem/outro), recebida_em}]."""
        return []

    def minhas(self) -> list[dict[str, Any]]:
        """Mensagens escritas no celular do chip, incluindo texto e ID quando disponíveis."""
        return []

    def historico(self) -> list[dict[str, Any]]:
        return []

    def enviar_voz(self, item: dict[str, Any]) -> str:
        raise RuntimeError("Este transporte não suporta mensagens de voz")

    def pronto(self) -> bool:
        """False enquanto o transporte não consegue enviar; nada é reservado no servidor."""
        return True


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


class WhatsAppWeb(Transporte):
    """Entrega pela ponte local do WhatsApp Web. Só envia o texto que o servidor mandou."""

    nome = "whatsappweb"

    def enviar_voz(self, item: dict[str, Any]) -> str:
        import base64
        url = item.get("audio_url", "")
        if not isinstance(url, str) or not url.startswith("https://"):
            raise BridgeRejected("URL de áudio inválida")
        with urllib.request.urlopen(url, timeout=30) as response:
            audio = response.read(3 * 1024 * 1024 + 1)
        if not audio or len(audio) > 3 * 1024 * 1024:
            raise BridgeRejected("Áudio vazio ou maior que 3 MB")
        out = self._call("POST", "/enviar-voz", {"telefone": item["telefone"], "item_id": item["id"],
                          "mime": item.get("audio_mime"), "data": base64.b64encode(audio).decode("ascii")}, timeout=120)
        if not out.get("ok") or not out.get("id"):
            raise RuntimeError("A ponte não confirmou o envio da mensagem de voz; confira no WhatsApp")
        return out["id"]

    def historico(self) -> list[dict[str, Any]]:
        try:
            out = self._call("GET", "/historico")
            return out if isinstance(out, list) else []
        except RuntimeError as error:
            log(str(error))
            return []

    def __init__(self, env: dict[str, str] | None = None) -> None:
        e = env if env is not None else os.environ
        self.base = e.get("BRIDGE_URL", "http://127.0.0.1:3799").rstrip("/")
        self.token = e.get("BRIDGE_TOKEN", "").strip()
        self.only_to = {re.sub(r"\D", "", x) for x in e.get("ENVIO_SO_PARA", "").split(",") if re.sub(r"\D", "", x)}

    def _call(self, method: str, path: str, body: Any = None, timeout: float = TIMEOUT_SECONDS) -> Any:
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["X-Bridge-Token"] = self.token
        req = urllib.request.Request(
            self.base + path, data=json.dumps(body).encode() if body is not None else None, method=method, headers=headers
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read() or b"null")
        except urllib.error.HTTPError as e:
            detail = ""
            with contextlib.suppress(Exception):
                detail = json.loads(e.read()).get("erro", "")
            error_class = BridgeRejected if e.code in (400, 401, 403, 404, 422, 503) else RuntimeError
            raise error_class(f"ponte recusou (HTTP {e.code}): {detail}"[:300]) from None
        except (urllib.error.URLError, OSError) as e:
            raise RuntimeError(f"ponte do WhatsApp fora do ar: {e}"[:300]) from None

    def enviar(self, telefone: str, texto: str) -> None:
        digits = re.sub(r"\D", "", telefone or "")
        if self.only_to and digits not in self.only_to:
            raise BridgeRejected("destino fora de ENVIO_SO_PARA; nada enviado")
        out = self._call("POST", "/enviar", {"telefone": digits, "texto": texto})
        if not (isinstance(out, dict) and out.get("ok")):
            raise RuntimeError("a ponte não confirmou o envio")
        return out.get("id")

    def audio(self, msg: dict[str, Any]) -> tuple[bytes, str] | None:
        arquivo = msg.get("audio_arquivo")
        if not arquivo or not re.fullmatch(r"[0-9a-f]{8,160}\.bin", arquivo):
            return None
        headers = {"X-Bridge-Token": self.token} if self.token else {}
        req = urllib.request.Request(self.base + "/audio/" + arquivo, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
                return resp.read(), str(msg.get("audio_mime") or "audio/ogg")
        except (urllib.error.URLError, OSError) as e:
            log(f"áudio indisponível na ponte: {e}")
            return None

    def apagar_audio(self, msg: dict[str, Any]) -> None:
        if msg.get("audio_arquivo"):
            with contextlib.suppress(RuntimeError):
                self._call("POST", "/audio/apagar", {"arquivo": msg["audio_arquivo"]})

    def comercial(self, item: dict[str, Any]) -> dict[str, Any]:
        digits = re.sub(r"\D", "", item["telefone"])
        if self.only_to and digits not in self.only_to:
            raise BridgeRejected("destino fora de ENVIO_SO_PARA; nada enviado")
        return self._call("POST", "/enviar", {"telefone": digits, "texto": item["texto"], "item_id": item["id"], "media": item.get("media"), "asset": item.get("asset")})

    def ack(self, msg: dict[str, Any]) -> None:
        if msg.get("event_id"):
            self._call("POST", "/eventos/ack", {"ids": [msg["event_id"]]})

    def resultados(self) -> list[dict[str, Any]]:
        try:
            return self._call("GET", "/resultados") or []
        except RuntimeError:
            return []

    def ack_result(self, item: dict[str, Any]) -> None:
        self._call("POST", "/resultados/ack", {"item_id": item["item_id"], "status": item["status"]})

    def health(self, ready: bool) -> None:
        conn = getattr(self, "conn", {})
        request("POST", "/api/hermes/v1/comercial/conexao", {"ready": ready, "demonstrations": getattr(self, "demonstrations", []),
                                                             "number": conn.get("number"), "state": conn.get("state") or "ponte_offline", "qr": None if ready else conn.get("qr")})

    def pronto(self) -> bool:
        try:
            out = self._call("GET", "/estado")
        except RuntimeError:
            self.conn = {"state": "ponte_offline"}
            return False
        if isinstance(out, dict):
            self.conn = {"number": out.get("numero"), "state": str(out.get("estado") or "")[:120], "qr": out.get("qr")}
        self.demonstrations = out.get("demonstrations", []) if isinstance(out, dict) else []
        return bool(isinstance(out, dict) and out.get("pronto"))

    def recebidas(self) -> list[dict[str, Any]]:
        try:
            out = self._call("GET", "/recebidas")
        except RuntimeError as e:
            log(str(e))
            return []
        return out if isinstance(out, list) else []

    def minhas(self) -> list[dict[str, Any]]:
        try:
            out = self._call("GET", "/minhas")
        except RuntimeError as e:
            log(str(e))
            return []
        return out if isinstance(out, list) else []


TRANSPORTES: dict[str, Callable[[], Transporte]] = {"simulacao": Simulacao, "whatsapp": WhatsAppNaoConfigurado, "whatsappweb": WhatsAppWeb}


# Laço ------------------------------------------------------------------------


def report(item_id: str, etapa: str, ok: bool, erro: str | None = None, **extra: Any) -> dict[str, Any]:
    status, payload = request("POST", f"/api/hermes/v1/envio/{item_id}/resultado", {"etapa": etapa, "ok": ok, "erro": erro, **extra})
    if status == 0:
        log(f"não consegui confirmar {etapa} de {item_id}; o servidor marca como falhou e não reenvia")
    return payload


def upload_audio(transporte: Transporte, msg: dict[str, Any]) -> bool:
    """Sobe o áudio de um evento para o painel. True = nada pendente (subiu, não existe ou foi recusado de vez)."""
    if not msg.get("audio_arquivo") or not msg.get("message_id"):
        return True
    got = transporte.audio(msg)
    if got is None:
        return True  # arquivo sumiu da ponte: não trava a fila por causa do áudio
    data, mime = got
    url, token = config()
    req = urllib.request.Request(
        url + "/api/hermes/v1/envio/audio/" + urllib.request.quote(msg["message_id"], safe=""), data=data, method="PUT",
        headers={"Authorization": f"Bearer {token}", "Content-Type": mime, "User-Agent": "mktech-envio/1.0"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60):
            pass
    except urllib.error.HTTPError as e:
        if e.code in (400, 413, 415, 422):
            log(f"áudio de {msg.get('telefone')} recusado pelo painel (HTTP {e.code}); seguindo sem ele")
            transporte.apagar_audio(msg)
            return True
        log(f"áudio de {msg.get('telefone')}: HTTP {e.code}; tento de novo")
        return False
    except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
        log(f"áudio de {msg.get('telefone')}: {e}; tento de novo")
        return False
    transporte.apagar_audio(msg)
    return True


def forward_replies(transporte: Transporte) -> int:
    n = 0
    for msg in transporte.recebidas():
        body = {"telefone": msg["telefone"], "texto": msg.get("texto") or None, "tipo": msg.get("tipo") or "texto"}
        if msg.get("recebida_em"):
            body["recebida_em"] = msg["recebida_em"]
        if msg.get("segundos_desde_envio") is not None:
            body["segundos_desde_envio"] = msg["segundos_desde_envio"]
        if msg.get("message_id"):
            body["message_id"] = msg["message_id"]
        status, payload = request("POST", "/api/hermes/v1/envio/respostas", body)
        if status < 400 and status > 0 and payload.get("status") in ("registrada", "existente", "ignorada"):
            if upload_audio(transporte, msg):
                transporte.ack(msg)
        if payload.get("status") == "registrada":
            quem = "PESSOA" if payload.get("conversa") else "automática"
            log(f"resposta de {msg['telefone']} registrada como {quem}" + (" (texto segurado)" if payload.get("segurada") else ""))
        else:
            log(f"resposta de {msg['telefone']} não registrada: {payload.get('status') or status} {payload.get('motivo') or ''}".strip())
        n += 1
    return n


def forward_minhas(transporte: Transporte) -> int:
    """Registra no servidor a mensagem escrita no celular do chip."""
    n = 0
    for msg in transporte.minhas():
        body = {"telefone": msg["telefone"]}
        if msg.get("enviada_em"):
            body["enviada_em"] = msg["enviada_em"]
        for key in ("texto", "tipo", "message_id"):
            if msg.get(key) is not None:
                body[key] = msg[key]
        status, payload = request("POST", "/api/hermes/v1/envio/minhas", body)
        if status < 400 and status > 0 and payload.get("status") in ("registrada", "existente", "ignorada"):
            if upload_audio(transporte, msg):
                transporte.ack(msg)
        if payload.get("status") == "registrada":
            log(f"mensagem sua para {msg['telefone']} registrada (conta para os lembretes)")
        n += 1
    return n


def forward_history(transporte: Transporte) -> int:
    """Importa contexto antigo sem chamar a classificação ou automação ao vivo."""
    now = time.monotonic()
    if now < getattr(transporte, "_history_next_at", 0):
        return 0
    transporte._history_next_at = now + 30
    count = 0
    for msg in transporte.historico()[:20]:
        body = {key: msg.get(key) for key in ("telefone", "message_id", "direcao", "texto", "tipo", "ocorrida_em")}
        status, payload = request("POST", "/api/hermes/v1/envio/historico", body)
        if 0 < status < 400 and payload.get("status") in ("registrada", "existente", "ignorada"):
            transporte.ack(msg)
            count += 1
        else:
            break  # Mantém a fila durável e evita exceder o limite de requisições.
    return count


def send_manual_reply(transporte: Transporte) -> str | None:
    """Envia uma resposta escrita no painel (sem janela de horário: foi decisão humana)."""
    status, nxt = request("POST", "/api/hermes/v1/envio/manual/proximo", {})
    if status in (401, 403):
        raise ConfigError("token do enviador inválido, revogado ou sem permissão")
    if nxt.get("status") != "enviar" or not nxt.get("id") or not nxt.get("telefone"):
        return None
    # Texto humano: sem o filtro "parece erro" dos textos automáticos (links e termos comuns são válidos).
    texto = nxt["texto"].strip() if isinstance(nxt.get("texto"), str) else ""
    path = f"/api/hermes/v1/envio/manual/{nxt['id']}/resultado"
    if nxt.get("media") != "audio" and (not texto or len(texto) > 1000):
        request("POST", path, {"ok": False, "erro": "texto vazio ou grande demais; nada enviado"})
        return "recusado"
    try:
        provider = transporte.enviar_voz(nxt) if nxt.get("media") == "audio" else transporte.enviar(nxt["telefone"], texto)
    except Exception as e:  # noqa: BLE001 - qualquer falha vira "falhou" e nunca é reenviada sozinha
        request("POST", path, {"ok": False, "erro": f"{transporte.nome}: {e}"[:400]})
        return "falhou"
    request("POST", path, {"ok": True, "provider_id": provider})
    log(f"resposta do painel enviada para {nxt['telefone']}")
    return "enviado"


def step(transporte: Transporte) -> tuple[str, float]:
    """Executa uma rodada. Devolve (status, segundos até a próxima)."""
    forward_replies(transporte)
    forward_minhas(transporte)
    forward_history(transporte)
    for item in transporte.resultados():
        confirmed = report(item["item_id"], "comercial", item["status"] in ("enviada", "entregue"), message_status=item["status"], provider_id=item.get("provider_id"))
        if confirmed.get("status") in ("registrado", "existente"):
            transporte.ack_result(item)
    ready=transporte.pronto()
    transporte._pronto_agora = ready
    transporte.health(ready)
    if not ready:
        return "ponte_desconectada", POLL_SECONDS
    manual = send_manual_reply(transporte)
    if manual:
        return manual, 2.0
    status, nxt = request("POST", "/api/hermes/v1/envio/proximo", {})
    if status in (401, 403):
        raise ConfigError("token do enviador inválido, revogado ou sem permissão")
    s = nxt.get("status", "falha_temporaria")
    if s != "enviar":
        wait = float(nxt.get("segundos") or POLL_SECONDS) if s == "aguardar" else POLL_SECONDS
        return s, max(1.0, wait)

    item, etapa, telefone = nxt.get("id"), nxt.get("etapa"), nxt.get("telefone")
    texto = safe_text(nxt.get("texto"))
    if not item or etapa not in ("saudacao", "mensagem", "lembrete", "resposta", "comercial") or not telefone:
        log(f"resposta inesperada do servidor; nada enviado: {nxt}")
        return "invalido", POLL_SECONDS
    if texto is None:
        report(item, etapa, False, "texto recusado pelo enviador (parece erro ou texto técnico); nada enviado", **({"message_status": "falhou"} if etapa == "comercial" else {}))
        return "recusado", 5.0
    if etapa == "comercial":
        try:
            out = transporte.comercial(nxt)
            state = out.get("message_status", "desconhecido")
            if state not in ("enviada", "entregue", "falhou", "desconhecido"):
                state = "desconhecido"
            report(item, etapa, state in ("enviada", "entregue"), provider_id=out.get("id"), message_status=state)
            return state, 3.0
        except BridgeRejected as e:
            report(item, etapa, False, str(e)[:400], message_status="falhou")
            return "falhou", POLL_SECONDS
        except Exception as e:
            report(item, etapa, False, str(e)[:400], message_status="desconhecido")
            return "desconhecido", POLL_SECONDS
    try:
        transporte.enviar(telefone, texto)
    except Exception as e:  # noqa: BLE001 - qualquer falha do transporte vira "falhou"
        report(item, etapa, False, f"{transporte.nome}: {e}"[:400])
        return "falhou", POLL_SECONDS
    report(item, etapa, True)
    return "enviado", 3.0


MANUAL_POLL_SECONDS = 1.5


def esperar(transporte: Transporte, seconds: float) -> None:
    """Dorme até a próxima rodada, olhando a fila de respostas do painel a cada ~1,5 s (envio quase instantâneo)."""
    fim = time.monotonic() + seconds
    while True:
        restante = fim - time.monotonic()
        if restante <= 0:
            return
        time.sleep(min(MANUAL_POLL_SECONDS, restante))
        if getattr(transporte, "_pronto_agora", False) and time.monotonic() < fim:
            send_manual_reply(transporte)


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
            esperar(transporte, wait)
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
