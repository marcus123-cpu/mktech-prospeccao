import json,subprocess,sys
from pathlib import Path
p=Path(__file__).parent
for i,(name,phone) in enumerate(json.loads((p/"seeds.json").read_text(encoding="utf-8"))):
 print("INSPECT",i,name,flush=True)
 r=subprocess.run([sys.executable,str(p/"inspect_runner.py"),"--nome",name,"--cidade","Indaiatuba","--telefone",phone,"--servicos","1"],capture_output=True,encoding="utf-8")
 (p/f"inspect-{i}.json").write_text(r.stdout,encoding="utf-8")
 (p/f"inspect-{i}.err").write_text(r.stderr,encoding="utf-8")
 print("RESULT",i,r.returncode,r.stdout[-150:],r.stderr[-150:],flush=True)
