import importlib.util
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
spec=importlib.util.spec_from_file_location('commercial_worker',Path(__file__).resolve().parents[1]/'comercial-loop.py')
worker=importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)

class WorkerRepairTests(unittest.TestCase):
    context={'lease_id':'lease','first_contact':False,'pending_messages':[{'id':'message','body':'Pode falar por aqui'}]}
    model={'proposal':{'action':'respond'},'model':'configured-model'}

    def test_one_repair_uses_same_context_and_trusted_validation_feedback(self):
        with patch.object(worker,'infer',return_value=self.model) as infer,patch.object(worker,'log'),patch.object(worker,'request',side_effect=[(200,{'status':'validacao_recusada','errors':['Fato sem fonte literal válida']}),(200,{'status':'registrado'})]) as request:
            self.assertEqual(worker.process_context('policy',self.context)['status'],'registrado')
            self.assertEqual(infer.call_count,2)
            second=infer.call_args_list[1].args[1]
            self.assertEqual(second['pending_messages'],self.context['pending_messages'])
            self.assertEqual(second['validation_feedback']['errors'],['Fato sem fonte literal válida'])
            self.assertEqual([call.args[2]['lease_id'] for call in request.call_args_list],['lease','lease'])

    def test_repair_limit_reports_failure_without_third_model_call(self):
        with patch.object(worker,'infer',return_value=self.model) as infer,patch.object(worker,'log'),patch.object(worker,'request',side_effect=[(422,{'status':'invalido','errors':['schema']}),(422,{'status':'invalido','errors':['schema']}),(200,{'status':'aguardar'})]) as request:
            worker.process_context('policy',self.context)
            self.assertEqual(infer.call_count,2)
            self.assertEqual(request.call_args.args[2],{'lease_id':'lease','failure':'invalid_model_output'})

    def test_new_message_invalidates_lease_without_repair_or_send(self):
        with patch.object(worker,'infer',return_value=self.model) as infer,patch.object(worker,'log'),patch.object(worker,'request',return_value=(409,{'status':'desatualizada'})):
            self.assertEqual(worker.process_context('policy',self.context)['http'],409)
            self.assertEqual(infer.call_count,1)

    def test_ai_outage_has_no_text_fallback(self):
        with patch.object(worker,'infer',side_effect=worker.InferenceError('inference_timeout')) as infer,patch.object(worker,'log'),patch.object(worker,'request',return_value=(200,{'status':'aguardar'})) as request:
            worker.process_context('policy',self.context)
            self.assertEqual(infer.call_count,1)
            self.assertEqual(request.call_args.args[2],{'lease_id':'lease','failure':'inference_timeout'})

    def test_greeting_does_not_call_model(self):
        with patch.object(worker,'infer') as infer,patch.object(worker,'log'),patch.object(worker,'request',return_value=(200,{'status':'registrado'})) as request:
            worker.process_context('policy',{'lease_id':'lease','first_contact':True})
            infer.assert_not_called()
            self.assertEqual(request.call_args.args[2],{'lease_id':'lease'})

    def test_missing_v6_endpoint_never_falls_back_to_scripted_v4(self):
        with patch.object(worker,'request',return_value=(404,{'status':'ausente'})) as request:
            self.assertEqual(worker.step()[0],404)
            self.assertEqual(request.call_count,1)

if __name__=='__main__':unittest.main()
