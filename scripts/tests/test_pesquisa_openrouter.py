import importlib.util
import io
import json
import unittest
from pathlib import Path
from unittest.mock import patch

script = Path(__file__).resolve().parents[1] / "pesquisa-openrouter.py"
spec = importlib.util.spec_from_file_location("pesquisa_openrouter", script)
research = importlib.util.module_from_spec(spec)
spec.loader.exec_module(research)


def candidate():
    return {
        "business_name": "Clínica Exemplo", "city": "Campinas", "phone": "(19) 99999-1234",
        "whatsapp_url": "https://wa.me/5519999991234", "site_status": "apenas_redes_sociais",
        "services": ["limpeza de pele"],
        "evidences": [
            {"kind": "instagram", "url": "https://instagram.com/exemplo", "observed_at": "2026-10-15",
             "summary": "Clínica Exemplo em Campinas, limpeza de pele, agenda pelo WhatsApp"},
            {"kind": "google", "url": "https://maps.google.com/exemplo", "observed_at": "2026-10-15",
             "summary": "Clínica Exemplo em Campinas, limpeza de pele; página própria não localizada"},
        ],
        "diagnosis": {"fit_score": 75, "confidence": "media", "offer": "landing_page",
                      "pains": [{"pain": "Sem página de apresentação", "evidence": "página própria não localizada"}]},
    }


class ResearchValidationTests(unittest.TestCase):
    def test_missing_owned_page_accepted_with_two_sources(self):
        self.assertTrue(research.validate_candidate(candidate(), "Campinas", "2026-10-15"))

    def test_existing_site_small_fix_rejected(self):
        item = candidate()
        item["site_status"] = "site_proprio_encontrado"
        item["website_url"] = "https://clinica.example.com"
        self.assertFalse(research.validate_candidate(item, "Campinas", "2026-10-15"))

    def test_wrong_city_and_one_source_rejected(self):
        self.assertFalse(research.validate_candidate(candidate(), "Santos", "2026-10-15"))
        item = candidate()
        item["evidences"].pop()
        self.assertFalse(research.validate_candidate(item, "Campinas", "2026-10-15"))

    def test_private_url_rejected(self):
        self.assertFalse(research.public_url("http://127.0.0.1/secret"))
        self.assertFalse(research.public_url("http://localhost/"))

    def test_openrouter_search_is_capped_and_counted(self):
        response = {"usage": {"server_tool_use": {"web_search_requests": 2}},
                    "choices": [{"message": {"content": '{"candidates":[]}'}}]}
        with patch.object(research.urllib.request, "urlopen", return_value=io.BytesIO(json.dumps(response).encode())) as call:
            candidates, count = research.query_openrouter("Campinas", "estética", [], "test/model", "test-key")
        self.assertEqual((candidates, count), ([], 2))
        body = json.loads(call.call_args.args[0].data)
        self.assertEqual(body["tools"][0]["parameters"]["max_uses"], 4)
        self.assertEqual(body["max_tool_calls"], 4)
        self.assertNotIn("test-key", json.dumps(body))

    def test_no_recorded_web_search_cannot_create_lead(self):
        response = {"usage": {}, "choices": [{"message": {"content": '{"candidates":[{}]}'}}]}
        with patch.object(research.urllib.request, "urlopen", return_value=io.BytesIO(json.dumps(response).encode())):
            with self.assertRaisesRegex(RuntimeError, "não confirmou buscas"):
                research.query_openrouter("Campinas", "estética", [], "test/model", "test-key")


if __name__ == "__main__":
    unittest.main()
