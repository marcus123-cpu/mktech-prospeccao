import json
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from commercial_model import infer, InferenceError, normalize_sources


class ModelIsolationTests(unittest.TestCase):
    def test_source_alias_changes_only_existing_history_reference(self):
        proposal={'response':'Texto original','confirmed_facts':[{'source_id':'old','evidence':'trecho literal'}],'source_ids':['old','other']}
        context={'messages':[{'id':'old:cliente','direction':'entrada','body':'trecho literal'}]}
        value=normalize_sources(proposal,context)
        self.assertEqual(value['confirmed_facts'][0]['source_id'],'old:cliente')
        self.assertEqual(value['confirmed_facts'][0]['evidence'],'trecho literal')
        self.assertEqual(value['response'],'Texto original')
        self.assertEqual(value['source_ids'],['old:cliente','other'])
        self.assertEqual(proposal['source_ids'],['old','other'])

    def test_pending_reference_and_other_client_remain_unmodified(self):
        p={'source_ids':['current','unknown']}
        c={'pending_messages':[{'id':'current'}],'messages':[{'id':'current:cliente','direction':'entrada'}]}
        self.assertEqual(normalize_sources(p,c),p)

    def call(self, result):
        with patch('commercial_model.Path.is_file', return_value=True), patch('commercial_model.subprocess.run', return_value=result) as run:
            value = infer('policy', {'lead_id': 'only-one'})
            args = run.call_args
            self.assertEqual(json.loads(args.kwargs['input'])['context'], {'lead_id': 'only-one'})
            self.assertTrue(args.kwargs['capture_output'])
            self.assertEqual(args.kwargs['timeout'], 115)
            return value

    def test_valid_isolated_result(self):
        result = subprocess.CompletedProcess([], 0, json.dumps({'result': {'action': 'wait'}, 'model': 'configured-model', 'tools_enabled': 0}), '')
        self.assertEqual(self.call(result)['proposal'], {'action': 'wait'})

    def test_tool_enabled_output_rejected(self):
        result = subprocess.CompletedProcess([], 0, json.dumps({'result': {}, 'model': 'x', 'tools_enabled': 1}), '')
        with self.assertRaisesRegex(InferenceError, 'invalid_model_output'):
            self.call(result)

    def test_failure_does_not_expose_stderr(self):
        result = subprocess.CompletedProcess([], 1, 'private credentials', 'secret')
        with self.assertRaisesRegex(InferenceError, '^inference_failed$'):
            self.call(result)

    def test_invalid_json_rejected(self):
        with self.assertRaisesRegex(InferenceError, 'invalid_model_output'):
            self.call(subprocess.CompletedProcess([], 0, 'not json', ''))

    def test_timeout_has_no_fallback(self):
        with patch('commercial_model.Path.is_file', return_value=True), patch('commercial_model.subprocess.run', side_effect=subprocess.TimeoutExpired('adapter', 115)):
            with self.assertRaisesRegex(InferenceError, '^inference_timeout$'):
                infer('policy', {})


if __name__ == '__main__':
    unittest.main()
