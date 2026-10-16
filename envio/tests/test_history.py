import sys
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import mktech_envio as sender


class HistoryTests(unittest.TestCase):
    def test_ack_only_after_persistence_and_stop_on_failure(self):
        class Transport(sender.Transporte):
            acked = []
            def historico(self):
                return [{"message_id": str(i), "event_id": str(i)} for i in range(3)]
            def ack(self, message):
                self.acked.append(message["message_id"])
        transport = Transport()
        with patch.object(sender, "request", side_effect=[(201, {"status": "registrada"}), (503, {})]) as request:
            self.assertEqual(sender.forward_history(transport), 1)
        self.assertEqual(transport.acked, ["0"])
        self.assertEqual(request.call_count, 2)
        self.assertTrue(all(call.args[1] == "/api/hermes/v1/envio/historico" for call in request.call_args_list))
