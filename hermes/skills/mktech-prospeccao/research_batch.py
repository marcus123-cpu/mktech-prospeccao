import json
import pathlib
import subprocess
import sys
import os

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
os.environ['PYTHONIOENCODING'] = 'utf-8'

BASE = pathlib.Path(__file__).parent
CLIENT = r'C:\Users\pmarc\AppData\Local\hermes\skills\mktech\mktech-prospeccao\scripts\mktech_crm.py'
RUN = '52045f39-ba3b-4881-ba85-a89bc662f732'
for i, candidate in enumerate(json.loads((BASE / 'research_batch.json').read_text(encoding='utf-8-sig'))):
    path = BASE / 'research_candidate.json'
    path.write_text(json.dumps(candidate, ensure_ascii=False), encoding='utf-8')
    result = subprocess.run([sys.executable, CLIENT, 'check', '--file', str(path)], capture_output=True)
    check = result.stdout.decode('utf-8', errors='replace').strip()
    print(candidate['business_name'], 'check', result.returncode, check, flush=True)
    if result.returncode:
        break
    data = json.loads(check)
    if data.get('status') == 'existente':
        with (BASE / 'research_results.jsonl').open('a', encoding='utf-8') as file:
            file.write(json.dumps({'name':candidate['business_name'],'city':candidate['city'],'check':data,'code':0,'result':'duplicate'},ensure_ascii=False)+'\n')
        continue
    result = subprocess.run([sys.executable, CLIENT, 'register', '--run', RUN, '--file', str(path)], capture_output=True)
    output = result.stdout.decode('utf-8', errors='replace').strip()
    print(candidate['business_name'], 'register', result.returncode, output, flush=True)
    with (BASE / 'research_results.jsonl').open('a', encoding='utf-8') as file:
        file.write(json.dumps({'name': candidate['business_name'], 'city': candidate['city'], 'candidate':candidate, 'check':data, 'code':result.returncode, 'result':output}, ensure_ascii=False)+'\n')
    if result.returncode:
        break
