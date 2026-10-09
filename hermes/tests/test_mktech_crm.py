"""Testes do cliente mktech_crm.py contra um servidor HTTP falso (sem rede externa).

Rodar: python -m unittest discover -s hermes/tests -v
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

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "skills" / "mktech-prospeccao" / "scripts"))
import mktech_crm  # noqa: E402

TOKEN = "mkt_" + "ab" * 32


class FakeApi(BaseHTTPRequestHandler):
    calls: list[dict] = []
    responses: dict[str, list[tuple[int, dict, dict]]] = {}

    def log_message(self, *args):  # silencia o servidor
        pass

    def _handle(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(length) or b"null") if length else None
        FakeApi.calls.append({"method": self.command, "path": self.path, "body": body, "headers": dict(self.headers)})
        queue = FakeApi.responses.get(f"{self.command} {self.path}") or [(404, {"status": "nao_encontrado"}, {})]
        status, payload, headers = queue.pop(0) if len(queue) > 1 else queue[0]
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        for k, v in headers.items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    do_GET = do_POST = _handle


class ClientTest(unittest.TestCase):
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
        os.environ["MKTECH_CRM_TOKEN"] = TOKEN
        os.environ["MKTECH_CRM_ENV_FILE"] = os.devnull
        mktech_crm.MIN_INTERVAL_SECONDS = 0
        self._sleep = mktech_crm.time.sleep
        mktech_crm.time.sleep = lambda s: None
        self.tmp = tempfile.TemporaryDirectory()

    def tearDown(self):
        mktech_crm.time.sleep = self._sleep
        self.tmp.cleanup()

    def run_cli(self, *argv):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = mktech_crm.main(list(argv))
        return code, json.loads(out.getvalue().strip().splitlines()[-1]), err.getvalue()

    def candidate_file(self, **extra):
        cand = {"business_name": "Clínica Teste Bela", "city": "Bauru", "state": "SP", "phone": "(14) 99999-0000", **extra}
        path = Path(self.tmp.name) / "c.json"
        path.write_text(json.dumps(cand), encoding="utf-8")
        return str(path)

    def test_settings_sends_bearer_token(self):
        FakeApi.responses["GET /api/hermes/v1/settings"] = [(200, {"settings": {"routine_enabled": False}}, {})]
        code, out, _ = self.run_cli("selftest")
        self.assertEqual(code, 0)
        self.assertTrue(out["ok"])
        self.assertEqual(FakeApi.calls[0]["headers"]["Authorization"], f"Bearer {TOKEN}")

    def test_start_run_refuses_when_routine_paused(self):
        FakeApi.responses["GET /api/hermes/v1/settings"] = [(200, {"settings": {"routine_enabled": False}}, {})]
        code, out, _ = self.run_cli("start-run")
        self.assertEqual(code, mktech_crm.EXIT_BLOCKED)
        self.assertFalse(any(c["method"] == "POST" for c in FakeApi.calls))

    def test_manual_run_allowed_while_paused(self):
        FakeApi.responses["GET /api/hermes/v1/settings"] = [(200, {"settings": {"routine_enabled": False, "daily_target": 20}}, {})]
        FakeApi.responses["POST /api/hermes/v1/runs"] = [(201, {"status": "iniciada", "run_id": "r1"}, {})]
        code, out, _ = self.run_cli("start-run", "--manual")
        self.assertEqual(code, 0)
        self.assertTrue(FakeApi.calls[-1]["body"]["config"]["manual"])

    def test_register_uses_stable_idempotency_key(self):
        FakeApi.responses["POST /api/hermes/v1/candidates"] = [(201, {"status": "criado", "lead_id": "x"}, {})]
        f = self.candidate_file()
        self.run_cli("register", "--run", "r1", "--file", f)
        self.run_cli("register", "--run", "r1", "--file", f)
        k1, k2 = (c["headers"]["Idempotency-Key"] for c in FakeApi.calls)
        self.assertEqual(k1, k2)
        self.assertTrue(k1.startswith("hermes-"))

    def test_approach_pending_count(self):
        FakeApi.responses["GET /api/hermes/v1/approach/pending?limit=20"] = [(200, {"status": "ok", "leads": [{"lead_id": "a"}, {"lead_id": "b"}]}, {})]
        code, out, _ = self.run_cli("approach-pending", "--limit", "50", "--count")
        self.assertEqual(code, 0)
        self.assertEqual(out["pending"], 2)

    def test_approach_save_posts_and_reports_rejection(self):
        lead = "11111111-2222-4333-8444-555555555555"
        path = Path(self.tmp.name) / "a.json"
        path.write_text(json.dumps({"alerta": None, "variantes": [{"estilo": "consultiva", "mensagem": "Olá, Ana! Como você agenda hoje?", "risco": "baixo"}]}), encoding="utf-8")
        FakeApi.responses[f"POST /api/hermes/v1/approach/{lead}"] = [(422, {"status": "invalido", "errors": ["Envie exatamente 3 variantes"]}, {})]
        code, out, _ = self.run_cli("approach-save", "--lead", lead, "--file", str(path))
        self.assertEqual(code, mktech_crm.EXIT_INVALID)
        self.assertEqual(out["errors"], ["Envie exatamente 3 variantes"])
        self.assertEqual(FakeApi.calls[0]["body"]["variantes"][0]["mensagem"], "Olá, Ana! Como você agenda hoje?")

    def test_approach_save_rejects_bad_lead_id(self):
        code, _, _ = self.run_cli("approach-save", "--lead", "../runs", "--file", self.candidate_file())
        self.assertEqual(code, mktech_crm.EXIT_INVALID)
        self.assertEqual(FakeApi.calls, [])

    def test_retries_on_503_then_succeeds(self):
        FakeApi.responses["POST /api/hermes/v1/candidates"] = [
            (503, {"status": "falha_temporaria"}, {"Retry-After": "1"}),
            (201, {"status": "criado"}, {}),
        ]
        code, out, _ = self.run_cli("register", "--run", "r1", "--file", self.candidate_file())
        self.assertEqual(code, 0)
        self.assertEqual(len(FakeApi.calls), 2)

    def test_gives_up_after_max_attempts(self):
        FakeApi.responses["POST /api/hermes/v1/candidates"] = [(503, {"status": "falha_temporaria"}, {})]
        code, _, _ = self.run_cli("register", "--run", "r1", "--file", self.candidate_file())
        self.assertEqual(code, mktech_crm.EXIT_TEMPORARY)
        self.assertEqual(len(FakeApi.calls), mktech_crm.MAX_ATTEMPTS)

    def test_limit_reached_exit_code(self):
        FakeApi.responses["POST /api/hermes/v1/candidates"] = [(409, {"status": "limite_atingido"}, {})]
        code, _, _ = self.run_cli("register", "--run", "r1", "--file", self.candidate_file())
        self.assertEqual(code, mktech_crm.EXIT_LIMIT)

    def test_invalid_and_unauthorized(self):
        FakeApi.responses["POST /api/hermes/v1/candidates"] = [(422, {"status": "invalido", "errors": ["x"]}, {})]
        code, _, _ = self.run_cli("register", "--run", "r1", "--file", self.candidate_file())
        self.assertEqual(code, mktech_crm.EXIT_INVALID)
        FakeApi.responses["GET /api/hermes/v1/settings"] = [(403, {"status": "nao_autorizado"}, {})]
        code, _, _ = self.run_cli("settings")
        self.assertEqual(code, mktech_crm.EXIT_CONFIG)

    def test_network_failure_registers_nothing(self):
        os.environ["MKTECH_CRM_URL"] = "http://127.0.0.1:9"  # porta fechada
        code, out, _ = self.run_cli("register", "--run", "r1", "--file", self.candidate_file())
        self.assertEqual(code, mktech_crm.EXIT_TEMPORARY)
        self.assertEqual(out["status"], "falha_temporaria")
        self.assertEqual(FakeApi.calls, [])

    def test_token_never_logged(self):
        FakeApi.responses["POST /api/hermes/v1/candidates"] = [(503, {"status": "falha_temporaria"}, {})]
        mktech_crm.log(f"teste {TOKEN}")
        _, out, err = self.run_cli("register", "--run", "r1", "--file", self.candidate_file())
        self.assertNotIn(TOKEN, err)
        self.assertNotIn(TOKEN, json.dumps(out))

    def test_missing_config(self):
        os.environ["MKTECH_CRM_TOKEN"] = ""
        with self.assertRaises(SystemExit) as ctx, contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            mktech_crm.main(["settings"])
        self.assertEqual(ctx.exception.code, mktech_crm.EXIT_CONFIG)

    def test_finish_sends_reason(self):
        FakeApi.responses["POST /api/hermes/v1/runs/r1/finish"] = [(200, {"status": "encerrada"}, {})]
        code, _, _ = self.run_cli(
            "finish", "--run", "r1", "--status", "falhou", "--searched", "0", "--approved", "0",
            "--discarded", "0", "--errors", "1", "--end-reason", "sem provedor de busca",
        )
        self.assertEqual(code, 0)
        body = FakeApi.calls[0]["body"]
        self.assertEqual(body["status"], "falhou")
        self.assertEqual(body["end_reason"], "sem provedor de busca")

    def test_check_only_sends_identifiers(self):
        FakeApi.responses["POST /api/hermes/v1/duplicates/check"] = [(200, {"status": "novo"}, {})]
        f = self.candidate_file(evidences=[{"url": "https://x"}], notes="algo")
        self.run_cli("check", "--file", f)
        self.assertNotIn("evidences", FakeApi.calls[0]["body"])
        self.assertNotIn("notes", FakeApi.calls[0]["body"])


if __name__ == "__main__":
    unittest.main()
