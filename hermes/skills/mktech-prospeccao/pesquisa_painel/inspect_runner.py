import sys, runpy, json
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import Page
log = Path(sys.argv[1])
original = Page.goto
def is_whatsapp(url):
    host=urlparse(url).netloc.lower().split(':')[0]
    return any(host==d or host.endswith('.'+d) for d in ('whatsapp.com','wa.me','wa.link','whatsapp.net','w.app'))
def guard(route):
    if is_whatsapp(route.request.url):route.abort()
    else:route.continue_()
guarded=set()
def tracked(self, url, *args, **kwargs):
    if id(self) not in guarded:
        self.route('**/*',guard);guarded.add(id(self))
    if is_whatsapp(url):
        with log.open('a',encoding='utf-8') as f:f.write(json.dumps({'type':'blocked_navigation','url':url,'reason':'Não abrir WhatsApp; pesquisa somente.'})+'\n')
        return None
    if 'bing.com/search?' in url:
        with log.open('a', encoding='utf-8') as f:
            f.write(json.dumps({'type':'search','url':url},ensure_ascii=False)+'\n')
    return original(self,url,*args,**kwargs)
Page.goto = tracked
sys.argv = sys.argv[2:]
runpy.run_path(sys.argv[0],run_name='__main__')
