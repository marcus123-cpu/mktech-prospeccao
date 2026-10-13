"""Worker V6. Propõe decisões ao servidor; não envia diretamente ao WhatsApp."""
import argparse
import time
import os
from mktech_envio import load_env, request, log
from commercial_model import infer, InferenceError

def process_context(system, context):
    model_context = context
    for attempt in range(2):
        payload = {'lease_id': context['lease_id']}
        if not context.get('first_contact'):
            try:
                payload.update(infer(system, model_context))
            except InferenceError as error:
                payload['failure'] = str(error)
        code, saved = request('POST', '/api/hermes/v1/comercial/decidir', payload)
        log(f"V6: decisão HTTP {code}; estado={saved.get('status')}")
        invalid = saved.get('status') == 'validacao_recusada' or code == 422
        if invalid:
            errors = [str(item)[:300] for item in saved.get('errors', [])[:8]]
            log('V6: ' + '; '.join(errors))
            if attempt == 0 and not context.get('first_contact') and 'proposal' in payload:
                model_context = {**context, 'validation_feedback': {'errors':errors, 'rejected_proposal':payload['proposal']}}
                continue
            request('POST', '/api/hermes/v1/comercial/decidir', {'lease_id':context['lease_id'],'failure':'invalid_model_output'})
        return {'status': saved.get('status'), 'http': code}

def step():
    status, result = request('POST', '/api/hermes/v1/comercial/contextos', {})
    # Deploy gradual: worker novo pode operar servidor V4 anterior.
    if result.get('status') == 'v4':
        return request('POST', '/api/hermes/v1/comercial/processar', {})
    if status != 200:
        return status, result
    results = []
    for context in result.get('contexts', []):
        results.append(process_context(result.get('system',''),context))
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
