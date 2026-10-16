"""Check authenticated validation without writing any production message."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'envio'))
import mktech_envio as sender
sender.load_env()
status, payload = sender.request('POST', '/api/hermes/v1/envio/historico', {})
print('History endpoint HTTP', status)
print('Validation status:', payload.get('status'))
if status != 422:
    raise SystemExit(1)
