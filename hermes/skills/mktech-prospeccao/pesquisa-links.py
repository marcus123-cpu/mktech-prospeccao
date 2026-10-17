import sys, urllib.request, re, html, json
from bs4 import BeautifulSoup
for url in sys.argv[1:]:
    if any(x in url for x in ('wa.me','whatsapp.com')):
        raise ValueError('Canal WhatsApp não pode ser aberto')
    try:
        raw=urllib.request.urlopen(url,timeout=20).read().decode('utf-8','replace')
        soup=BeautifulSoup(raw,'html.parser')
        links=[{'label':a.get_text(' ',strip=True), 'url':a.get('href')} for a in soup.find_all('a',href=True) if any(x in a['href'] for x in ('whatsapp','wa.me','instagram','facebook')) and 'linktr.ee/' not in a['href']]
        for tag in soup(['script','style','nav','footer']): tag.decompose()
        text=soup.get_text(' ',strip=True).split('Cookie Preferences')[0]
        print(json.dumps({'url':url,'links':links,'text':text[:16000]},ensure_ascii=True))
    except Exception as e: print(json.dumps({'url':url,'error':str(e)}))
