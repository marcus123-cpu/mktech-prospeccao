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
    def test_simulated_diagnosis_is_commercial_text_not_debug_dump(self):
        text='Sou o assistente comercial da MKTech Dev. No diagnóstico demonstrativo e simulado da Clínica Teste, constam limpeza de pele e avaliação facial.'
        self.assertEqual(sender.safe_text(text),text)
        self.assertIsNone(sender.safe_text('Diagnóstico: dados técnicos do lead'))
        self.assertIsNone(sender.safe_text('{"diagnostico": "privado"}'))
    def test_video_uses_exact_reserved_asset(self):
        transport=FakeV4()
        item={'status':'enviar','id':'item-1','etapa':'comercial','telefone':'+5517991234567','texto':'Perfeito! Este vídeo mostra a ideia.','media':'video','asset':'demo'}
        with patch.object(sender,'send_manual_reply',return_value=None),patch.object(sender,'request',return_value=(200,item)),patch.object(sender,'report') as report:
            status,_=sender.step(transport)
            self.assertEqual(status,'enviada')
            self.assertEqual(transport.sent[0]['asset'],'demo')
            self.assertEqual(report.call_args.kwargs['provider_id'],'wa-id')
    def test_timeout_never_retries_transport(self):
        transport=FakeV4(fail=True)
        item={'status':'enviar','id':'item-1','etapa':'comercial','telefone':'+5517991234567','texto':'Olá, posso apresentar uma ideia?'}
        with patch.object(sender,'send_manual_reply',return_value=None),patch.object(sender,'request',return_value=(200,item)),patch.object(sender,'report') as report:
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
        with patch.object(sender,'send_manual_reply',return_value=None),patch.object(sender,'request',return_value=(200,item)),patch.object(sender,'report') as report:
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


class ManualReplyTests(unittest.TestCase):
    def test_manual_reply_is_sent_without_technical_filter_and_reported(self):
        item = {'status': 'enviar', 'id': 'abc', 'telefone': '+5511999999999', 'texto': 'Veja https://exemplo.com e o status do pedido'}
        transport = unittest.mock.Mock(nome='teste')
        transport.enviar.return_value = 'wa-1'
        with patch.object(sender, 'request', side_effect=[(200, item), (200, {'status': 'registrado'})]) as request:
            self.assertEqual(sender.send_manual_reply(transport), 'enviado')
        transport.enviar.assert_called_once_with('+5511999999999', item['texto'])
        self.assertEqual(request.call_args.args[2], {'ok': True, 'provider_id': 'wa-1'})

    def test_manual_failure_is_reported_and_not_retried(self):
        item = {'status': 'enviar', 'id': 'abc', 'telefone': '+5511999999999', 'texto': 'Oi'}
        transport = unittest.mock.Mock(nome='teste')
        transport.enviar.side_effect = RuntimeError('ponte fora do ar')
        with patch.object(sender, 'request', side_effect=[(200, item), (200, {'status': 'registrado'})]) as request:
            self.assertEqual(sender.send_manual_reply(transport), 'falhou')
        self.assertFalse(request.call_args.args[2]['ok'])
        transport.enviar.assert_called_once()

    def test_nothing_queued_returns_none(self):
        with patch.object(sender, 'request', return_value=(200, {'status': 'nenhum'})):
            self.assertIsNone(sender.send_manual_reply(unittest.mock.Mock()))
