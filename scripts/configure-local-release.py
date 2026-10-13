"""Atualiza somente configurações locais necessárias, preservando credenciais existentes."""
from pathlib import Path
import json
import sys
root=Path(__file__).resolve().parent.parent
env_path=root/'envio'/'.env'
skill_env=Path.home()/'AppData'/'Local'/'hermes'/'skills'/'mktech'/'mktech-prospeccao'/'scripts'/'.env'
def read(path):
    return dict(line.strip().split('=',1) for line in path.read_text(encoding='utf-8-sig').splitlines() if '=' in line and not line.lstrip().startswith('#'))
config=read(env_path)
skill=read(skill_env)
token=skill.get('MKTECH_CRM_TOKEN','').strip().strip('"\'')
if not token.startswith('mkt_') or len(token)!=68:
    raise SystemExit('Token comercial existente inválido')
if config.get('MKTECH_CRM_URL')!='https://mktech-prospeccao.vercel.app':
    raise SystemExit('URL local diferente do destino publicado')
backup=root/'backups'/'envio-before-release.env'
if not backup.exists():backup.write_bytes(env_path.read_bytes())
updates={'MKTECH_COMMERCIAL_TOKEN':token,'ENVIO_SO_PARA':config.get('ENVIO_SO_PARA') or '5517992250729'}
lines=env_path.read_text(encoding='utf-8-sig').splitlines()
for key,value in updates.items():
    lines=[line for line in lines if not line.startswith(key+'=')]
    lines.append(key+'='+value)
env_path.write_text('\n'.join(lines)+'\n',encoding='utf-8')
sys.path.insert(0,str(root/'envio'))
import mktech_envio as m
m.load_env()
bridge=m.WhatsAppWeb()
queues={kind:bridge._call('GET','/'+kind) for kind in ['recebidas','minhas']}
(root/'backups'/'bridge-pending-before-release.json').write_text(json.dumps(queues),encoding='utf-8')
print(json.dumps({'configuration_updated':True,'only_to':updates['ENVIO_SO_PARA'],'pending_events':{k:len(v) for k,v in queues.items()}}))
