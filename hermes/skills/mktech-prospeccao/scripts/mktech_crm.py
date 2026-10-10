#!/usr/bin/env python3
"""Cliente de linha de comando da API do CRM MKTech para o Hermes Agent.

Só usa a biblioteca padrão do Python (funciona no Windows sem instalar nada).
Lê MKTECH_CRM_URL e MKTECH_CRM_TOKEN do ambiente ou de um arquivo .env
(caminho em MKTECH_CRM_ENV_FILE, ou .env ao lado deste script).

O token só permite consultar duplicados, cadastrar candidatos, registrar
execuções e ler configurações. Este script não envia mensagens a ninguém.

Comandos (saída sempre em JSON no stdout; logs no stderr):
  selftest                         verifica URL, token e configurações
  settings                         configurações de prospecção
  identifiers                      identificadores já cadastrados
  check   --file candidato.json    consulta duplicados (não grava)
  start-run [--manual]             registra o início da execução
  register --run ID --file c.json  cadastra um candidato (idempotente)
  finish  --run ID --status S --searched N --approved N --discarded N
          --errors N --end-reason "texto" [--error-detail "..."]

Códigos de saída: 0 ok · 2 dados inválidos · 3 rotina pausada no painel ou já
em andamento · 4 limite atingido · 5 falha temporária/rede · 6 configuração/token.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import sys
import time
import unicodedata
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

TIMEOUT_SECONDS = 20
MAX_ATTEMPTS = 4
MIN_INTERVAL_SECONDS = 0.5  # respeita o limite de requisições da API
_last_request = 0.0

EXIT_OK, EXIT_INVALID, EXIT_BLOCKED, EXIT_LIMIT, EXIT_TEMPORARY, EXIT_CONFIG = 0, 2, 3, 4, 5, 6


def log(msg: str) -> None:
    token = os.environ.get("MKTECH_CRM_TOKEN", "")
    if token:
        msg = msg.replace(token, "mkt_***")
    print(f"[mktech_crm] {msg}", file=sys.stderr)


def load_env() -> None:
    env_file = os.environ.get("MKTECH_CRM_ENV_FILE") or str(Path(__file__).resolve().parent / ".env")
    path = Path(env_file)
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip().strip('"').strip("'")
        if key.startswith("MKTECH_CRM_") and key not in os.environ:
            os.environ[key] = value


def config() -> tuple[str, str]:
    url = os.environ.get("MKTECH_CRM_URL", "").rstrip("/")
    token = os.environ.get("MKTECH_CRM_TOKEN", "")
    if not url.startswith(("http://", "https://")):
        raise SystemExit(fail(EXIT_CONFIG, "MKTECH_CRM_URL não configurada (ex.: http://localhost:3000)"))
    if not token.startswith("mkt_"):
        raise SystemExit(fail(EXIT_CONFIG, "MKTECH_CRM_TOKEN não configurado (crie em Configurações do painel)"))
    return url, token


def fail(code: int, message: str, extra: dict[str, Any] | None = None) -> int:
    out = {"ok": False, "error": message, **(extra or {})}
    print(json.dumps(out, ensure_ascii=False))
    log(message)
    return code


def request(method: str, path: str, body: Any = None, headers: dict[str, str] | None = None) -> tuple[int, dict[str, Any]]:
    """Requisição com timeout, poucas tentativas e respeito a 429/Retry-After."""
    global _last_request
    url, token = config()
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    hdrs = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "User-Agent": "mktech-crm-hermes/1.0",
        **({"Content-Type": "application/json"} if data is not None else {}),
        **(headers or {}),
    }
    last_error = "falha desconhecida"
    for attempt in range(1, MAX_ATTEMPTS + 1):
        wait = MIN_INTERVAL_SECONDS - (time.monotonic() - _last_request)
        if wait > 0:
            time.sleep(wait)
        _last_request = time.monotonic()
        req = urllib.request.Request(url + path, data=data, method=method, headers=hdrs)
        retry_after = None
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
                return resp.status, json.loads(resp.read().decode("utf-8") or "{}")
        except urllib.error.HTTPError as e:
            payload = {}
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
            delay += random.uniform(0, 0.5)
            log(f"{method} {path}: {last_error}; nova tentativa em {delay:.1f}s ({attempt}/{MAX_ATTEMPTS - 1})")
            time.sleep(delay)
    return 0, {"status": "falha_temporaria", "errors": [last_error]}


def read_json(file: str) -> Any:
    raw = sys.stdin.read() if file == "-" else Path(file).read_text(encoding="utf-8-sig")
    return json.loads(raw)


def emit(status: int, payload: dict[str, Any]) -> int:
    print(json.dumps({"http": status, **payload}, ensure_ascii=False))
    s = payload.get("status")
    if status == 0 or s == "falha_temporaria":
        return EXIT_TEMPORARY
    if status in (401, 403):
        log("token inválido, revogado ou sem permissão")
        return EXIT_CONFIG
    if s == "limite_atingido":
        return EXIT_LIMIT
    if s == "ja_em_andamento":
        return EXIT_BLOCKED
    if s == "invalido" or status >= 400:
        return EXIT_INVALID
    return EXIT_OK


def _norm(value: Any) -> str:
    text = unicodedata.normalize("NFKD", str(value or "")).encode("ascii", "ignore").decode().lower()
    return "".join(ch for ch in text if ch.isalnum())


def idempotency_key(run_id: str | None, candidate: dict[str, Any]) -> str:
    """Chave estável: repetir o mesmo candidato na mesma execução reaproveita a resposta."""
    basis = "|".join(
        [
            run_id or "sem-execucao",
            _norm(candidate.get("business_name")),
            _norm(candidate.get("city")),
            _norm(candidate.get("unit_label")),
            "".join(ch for ch in str(candidate.get("phone") or "") if ch.isdigit()),
            _norm(candidate.get("instagram")),
            _norm(candidate.get("source_place_id")),
            hashlib.sha256(json.dumps(candidate, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:16],
        ]
    )
    return "hermes-" + hashlib.sha256(basis.encode()).hexdigest()[:40]


def cmd_selftest(_: argparse.Namespace) -> int:
    status, payload = request("GET", "/api/hermes/v1/settings")
    if status == 200:
        print(json.dumps({"ok": True, "settings": payload.get("settings")}, ensure_ascii=False))
        return EXIT_OK
    return emit(status, payload)


def cmd_settings(_: argparse.Namespace) -> int:
    return emit(*request("GET", "/api/hermes/v1/settings"))


def cmd_identifiers(_: argparse.Namespace) -> int:
    return emit(*request("GET", "/api/hermes/v1/identifiers"))


def cmd_check(args: argparse.Namespace) -> int:
    cand = read_json(args.file)
    keys = ("business_name", "city", "state", "unit_label", "phone", "instagram", "website_url", "source_name", "source_place_id")
    body = {k: cand[k] for k in keys if cand.get(k) not in (None, "")}
    return emit(*request("POST", "/api/hermes/v1/duplicates/check", body))


def cmd_start_run(args: argparse.Namespace) -> int:
    s_status, s_payload = request("GET", "/api/hermes/v1/settings")
    if s_status != 200:
        return emit(s_status, s_payload)
    settings = s_payload.get("settings") or {}
    if not args.manual and not settings.get("routine_enabled"):
        return fail(EXIT_BLOCKED, "rotina diária pausada no painel (Configurações); use --manual para teste manual")
    config_used = {k: settings.get(k) for k in ("daily_target", "cities", "niches", "max_run_minutes", "max_searches", "max_cost_usd")}
    config_used["manual"] = bool(args.manual)
    return emit(*request("POST", "/api/hermes/v1/runs", {"routine": args.routine, "config": config_used}))


def cmd_register(args: argparse.Namespace) -> int:
    cand = read_json(args.file)
    key = idempotency_key(args.run, cand)
    body = {"run_id": args.run, "candidate": cand}
    return emit(*request("POST", "/api/hermes/v1/candidates", body, {"Idempotency-Key": key}))


def cmd_finish(args: argparse.Namespace) -> int:
    body = {
        "status": args.status,
        "searched": args.searched,
        "approved": args.approved,
        "discarded": args.discarded,
        "errors": args.errors,
        "end_reason": args.end_reason,
        "error_details": [d[:500] for d in (args.error_detail or [])][:50],
    }
    if args.notes:
        body["notes"] = args.notes
    return emit(*request("POST", f"/api/hermes/v1/runs/{args.run}/finish", body))


def main(argv: list[str] | None = None) -> int:
    load_env()
    p = argparse.ArgumentParser(description="Cliente da API do CRM MKTech para o Hermes")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("selftest").set_defaults(fn=cmd_selftest)
    sub.add_parser("settings").set_defaults(fn=cmd_settings)
    sub.add_parser("identifiers").set_defaults(fn=cmd_identifiers)
    c = sub.add_parser("check")
    c.add_argument("--file", required=True, help="JSON do candidato ou - para stdin")
    c.set_defaults(fn=cmd_check)
    s = sub.add_parser("start-run")
    s.add_argument("--routine", default="prospeccao-diaria")
    s.add_argument("--manual", action="store_true", help="execução manual de teste (ignora a pausa do painel)")
    s.set_defaults(fn=cmd_start_run)
    r = sub.add_parser("register")
    r.add_argument("--run", required=True)
    r.add_argument("--file", required=True)
    r.set_defaults(fn=cmd_register)
    f = sub.add_parser("finish")
    f.add_argument("--run", required=True)
    f.add_argument("--status", choices=["concluida", "parcial", "falhou"], required=True)
    for name in ("searched", "approved", "discarded", "errors"):
        f.add_argument(f"--{name}", type=int, required=True)
    f.add_argument("--end-reason", required=True)
    f.add_argument("--error-detail", action="append")
    f.add_argument("--notes")
    f.set_defaults(fn=cmd_finish)
    args = p.parse_args(argv)
    try:
        return args.fn(args)
    except (json.JSONDecodeError, FileNotFoundError) as e:
        return fail(EXIT_INVALID, f"arquivo JSON inválido: {e}")


if __name__ == "__main__":
    sys.exit(main())
