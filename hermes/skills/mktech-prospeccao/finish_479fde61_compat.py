"""Compatibility for discard-reason, using the installed CRM client's transport."""
import argparse, importlib.util, sys
PATH=r'C:\Users\pmarc\AppData\Local\hermes\skills\mktech\mktech-prospeccao\scripts\mktech_crm.py'
spec=importlib.util.spec_from_file_location('installed_mktech_crm',PATH)
client=importlib.util.module_from_spec(spec)
spec.loader.exec_module(client)
parser=argparse.ArgumentParser(add_help=False)
parser.add_argument('--discard-reason',action='append',default=[])
extra,argv=parser.parse_known_args()
reasons={}
for value in extra.discard_reason:
 label,sep,count=value.rpartition('=')
 if not sep or not label or not count.isdigit():raise SystemExit('Invalid discard reason')
 reasons[label[:200]]=int(count)
original=client.request
def request_with_reasons(method,path,body=None,*args,**kwargs):
 if path.endswith('/finish') and reasons:
  body=dict(body,discard_reasons=reasons)
 return original(method,path,body,*args,**kwargs)
client.request=request_with_reasons
sys.exit(client.main(argv))
