"""Estudante do Hermes: durante 30 dias observa como o Marcos trabalha no WhatsApp.

Só lê as conversas do dia (pelo CRM) e escreve anotações. Nunca envia mensagem,
nunca fala com cliente. A cada dia grava a nota do dia e acrescenta regras ao
aprendizado.md; no dia 29 gera o relatório final.
"""
import argparse
import json
import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from mktech_envio import load_env, request, log
from commercial_model import infer, InferenceError

BRT = timezone(timedelta(hours=-3))
SECTIONS = [
    "Saudação e abertura", "Como chama o lead (nome)", "Como desenrola o atendimento",
    "Respostas automáticas (robô de clínica)", "Objeções e preço", "Áudios (voz gerada por IA)",
    "Atenção especial a um lead", "Encaminhamento e fechamento", "Tom e vocabulário", "O que evitar",
]
OUT = Path(__file__).with_name("aprendizado")

STUDY_SYSTEM = f"""Você é o Hermes, funcionário em treinamento da MKTech Dev. Durante 30 dias você ESTUDA como o Marcos (dono) trabalha no WhatsApp para depois trabalhar como ele. Você só observa: não fala com ninguém.
Entrada (JSON): day, stats (números do dia calculados pelo sistema), conversas (por lead: eventos com hora, quem falou — 'VOCÊ' é o Marcos —, tipo de mídia e texto) e playbook_atual (o aprendizado.md até agora).
Estude como o MARCOS age: como abre a conversa; se e quando chama o lead pelo nome; como responde mensagem automática de clínica; como desenrola, pergunta, apresenta exemplo e encaminha; tom, tamanho das mensagens, emojis, expressões; quando dá mais atenção a um lead (mais mensagens, exemplo personalizado, vídeo, retorno rápido) e o motivo; quando manda ÁUDIO (voz gerada por IA no ElevenLabs/ChatGPT; o áudio não vem transcrito: registre quando e em que ponto da conversa ele usa); como trata preço e objeção.
Regras: 1) Baseie-se SÓ no que está nas conversas; nunca invente. 2) Mensagens de 'sistema (saudação)' são automáticas; aprenda com o que o Marcos escreve. 3) Escreva em português, direto. 4) Não inclua telefone, e-mail nem link; nome do lead só se necessário (prefira 'o lead'). 5) Se o dia não tem material suficiente, diga isso e devolva additions vazio.
Responda SOMENTE JSON: {{"notes": "markdown do dia: o que você aprendeu hoje, com exemplos curtos do jeito do Marcos escrever, em tópicos", "additions": [{{"section": uma de {json.dumps(SECTIONS, ensure_ascii=False)}, "rule": "regra clara e curta (até 250 caracteres) de como o Marcos trabalha", "example": "frase real dele (até 200 caracteres) ou null"}}]}}.
No máximo 12 additions, só regras NOVAS que não estejam no playbook_atual."""

FINAL_SYSTEM = """Você é o Hermes, funcionário em treinamento da MKTech Dev, terminando 30 dias estudando como o Marcos trabalha no WhatsApp.
Entrada (JSON): playbook (aprendizado.md) e notas_por_dia. Escreva o RELATÓRIO FINAL em markdown, em português, para o Marcos avaliar se você já pode trabalhar sozinho: 1) o que aprendi sobre o jeito dele (resumo por tema); 2) padrões mais fortes e exemplos reais de frases dele; 3) onde ainda tenho dúvida ou pouco material (por exemplo, áudios não transcritos); 4) o que eu NÃO faria sozinho e passaria para ele; 5) como pretendo agir nas mensagens automáticas, no primeiro contato e nas objeções. Não invente nada que não esteja nas notas.
Responda SOMENTE JSON: {"report": "markdown"}."""


def agora():
    return datetime.now(BRT)


def salvar_arquivos(state_playbook, day=None, notes=None):
    OUT.mkdir(exist_ok=True)
    if state_playbook is not None:
        (OUT / "aprendizado.md").write_text(state_playbook, encoding="utf-8")
    if day and notes:
        (OUT / f"dia-{day}.md").write_text(f"# Dia {day}\n\n{notes}\n", encoding="utf-8")


def estudar(day, playbook):
    code, data = request("POST", "/api/hermes/v1/aprendizado/dia", {"day": day})
    if code != 200:
        log(f"Aprendizado: não consegui ler o dia {day} (HTTP {code})")
        return False
    if not data.get("conversations"):
        notes, additions = "Sem conversas neste dia.", []
    else:
        context = {"day": day, "stats": data.get("stats"), "conversas": data["conversations"], "playbook_atual": playbook[-6000:]}
        try:
            proposal = infer(STUDY_SYSTEM, context)["proposal"]
        except InferenceError as error:
            log(f"Aprendizado: inferência indisponível ({error})")
            return False
        notes = str(proposal.get("notes") or "").strip()
        additions = [a for a in (proposal.get("additions") or []) if isinstance(a, dict)][:12]
        if not notes:
            log("Aprendizado: o modelo não devolveu nota; tentarei de novo.")
            return False
    code, saved = request("POST", "/api/hermes/v1/aprendizado/salvar", {"kind": "dia", "day": day, "notes": notes, "additions": additions})
    if code == 422 and additions:
        # Alguma regra inválida (seção/tamanho): grava a nota do dia sem as regras em vez de perder o dia.
        code, saved = request("POST", "/api/hermes/v1/aprendizado/salvar", {"kind": "dia", "day": day, "notes": notes, "additions": []})
    log(f"Aprendizado: dia {day} salvo (HTTP {code}; regras novas: {saved.get('added')})")
    if code == 200:
        c2, st = request("POST", "/api/hermes/v1/aprendizado/estado", {})
        salvar_arquivos(st.get("playbook") if c2 == 200 else None, day, notes)
        return True
    return False


def relatorio_final():
    c, st = request("POST", "/api/hermes/v1/aprendizado/estado", {})
    if c != 200:
        return
    notas = {}
    for day in st.get("saved_days", []):
        f = OUT / f"dia-{day}.md"
        if f.is_file():
            notas[day] = f.read_text(encoding="utf-8")[:1500]
    try:
        report = str(infer(FINAL_SYSTEM, {"playbook": st.get("playbook", "")[-12000:], "notas_por_dia": notas})["proposal"].get("report") or "").strip()
    except InferenceError as error:
        log(f"Aprendizado: relatório final indisponível ({error})")
        return
    if report:
        code, _ = request("POST", "/api/hermes/v1/aprendizado/salvar", {"kind": "final", "report": report})
        log(f"Aprendizado: relatório final salvo (HTTP {code})")


def step():
    code, st = request("POST", "/api/hermes/v1/aprendizado/estado", {})
    if code != 200 or st.get("status") != "aprendendo" or not st.get("started_on"):
        return "parado"
    today = st["today"]
    saved = set(st.get("saved_days", []))
    start = datetime.fromisoformat(st["started_on"]).date()
    last = datetime.fromisoformat(today).date()
    days = [(start + timedelta(days=i)).isoformat() for i in range((last - start).days + 1)]
    after_hours = agora().hour >= 21
    todo = [d for d in days if d not in saved and (d < today or after_hours)]
    if st.get("study_requested") and today not in todo:
        todo.append(today)  # botão "Estudar agora" do painel
    for d in todo[:2]:
        estudar(d, st.get("playbook", ""))
    if (last - start).days + 1 >= 29 and not st.get("has_final") and any(d in saved for d in days[:28]):
        relatorio_final()
    return f"dias pendentes: {len(todo)}"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--uma-vez", action="store_true")
    args = parser.parse_args()
    load_env()
    if not os.environ.get("MKTECH_COMMERCIAL_TOKEN", "").startswith("mkt_"):
        log("Configure MKTECH_COMMERCIAL_TOKEN; estudante não iniciado.")
        return
    os.environ["MKTECH_ENVIO_TOKEN"] = os.environ["MKTECH_COMMERCIAL_TOKEN"]
    while True:
        try:
            log("Aprendizado: " + step())
        except Exception as error:  # nunca derruba o loop por um erro de rede
            log(f"Aprendizado: erro {type(error).__name__}")
        if args.uma_vez:
            return
        time.sleep(600)


if __name__ == "__main__":
    main()
