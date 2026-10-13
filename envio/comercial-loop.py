"""Worker V4. Usa token mensagens:escrever; não envia diretamente ao WhatsApp."""
import argparse
import time
import os
from mktech_envio import load_env, request, log
from commercial_model import infer, InferenceError

def step():
    status, result = request('POST', '/api/hermes/v1/comercial/contextos', {})
    # Deploy gradual: worker novo pode operar servidor V4 anterior.
    if result.get('status') == 'v4' or status == 404:
        return request('POST', '/api/hermes/v1/comercial/processar', {})
    if status != 200:
        return status, result
    results = []
    for context in result.get('contexts', []):
        payload = {'lease_id': context['lease_id']}
        if not context.get('first_contact'):
            try:
                payload.update(infer(result['system'], context))
            except InferenceError as error:
                payload['failure'] = str(error)
        code, saved = request('POST', '/api/hermes/v1/comercial/decidir', payload)
        if code == 422:
            # JSON bem formado também pode violar o contrato do servidor.
            request('POST', '/api/hermes/v1/comercial/decidir', {'lease_id':context['lease_id'],'failure':'invalid_model_output'})
        results.append({'status': saved.get('status'), 'http': code})
    return status, {'status': result.get('status'), 'results': results}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--uma-vez', action='store_true')
    args = parser.parse_args()
    load_env()
    if not os.environ.get('MKTECH_COMMERCIAL_TOKEN', '').startswith('mkt_'):
        log('Configure MKTECH_COMMERCIAL_TOKEN com escopo mensagens:escrever; worker não iniciado.')
        return
    os.environ['MKTECH_ENVIO_TOKEN'] = os.environ['MKTECH_COMMERCIAL_TOKEN']
    while True:
        status, result = step()
        log(f"Comercial: HTTP {status}; estado={result.get('status')}; processados={len(result.get('results', []))}")
        if args.uma_vez or status in (401, 403):
            return
        time.sleep(30)

if __name__ == '__main__':
    main()
