"""Transporte V4 simulado; nenhuma integração externa é chamada."""
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import mktech_envio as sender

class FakeV4(sender.Transporte):
    def __init__(self,fail=False,ready=True):
        self.fail=fail
        self.ready=ready
        self.sent=[]
        self.acked=[]
    def pronto(self):return self.ready
    def comercial(self,item):
        self.sent.append(item)
        if self.fail:raise TimeoutError('Sem confirmação')
        return {'message_status':'enviada','id':'wa-id'}
    def ack(self,item):self.acked.append(item)

class V4Tests(unittest.TestCase):
    def test_video_uses_exact_reserved_asset(self):
        transport=FakeV4()
        item={'status':'enviar','id':'item-1','etapa':'comercial','telefone':'+5517991234567','texto':'Perfeito! Este vídeo mostra a ideia.','media':'video','asset':'demo'}
        with patch.object(sender,'request',return_value=(200,item)),patch.object(sender,'report') as report:
            status,_=sender.step(transport)
            self.assertEqual(status,'enviada')
            self.assertEqual(transport.sent[0]['asset'],'demo')
            self.assertEqual(report.call_args.kwargs['provider_id'],'wa-id')
    def test_timeout_never_retries_transport(self):
        transport=FakeV4(fail=True)
        item={'status':'enviar','id':'item-1','etapa':'comercial','telefone':'+5517991234567','texto':'Olá, posso apresentar uma ideia?'}
        with patch.object(sender,'request',return_value=(200,item)),patch.object(sender,'report') as report:
            status,_=sender.step(transport)
            self.assertEqual(status,'desconhecido')
            self.assertEqual(len(transport.sent),1)
            self.assertEqual(report.call_args.kwargs['message_status'],'desconhecido')
    def test_disconnect_does_not_reserve(self):
        with patch.object(sender,'request') as request:
            self.assertEqual(sender.step(FakeV4(ready=False))[0],'ponte_desconectada')
            request.assert_not_called()
    def test_explicit_rejection_is_failed_not_unknown(self):
        transport=FakeV4()
        transport.comercial=lambda item: (_ for _ in ()).throw(sender.BridgeRejected('Vídeo não configurado; nada enviado'))
        item={'status':'enviar','id':'item-1','etapa':'comercial','telefone':'+5517991234567','texto':'Posso apresentar uma ideia?'}
        with patch.object(sender,'request',return_value=(200,item)),patch.object(sender,'report') as report:
            self.assertEqual(sender.step(transport)[0],'falhou')
            self.assertEqual(report.call_args.kwargs['message_status'],'falhou')
    def test_input_only_ack_after_durable_server_confirmation(self):
        transport=FakeV4()
        transport.recebidas=lambda:[{'telefone':'+5517991234567','texto':'Pode mandar','message_id':'wa-in','event_id':'wa-in'}]
        with patch.object(sender,'request',return_value=(503,{'status':'falha_temporaria'})):
            sender.forward_replies(transport)
            self.assertEqual(transport.acked,[])
        with patch.object(sender,'request',return_value=(200,{'status':'existente'})) as request:
            sender.forward_replies(transport)
            self.assertEqual(transport.acked[0]['message_id'],'wa-in')
            self.assertEqual(request.call_args.args[2]['message_id'],'wa-in')

if __name__=='__main__':unittest.main()
