"""Inferência isolada: sem ferramentas, credenciais ou memória global nos contextos."""
import json
import os
import subprocess
from pathlib import Path


class InferenceError(RuntimeError):
    pass


def infer(system, context, timeout=115):
    root = Path(os.environ.get('HERMES_RUNTIME_ROOT', str(Path(os.environ.get('LOCALAPPDATA', '')) / 'hermes' / 'hermes-agent')))
    python = root / '.venv' / 'Scripts' / 'python.exe'
    if not python.is_file():
        raise InferenceError('runtime_unavailable')
    adapter = Path(__file__).with_name('modelo-hermes.py')
    try:
        result = subprocess.run(
            [str(python), str(adapter)],
            input=json.dumps({'system': system, 'context': context}, ensure_ascii=False),
            capture_output=True, text=True, encoding='utf-8', timeout=timeout,
            env={**os.environ, 'PYTHONIOENCODING': 'utf-8'},
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
        )
    except subprocess.TimeoutExpired:
        # subprocess.run mata e aguarda somente o processo criado por esta chamada.
        raise InferenceError('inference_timeout') from None
    except OSError:
        raise InferenceError('runtime_unavailable') from None
    if result.returncode != 0 or len(result.stdout) > 131072:
        raise InferenceError('inference_failed')
    try:
        payload = json.loads(result.stdout)
        if not isinstance(payload.get('result'), dict) or payload.get('tools_enabled') != 0:
            raise ValueError()
        if not isinstance(payload.get('model'), str) or not payload['model']:
            raise ValueError()
        return {'proposal': payload['result'], 'model': payload['model']}
    except (ValueError, TypeError, AttributeError):
        raise InferenceError('invalid_model_output') from None
