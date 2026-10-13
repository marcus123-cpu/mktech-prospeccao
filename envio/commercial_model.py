"""Inferência isolada: sem ferramentas, credenciais ou memória global nos contextos."""
import json
import os
import subprocess
from copy import deepcopy
from pathlib import Path


class InferenceError(RuntimeError):
    pass


def normalize_sources(proposal, context):
    """Resolve apenas UUID vs UUID:sufixo do mesmo histórico; não altera texto/fatos."""
    resolved = deepcopy(proposal)
    pending = {item.get('id') for item in context.get('pending_messages', [])}
    aliases = {}
    for item in context.get('messages', []):
        key = item.get('id')
        if item.get('direction') == 'entrada' and isinstance(key, str) and ':' in key:
            raw = key.split(':', 1)[0]
            if raw not in pending:
                aliases[raw] = key
    for fact in resolved.get('confirmed_facts', []) if isinstance(resolved.get('confirmed_facts'), list) else []:
        if isinstance(fact, dict) and isinstance(fact.get('source_id'), str):
            fact['source_id'] = aliases.get(fact['source_id'], fact['source_id'])
    if isinstance(resolved.get('source_ids'), list):
        resolved['source_ids'] = [aliases.get(key, key) if isinstance(key, str) else key for key in resolved['source_ids']]
    return resolved


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
        return {'proposal': normalize_sources(payload['result'],context), 'model': payload['model']}
    except (ValueError, TypeError, AttributeError):
        raise InferenceError('invalid_model_output') from None
