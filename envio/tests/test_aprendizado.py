import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ENVIO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ENVIO))
spec = importlib.util.spec_from_file_location("aprendizado_loop", ENVIO / "aprendizado-loop.py")
ap = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ap)


class Fake:
    """CRM falso: guarda o que o estudante envia."""
    def __init__(self, state, conversations):
        self.state, self.conversations, self.saved = state, conversations, []

    def request(self, method, path, body=None):
        if path.endswith("/estado"):
            return 200, self.state
        if path.endswith("/dia"):
            return 200, {"day": body["day"], "stats": {"leads": len(self.conversations)}, "conversations": self.conversations}
        if path.endswith("/salvar"):
            self.saved.append(body)
            return 200, {"status": "ok", "added": len(body.get("additions", []))}
        return 404, {}


STATE = {"status": "aprendendo", "started_on": "2026-10-16", "today": "2026-10-17", "saved_days": [], "study_requested": False,
         "playbook": "", "has_final": False}


class Estudante(unittest.TestCase):
    def run_step(self, state, conversations, proposal, hour=22):
        fake = Fake(state, conversations)
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(ap, "request", fake.request), \
                mock.patch.object(ap, "infer", return_value={"proposal": proposal}) as model, \
                mock.patch.object(ap, "OUT", Path(tmp)), \
                mock.patch.object(ap, "agora", return_value=ap.datetime(2026, 10, 17, hour, 0, tzinfo=ap.BRT)):
            ap.step()
            return fake, model

    def test_estuda_dia_passado_e_hoje_depois_das_21h(self):
        convs = [{"lead": "Clínica", "events": [{"who": "VOCÊ", "text": "Oi, Dani! Tudo bem?"}]}]
        fake, model = self.run_step(STATE, convs, {"notes": "Chama pelo nome.", "additions": [{"section": "Como chama o lead (nome)", "rule": "Chama pelo primeiro nome.", "example": None}]})
        self.assertEqual([s["day"] for s in fake.saved], ["2026-10-16", "2026-10-17"])
        self.assertEqual(model.call_count, 2)
        self.assertEqual(fake.saved[0]["additions"][0]["section"], "Como chama o lead (nome)")

    def test_hoje_so_depois_das_21h(self):
        fake, _ = self.run_step({**STATE, "saved_days": ["2026-10-16"]}, [], {}, hour=15)
        self.assertEqual(fake.saved, [])

    def test_botao_estudar_agora_adianta_hoje(self):
        fake, _ = self.run_step({**STATE, "saved_days": ["2026-10-16"], "study_requested": True}, [], {}, hour=15)
        self.assertEqual([s["day"] for s in fake.saved], ["2026-10-17"])

    def test_dia_sem_conversa_nao_chama_o_modelo(self):
        fake, model = self.run_step({**STATE, "saved_days": ["2026-10-16"]}, [], {})
        self.assertEqual(model.call_count, 0)
        self.assertEqual(fake.saved[0]["notes"], "Sem conversas neste dia.")

    def test_parado_fora_do_modo_aprendendo(self):
        fake, model = self.run_step({**STATE, "status": "concluido"}, [], {})
        self.assertEqual(fake.saved, [])
        self.assertEqual(model.call_count, 0)


if __name__ == "__main__":
    unittest.main()
