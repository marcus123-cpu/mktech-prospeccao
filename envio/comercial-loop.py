"""Worker V4. Usa token mensagens:escrever; não envia diretamente ao WhatsApp."""
import argparse
import time
import os
from mktech_envio import load_env, request, log

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
        status, result = request('POST', '/api/hermes/v1/comercial/processar', {})
        log(f"V4: HTTP {status}; estado={result.get('status')}; processados={len(result.get('results', []))}")
        if args.uma_vez or status in (401, 403):
            return
        time.sleep(30)

if __name__ == '__main__':
    main()
