"""Inferência isolada: sem ferramentas, credenciais ou memória global nos contextos."""
import json
import os
import subprocess
import urllib.error
import urllib.request
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
    if os.environ.get('MKTECH_COMMERCIAL_PROVIDER', '').lower() == 'openrouter':
        return infer_openrouter(system, context, timeout)
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
        # O adaptador só devolve um código de classe, nunca a resposta, prompt ou
        # detalhes de autenticação. Isso permite diagnosticar indisponibilidade
        # sem expor conteúdo comercial no log do worker.
        try:
            failure = json.loads(result.stdout).get('error_type')
        except (ValueError, TypeError, AttributeError):
            failure = None
        raise InferenceError(f'inference_failed:{failure}' if isinstance(failure, str) else 'inference_failed')
    try:
        payload = json.loads(result.stdout)
        if not isinstance(payload.get('result'), dict) or payload.get('tools_enabled') != 0:
            raise ValueError()
        if not isinstance(payload.get('model'), str) or not payload['model']:
            raise ValueError()
        return {'proposal': normalize_sources(payload['result'],context), 'model': payload['model']}
    except (ValueError, TypeError, AttributeError):
        raise InferenceError('invalid_model_output') from None


def infer_openrouter(system, context, timeout=70):
    """Inferência comercial direta, isolada por requisição e sem ferramentas."""
    key = os.environ.get('OPENROUTER_API_KEY', '').strip()
    model = os.environ.get('MKTECH_COMMERCIAL_MODEL', '').strip()
    if not key or not model:
        raise InferenceError('runtime_unavailable')
    body = json.dumps({
        'model': model,
        'messages': [
            {'role': 'system', 'content': system},
            {'role': 'user', 'content': json.dumps(context, ensure_ascii=False)},
        ],
        'response_format': {'type': 'json_object'},
        'max_completion_tokens': 3500,
        'stream': False,
    }, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(
        'https://openrouter.ai/api/v1/chat/completions', data=body, method='POST',
        headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json',
                 'HTTP-Referer': 'https://mktech-prospeccao.vercel.app',
                 'X-Title': 'MKTech Hermes Prospector'},
    )
    try:
        with urllib.request.urlopen(req, timeout=min(timeout, 70)) as response:
            raw = response.read(131073)
    except urllib.error.HTTPError as error:
        # Apenas o código HTTP vai ao log; o corpo pode conter dados privados.
        raise InferenceError(f'inference_failed:HTTP{error.code}') from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise InferenceError('inference_failed:network') from None
    if len(raw) > 131072:
        raise InferenceError('invalid_model_output')
    try:
        result = json.loads(raw)
        message = result['choices'][0]['message']
        content = message['content']
        if not isinstance(content, str):
            raise ValueError()
        proposal = json.loads(content)
        if not isinstance(proposal, dict):
            raise ValueError()
        return {'proposal': normalize_sources(proposal, context), 'model': model}
    except (KeyError, IndexError, ValueError, TypeError, UnicodeError):
        raise InferenceError('invalid_model_output') from None
