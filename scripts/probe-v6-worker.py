"""Inspeção controlada do teste interno; não envia mensagens nem imprime segredos."""
import json
import os
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'envio'))
from mktech_envio import load_env, request
from commercial_model import infer, InferenceError
load_env()
os.environ['MKTECH_ENVIO_TOKEN']=os.environ['MKTECH_COMMERCIAL_TOKEN']
code,result=request('POST','/api/hermes/v1/comercial/contextos',{})
print(json.dumps({'http':code,'status':result.get('status'),'contexts':len(result.get('contexts',[]))}))
for ctx in result.get('contexts',[]):
    if ctx.get('lead_id')!='039520fa-aebc-4bc6-963a-f5d5f3f80500':
        raise RuntimeError('Inspeção permitida somente no lead de teste autorizado')
    try:
        payload=infer(result['system'],ctx)
    except InferenceError as error:
        print(json.dumps({'failure':str(error)}))
        request('POST','/api/hermes/v1/comercial/decidir',{'lease_id':ctx['lease_id'],'failure':str(error)})
        continue
    dest=Path(__file__).resolve().parents[1]/'backups'/'v6-probe-context.json'
    dest.write_text(json.dumps({'context':ctx,'payload':payload},ensure_ascii=False),encoding='utf-8')
    print(json.dumps({'model':payload['model'],'action':payload['proposal'].get('action'),'probe_saved':True}))
