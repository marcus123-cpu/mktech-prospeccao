#!/usr/bin/env python3
"""Pesquisa comercial via Gemini 3.1; o CRM valida antes de qualquer cadastro.

Este processo nunca envia mensagens. Uma execução usa somente o provedor de
pesquisa; o atendente V6 continua independente.
"""

from __future__ import annotations

import argparse
import ipaddress
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
CRM = Path(os.environ.get("LOCALAPPDATA", "")) / "hermes/skills/mktech/mktech-prospeccao/scripts/mktech_crm.py"
ENV = ROOT / "envio/.env"
API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models/"
SP = ZoneInfo("America/Sao_Paulo")
OFFERS = {"landing_page", "landing_por_procedimento", "site_institucional", "site_com_agendamento"}
SYSTEM = """Você pesquisa oportunidades comerciais da MKTech Dev em clínicas e profissionais de estética.
Use a busca do Google para pesquisar de fato. Não invente nomes, telefones, URLs, serviços, datas ou posições no Google.
Foco: negócio sem site, landing page ou portfólio próprio. Quem já tem página própria só é elegível se uma busca concreta de procedimento+cidade mostrar oportunidade substancial de visibilidade no Google. Botão, endereço, link, contato, horário e pequenos ajustes em site alheio NÃO são oportunidade.
Pesquise no máximo 4 vezes nesta chamada. Compare nome+cidade, procure página própria e verifique duas fontes independentes. Não conclua ausência de site por uma única busca. Se a fonte limitar a verificação, registre limitation e não afirme o que ela não mostra. Não presuma perdas, receita ou atividade recente.
Retorne SOMENTE JSON: {"candidates":[...]} com no máximo 2 candidatos. Para cada candidato use exatamente campos da API: business_name, city, state, niche, services, phone, instagram, whatsapp_url, website_url, site_status, selection_reason, research_date, source_name, evidences, diagnosis. Evidência: kind (site|instagram|google|whatsapp|diretorio|busca|outro), url, summary, observed_at, limitation. Diagnóstico: fit_score (0-100), confidence (baixa|media|alta), summary, digital_presence, pains [{pain,evidence}], opportunities, offer (landing_page|landing_por_procedimento|site_institucional|site_com_agendamento|nao_recomendado), offer_reason, approach. Cada pains.evidence deve ser trecho literal do summary de uma fonte. Use null para campo opcional desconhecido. Se não houver candidato real suficientemente comprovado, retorne lista vazia."""


def load_env() -> None:
    if not ENV.is_file():
        return
    for line in ENV.read_text(encoding="utf-8-sig").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            name, value = line.split("=", 1)
            if name.strip() in {"GEMINI_API_KEY", "MKTECH_RESEARCH_MODEL", "MKTECH_RESEARCH_BUDGET_USD"}:
                os.environ.setdefault(name.strip(), value.strip().strip('"').strip("'"))


def generate(key: str, model: str, prompt: str) -> dict:
    body = {"contents": [{"parts": [{"text": prompt}]}], "tools": [{"google_search": {}}],
            "generationConfig": {"thinkingConfig": {"thinkingLevel": "low"},
                                 "maxOutputTokens": 5500}}
    request = urllib.request.Request(API_ROOT + model + ":generateContent",
                                     data=json.dumps(body, ensure_ascii=False).encode("utf-8"), method="POST",
                                     headers={"x-goog-api-key": key, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"Gemini HTTP {error.code}") from None
    except (urllib.error.URLError, ValueError, TimeoutError):
        raise RuntimeError("Gemini indisponível ou resposta inválida") from None


def probe_gemini(key: str, model: str) -> bool:
    result = generate(key, model, "Pesquise na web o domínio oficial da Prefeitura de Campinas (SP). Responda em uma frase.")
    metadata = result.get("candidates", [{}])[0].get("groundingMetadata") or {}
    return bool(metadata.get("webSearchQueries") and metadata.get("groundingChunks"))


def crm(*args: str) -> tuple[int, dict]:
    result = subprocess.run([sys.executable, str(CRM), *args], capture_output=True,
                            text=True, encoding="utf-8", errors="replace", timeout=100,
                            env={**os.environ, "PYTHONIOENCODING": "utf-8"})
    try:
        return result.returncode, json.loads(result.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        return 5, {"status": "falha_temporaria", "errors": ["Resposta inválida do CRM"]}


def public_url(value: object) -> bool:
    if not isinstance(value, str):
        return False
    parsed = urllib.parse.urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        return False
    host = parsed.hostname.lower()
    if host in {"localhost", "127.0.0.1"} or host.endswith((".local", ".internal")):
        return False
    try:
        return ipaddress.ip_address(host).is_global
    except ValueError:
        return "." in host


def validate_candidate(candidate: object, city: str, today: str) -> bool:
    if not isinstance(candidate, dict) or candidate.get("city", "").strip().casefold() != city.casefold():
        return False
    if not candidate.get("business_name") or not candidate.get("phone") or not candidate.get("whatsapp_url"):
        return False
    if not public_url(candidate["whatsapp_url"]):
        return False
    phone = re.sub(r"\D", "", str(candidate["phone"]))[-11:]
    if len(phone) < 10 or phone not in re.sub(r"\D", "", candidate["whatsapp_url"]):
        return False
    diagnosis = candidate.get("diagnosis")
    if not isinstance(diagnosis, dict) or diagnosis.get("offer") not in OFFERS or diagnosis.get("confidence") not in {"media", "alta"}:
        return False
    if not isinstance(diagnosis.get("fit_score"), int) or diagnosis["fit_score"] < 60:
        return False
    evidence = candidate.get("evidences")
    if not isinstance(evidence, list):
        return False
    verified = [e for e in evidence if isinstance(e, dict) and public_url(e.get("url"))
                and e.get("observed_at") == today and not e.get("limitation")
                and isinstance(e.get("summary"), str) and e.get("summary")]
    domains = {urllib.parse.urlparse(e["url"]).hostname for e in verified}
    if len(domains) < 2 or not diagnosis.get("pains") or not candidate.get("services"):
        return False
    if not any(isinstance(p, dict) and len(p.get("evidence", "")) >= 16
               and any(p["evidence"].casefold() in e["summary"].casefold() for e in verified)
               for p in diagnosis["pains"]):
        return False
    status = candidate.get("site_status")
    if candidate.get("website_url") or status == "site_proprio_encontrado":
        return any(e.get("kind") in {"busca", "google"}
                   and re.search(r"google|busca|pesquisa|visibilidade|seo", e["summary"], re.I)
                   and re.search(r"não aparece|não encontrado|fora da primeira página|atrás de concorrentes", e["summary"], re.I)
                   for e in verified)
    return status in {"apenas_redes_sociais", "site_nao_localizado"}


def query_gemini(city: str, niche: str, exclusions: list[str], model: str, key: str) -> tuple[list, int, float]:
    prompt = json.dumps({"cidade": city, "nicho": niche, "ja_cadastrados": exclusions[-50:],
                         "data_de_hoje": datetime.now(SP).date().isoformat(),
                         "tarefa": "Encontre até 2 negócios reais dentro do foco, com WhatsApp comercial público e fontes independentes."}, ensure_ascii=False)
    result = generate(key, model, SYSTEM + "\n\n" + prompt)
    response = result.get("candidates", [{}])[0]
    grounding = response.get("groundingMetadata") or {}
    queries = grounding.get("webSearchQueries") or []
    if not queries:
        raise RuntimeError("Gemini não confirmou buscas web nesta chamada")
    count = len(queries)
    content = "".join(part.get("text", "") for part in response.get("content", {}).get("parts", []))
    try:
        candidates = json.loads(content).get("candidates", [])
    except (ValueError, AttributeError):
        raise RuntimeError("Gemini não retornou candidatos em JSON") from None
    if not isinstance(candidates, list):
        raise RuntimeError("Resposta de pesquisa sem lista de candidatos")
    if not grounding.get("groundingChunks"):
        candidates = []
    usage = result.get("usageMetadata") or {}
    # Estimativa conservadora: preço Pro <200k tokens + busca paga por consulta.
    estimated_cost = (int(usage.get("promptTokenCount") or 0) * 2 +
                      int(usage.get("candidatesTokenCount") or 0) * 12) / 1_000_000 + count * 0.014
    return candidates[:2], count, estimated_cost


def with_candidate(candidate: dict, action: str, *args: str) -> tuple[int, dict]:
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", suffix=".json", delete=False) as file:
        json.dump(candidate, file, ensure_ascii=False)
        path = file.name
    try:
        return crm(action, *args, "--file", path)
    finally:
        Path(path).unlink(missing_ok=True)


def run(modo: str) -> int:
    load_env()
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    model = os.environ.get("MKTECH_RESEARCH_MODEL", "gemini-3.1-pro-preview").strip()
    budget = float(os.environ.get("MKTECH_RESEARCH_BUDGET_USD", "5"))
    if not key or not CRM.is_file():
        print("Pesquisa Gemini não configurada; nenhum pedido foi iniciado.")
        return 6
    try:
        if not probe_gemini(key, model):
            print("Gemini sem busca fundamentada; nenhum pedido foi iniciado.")
            return 6
    except RuntimeError:
        print("Gemini indisponível ou sem cota; nenhum pedido foi iniciado.")
        return 6
    code, settings_result = crm("selftest")
    if code or not isinstance(settings_result.get("settings"), dict):
        print("Falha ao consultar configurações do CRM.")
        return code or 5
    settings = settings_result["settings"]
    command = ("start-run", "--routine", "pedido-painel") if modo == "pedido" else ("start-run",)
    code, started = crm(*command)
    if code:
        print(json.dumps({"status": started.get("status"), "error": "Não iniciou a pesquisa"}))
        return code
    run_id = started["run_id"]
    target = int(started.get("run_target") or 0)
    max_searches = int(started.get("max_searches") or settings.get("max_searches") or 0)
    minutes = int(started.get("minutos_restantes") or started.get("max_run_minutes") or settings.get("max_run_minutes") or 90)
    deadline = time.monotonic() + max(1, minutes) * 60
    cities = [city.rsplit(" - ", 1)[0] for city in settings.get("cities", [])]
    niches = settings.get("niches", [])
    searched = created = discarded = errors = 0
    spent = 0.0
    reason = "Limite de tempo ou buscas atingido"
    try:
        if not cities or not niches:
            raise RuntimeError("Cidades ou nichos não configurados")
        code, identifiers = crm("identifiers")
        if code:
            raise RuntimeError("Falha ao consultar duplicados")
        exclusions = []
        if isinstance(identifiers.get("identifiers"), list):
            exclusions = [x.get("business_name", "") for x in identifiers["identifiers"] if isinstance(x, dict)]
        for index in range(max_searches // 4):
            if time.monotonic() >= deadline or searched + 4 > max_searches:
                break
            if spent >= budget:
                reason = "Orçamento estimado da pesquisa Gemini atingido"
                break
            if created + int(started.get("ja_vieram") or 0) >= target:
                reason = "Meta de cadastros atingida"
                break
            city, niche = cities[(index // len(niches)) % len(cities)], niches[index % len(niches)]
            try:
                candidates, count, estimated_cost = query_gemini(city, niche, exclusions, model, key)
                errors = 0
                searched += count
                spent += estimated_cost
                if count > 4 or searched > max_searches:
                    reason = "Modelo excedeu reserva de buscas"
                    break
                today = datetime.now(SP).date().isoformat()
                for candidate in candidates:
                    if not validate_candidate(candidate, city, today):
                        discarded += 1
                        continue
                    status, duplicate = with_candidate(candidate, "check")
                    if status or duplicate.get("status") != "novo":
                        discarded += 1
                        continue
                    status, registered = with_candidate(candidate, "register", "--run", run_id)
                    if status == 4:
                        reason = "Limite do CRM atingido"
                        break
                    if status or registered.get("status") != "criado":
                        discarded += 1
                        continue
                    created += 1
                    exclusions.append(candidate["business_name"])
                    print(json.dumps({"run_id": run_id, "created": created, "searched": searched,
                                      "business_name": candidate["business_name"]}, ensure_ascii=False), flush=True)
                if reason == "Limite do CRM atingido":
                    break
            except (RuntimeError, KeyError, ValueError, TypeError) as error:
                errors += 1
                print(json.dumps({"run_id": run_id, "error": str(error)[:160]}), flush=True)
                if errors >= 3:
                    reason = "Três falhas de pesquisa seguidas"
                    break
    except RuntimeError as error:
        errors += 1
        reason = str(error)[:160]
    finally:
        status = "concluida" if reason == "Meta de cadastros atingida" else "parcial" if searched else "falhou"
        finish_code, finish = crm("finish", "--run", run_id, "--status", status,
                                  "--searched", str(searched), "--approved", str(created),
                                  "--discarded", str(discarded), "--errors", str(errors),
                                  "--end-reason", reason)
        print(json.dumps({"run_id": run_id, "status": status, "searched": searched,
                          "created": created, "discarded": discarded, "errors": errors,
                          "estimated_cost_usd": round(spent, 4),
                          "finish_status": finish.get("status"), "finish_code": finish_code}, ensure_ascii=False))
    return 0 if finish_code == 0 else finish_code


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--modo", choices=["diaria", "pedido"], required=True)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--ready", action="store_true")
    args = parser.parse_args()
    if args.ready:
        load_env()
        try:
            ready = CRM.is_file() and probe_gemini(os.environ["GEMINI_API_KEY"], os.environ.get("MKTECH_RESEARCH_MODEL", "gemini-3.1-pro-preview"))
        except (KeyError, RuntimeError):
            ready = False
        print(json.dumps({"ready": ready}))
        raise SystemExit(0 if ready else 6)
    if args.dry_run:
        load_env()
        print(json.dumps({"provider": "gemini", "model": os.environ.get("MKTECH_RESEARCH_MODEL", "gemini-3.1-pro-preview"),
                          "key_configured": bool(os.environ.get("GEMINI_API_KEY")), "crm_available": CRM.is_file()}))
        raise SystemExit(0)
    raise SystemExit(run(args.modo))
