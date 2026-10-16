"""Readiness probe: no valid recipient, file, or queue item is sent."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'envio'))
import mktech_envio as sender
sender.load_env()
transport=sender.WhatsAppWeb()
state=transport._call('GET','/estado')
print('WhatsApp ready:',state.get('pronto'))
try:
    transport._call('POST','/enviar-voz',{})
except sender.BridgeRejected as error:
    if 'HTTP 400' in str(error):
        print('Voice endpoint loaded; invalid request rejected before send')
    else:
        print(str(error))
        raise SystemExit(1)
else:
    raise SystemExit('Unexpected response to invalid request')
