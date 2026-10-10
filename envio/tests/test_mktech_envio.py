"""Testes do enviador contra um servidor HTTP falso. Nada é enviado a ninguém.

Rodar: python -m unittest discover -s envio/tests -v
"""
from __future__ import annotations

import contextlib
import io
import json
import os
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import mktech_envio  # noqa: E402

TOKEN = "mkt_" + "ef" * 32
ITEM = "22222222-2222-4222-8222-222222222222"


class FakeApi(BaseHTTPRequestHandler):
    calls: list[dict] = []
    responses: dict[str, list[tuple[int, dict]]] = {}

    def log_message(self, *args):
        pass

    def _handle(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(length) or b"null") if length else None
        FakeApi.calls.append({"method": self.command, "path": self.path, "body": body, "auth": self.headers.get("Authorization")})
        queue = FakeApi.responses.get(f"{self.command} {self.path}") or [(404, {"status": "nao_encontrado"})]
        status, payload = queue.pop(0) if len(queue) > 1 else queue[0]
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    do_GET = do_POST = _handle


class Gravador(mktech_envio.Transporte):
    nome = "gravador"

    def __init__(self, falhar: bool = False, recebidas: list | None = None):
        self.enviadas: list[tuple[str, str]] = []
        self.falhar = falhar
        self._recebidas = recebidas or []

    def enviar(self, telefone, texto):
        if self.falhar:
            raise RuntimeError("sem conexão")
        self.enviadas.append((telefone, texto))

    def recebidas(self):
        r, self._recebidas = self._recebidas, []
        return r


class SenderTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), FakeApi)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def setUp(self):
        FakeApi.calls = []
        FakeApi.responses = {}
        os.environ["MKTECH_CRM_URL"] = f"http://127.0.0.1:{self.server.server_port}"
        os.environ["MKTECH_ENVIO_TOKEN"] = TOKEN
        os.environ["MKTECH_ENVIO_ENV_FILE"] = os.devnull
        self._sleep = mktech_envio.time.sleep
        mktech_envio.time.sleep = lambda s: None

    def tearDown(self):
        mktech_envio.time.sleep = self._sleep

    def next_is(self, payload):
        FakeApi.responses["POST /api/hermes/v1/envio/proximo"] = [(200, payload)]
        FakeApi.responses[f"POST /api/hermes/v1/envio/{ITEM}/resultado"] = [(200, {"status": "registrado"})]

    def results(self):
        return [c["body"] for c in FakeApi.calls if c["path"].endswith("/resultado")]

    def test_envia_o_texto_exato_do_servidor_e_confirma(self):
        self.next_is({"status": "enviar", "id": ITEM, "etapa": "saudacao", "telefone": "+5517991234567", "texto": "Bom dia! Tudo bem?"})
        t = Gravador()
        status, _ = mktech_envio.step(t)
        self.assertEqual(status, "enviado")
        self.assertEqual(t.enviadas, [("+5517991234567", "Bom dia! Tudo bem?")])
        self.assertEqual(self.results(), [{"etapa": "saudacao", "ok": True, "erro": None}])
        self.assertEqual(FakeApi.calls[0]["auth"], f"Bearer {TOKEN}")

    def test_texto_com_cara_de_erro_nunca_vai_ao_cliente(self):
        for texto in [
            "Ocorreu um erro ao gerar a mensagem. Tente novamente.",
            '{"mensagem": "oi"}',
            "Traceback (most recent call last): ...",
            "Desculpe, como modelo de linguagem não posso ajudar.",
            "",
            None,
        ]:
            FakeApi.calls = []
            self.next_is({"status": "enviar", "id": ITEM, "etapa": "mensagem", "telefone": "+5517991234567", "texto": texto})
            t = Gravador()
            status, _ = mktech_envio.step(t)
            self.assertEqual(status, "recusado", texto)
            self.assertEqual(t.enviadas, [])
            self.assertFalse(self.results()[0]["ok"])

    def test_falha_do_transporte_e_reportada(self):
        self.next_is({"status": "enviar", "id": ITEM, "etapa": "saudacao", "telefone": "+5517991234567", "texto": "Boa noite! Tudo bem?"})
        status, _ = mktech_envio.step(Gravador(falhar=True))
        self.assertEqual(status, "falhou")
        self.assertEqual(self.results()[0]["ok"], False)
        self.assertIn("sem conexão", self.results()[0]["erro"])

    def test_desligado_ou_pausado_nao_envia(self):
        for s in ("desligado", "pausado", "fora_do_horario", "limite_diario", "fila_vazia"):
            self.next_is({"status": s})
            t = Gravador()
            status, wait = mktech_envio.step(t)
            self.assertEqual(status, s)
            self.assertEqual(t.enviadas, [])
            self.assertEqual(wait, mktech_envio.POLL_SECONDS)

    def test_aguardar_respeita_os_segundos_do_servidor(self):
        self.next_is({"status": "aguardar", "segundos": 12})
        self.assertEqual(mktech_envio.step(Gravador()), ("aguardar", 12.0))

    def test_repassa_respostas_recebidas(self):
        self.next_is({"status": "fila_vazia"})
        FakeApi.responses["POST /api/hermes/v1/envio/respostas"] = [(201, {"status": "registrada", "conversa": True})]
        t = Gravador(recebidas=[{"telefone": "+5517991234567", "texto": "Oi, quem é?", "segundos_desde_envio": 90}])
        mktech_envio.step(t)
        sent = [c["body"] for c in FakeApi.calls if c["path"].endswith("/respostas")]
        self.assertEqual(sent, [{"telefone": "+5517991234567", "texto": "Oi, quem é?", "segundos_desde_envio": 90}])

    def test_simulacao_nao_contata_ninguem_e_grava_log(self):
        with tempfile.TemporaryDirectory() as d:
            sim = mktech_envio.Simulacao(Path(d) / "sim.log")
            sim.enviar("+5517991234567", "Bom dia! Tudo bem?")
            line = json.loads((Path(d) / "sim.log").read_text(encoding="utf-8").strip())
            self.assertEqual(line["texto"], "Bom dia! Tudo bem?")

    def test_whatsapp_real_ainda_nao_configurado_falha_sem_enviar(self):
        self.next_is({"status": "enviar", "id": ITEM, "etapa": "saudacao", "telefone": "+5517991234567", "texto": "Bom dia! Tudo bem?"})
        status, _ = mktech_envio.step(mktech_envio.WhatsAppNaoConfigurado())
        self.assertEqual(status, "falhou")

    def test_sem_token_sai_com_codigo_de_configuracao(self):
        os.environ["MKTECH_ENVIO_TOKEN"] = ""
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(mktech_envio.main(["selftest"]), mktech_envio.EXIT_CONFIG)

    def test_selftest_le_o_estado(self):
        FakeApi.responses["GET /api/hermes/v1/envio/estado"] = [(200, {"status": "ok", "enabled": False})]
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(mktech_envio.main(["selftest"]), 0)
        self.assertFalse(json.loads(out.getvalue())["enabled"])


if __name__ == "__main__":
    unittest.main()
