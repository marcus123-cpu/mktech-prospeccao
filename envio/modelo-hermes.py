"""Adaptador de inferência isolada: contexto recebido por stdin, JSON por stdout.

Usa credenciais e modelo do runtime Hermes instalado. Sem ferramentas, memória
pessoal, arquivos de contexto ou sessão compartilhada entre clientes.
"""
import contextlib
import io
import json
import os
from pathlib import Path
import sys


def main():
    payload = json.load(sys.stdin)
    if not isinstance(payload, dict) or not isinstance(payload.get('system'), str) or not isinstance(payload.get('context'), dict):
        raise ValueError('Entrada de inferência inválida')
    configured = os.environ.get('HERMES_RUNTIME_ROOT')
    root = Path(configured) if configured else Path(os.environ.get('LOCALAPPDATA', Path.home())) / 'hermes' / 'hermes-agent'
    if not (root / 'run_agent.py').is_file():
        raise RuntimeError('Runtime Hermes indisponível')
    os.environ.setdefault('HERMES_HOME', str(root.parent))
    # Não herdar identidade de outra execução nem ferramentas de um dispatcher.
    os.environ.pop('HERMES_KANBAN_TASK', None)
    sys.path.insert(0, str(root))
    agent = None
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        from hermes_cli.config import load_config
        from hermes_cli.runtime_provider import resolve_runtime_provider
        from run_agent import AIAgent
        cfg = load_config()
        model_config = cfg.get('model') or {}
        model = os.environ.get('MKTECH_COMMERCIAL_MODEL') or os.environ.get('HERMES_COMMERCIAL_MODEL') or (model_config if isinstance(model_config, str) else model_config.get('default') or model_config.get('model'))
        if not isinstance(model, str) or not model:
            raise RuntimeError('Modelo Hermes não configurado')
        runtime = resolve_runtime_provider(target_model=model)
        try:
            agent = AIAgent(
                model=model, api_key=runtime.get('api_key'), base_url=runtime.get('base_url'),
                provider=runtime.get('provider'), requested_provider=runtime.get('requested_provider'),
                api_mode=runtime.get('api_mode'), credential_pool=runtime.get('credential_pool'),
                enabled_toolsets=[], quiet_mode=True, max_iterations=1,
                skip_context_files=True, load_soul_identity=False, skip_memory=True,
                skip_background_review=True, save_trajectories=False, run_budget_seconds=100,
                max_tokens=3500, platform='mktech-commercial',
            )
            if agent.tools:
                raise RuntimeError('Inferência comercial deve ficar sem ferramentas')
            result = agent.run_conversation(
                json.dumps(payload['context'], ensure_ascii=False),
                system_message=payload['system'], conversation_history=[],
            )
            if result.get('failed') or result.get('partial'):
                # Código estável para diagnóstico local; não propaga o texto do
                # provedor, que pode conter detalhes operacionais.
                raise RuntimeError('agent_run_failed')
            response = result.get('final_response') or ''
            if response.startswith('```'):
                response = response.split('\n', 1)[1].rsplit('```', 1)[0].strip()
            parsed = json.loads(response)
            if not isinstance(parsed, dict):
                raise ValueError('Modelo não retornou objeto JSON')
        finally:
            if agent is not None:
                agent.close()
    print(json.dumps({'result': parsed, 'model': model, 'provider': runtime.get('provider'), 'tools_enabled': 0}, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        # Não ecoar prompts, respostas, detalhes HTTP ou credenciais em logs.
        stage = str(exc) if str(exc) in {'agent_run_failed'} else None
        print(json.dumps({'error': 'inference_failed', 'error_type': type(exc).__name__, 'stage': stage}))
        sys.exit(1)
