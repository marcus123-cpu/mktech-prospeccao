import sys
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import mktech_envio as sender

class VoiceTests(unittest.TestCase):
    def test_voice_queue_uses_voice_transport_and_reports_provider(self):
        class Voice(sender.Transporte):
            def enviar_voz(self,item): return 'ptt-id'
            def enviar(self,*args): raise AssertionError('voice sent as text')
        item={'status':'enviar','id':'queue-id','telefone':'+5511999999999','media':'audio'}
        with patch.object(sender,'request',side_effect=[(200,item),(200,{'status':'registrado'})]) as request:
            self.assertEqual(sender.send_manual_reply(Voice()),'enviado')
        self.assertEqual(request.call_args.args[2],{'ok':True,'provider_id':'ptt-id'})

    def test_failed_voice_is_not_reported_as_sent(self):
        class Voice(sender.Transporte):
            def enviar_voz(self,item): raise RuntimeError('conversion failed')
        item={'status':'enviar','id':'queue-id','telefone':'+5511999999999','media':'audio'}
        with patch.object(sender,'request',side_effect=[(200,item),(200,{'status':'registrado'})]) as request:
            self.assertEqual(sender.send_manual_reply(Voice()),'falhou')
        self.assertFalse(request.call_args.args[2]['ok'])
