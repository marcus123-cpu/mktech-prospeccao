import runpy,sys,json
from pathlib import Path
from playwright.sync_api import Page
orig=Page.goto
def goto(self,url,*a,**k):
 if "bing.com/search?" in url:
  with open(Path(__file__).with_name("searches.jsonl"),"a",encoding="utf-8") as f:f.write(json.dumps({"url":url})+"\n")
 return orig(self,url,*a,**k)
Page.goto=goto
runpy.run_path(r"C:\Users\pmarc\AppData\Local\hermes\skills\mktech\mktech-prospeccao\scripts\inspecionar_presenca.py",run_name="__main__")
