// Read-only diagnostics for the bridge's own headless browser; no message content.
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('../envio/whatsapp-web/node_modules/puppeteer');
(async () => {
  const lines = fs.readFileSync(path.join(__dirname, '../envio/whatsapp-web/.wwebjs_auth/session-chip2/DevToolsActivePort'), 'utf8').trim().split(/\r?\n/);
  const browser = await puppeteer.connect({ browserWSEndpoint: `ws://127.0.0.1:${lines[0]}${lines[1]}`, protocolTimeout: 15000 });
  try {
    for (const page of await browser.pages()) {
      console.log(JSON.stringify(await page.evaluate(() => ({
        url: location.origin + location.pathname,
        title: document.title,
        ready: document.readyState,
        wwebjs: !!window.WWebJS,
        modules: typeof window.require,
        version: window.Debug?.VERSION,
        startup: !window.WWebJS ? document.body.innerText.slice(0, 350) : undefined,
        state: (() => { try { return window.require('WAWebSocketModel').Socket.state; } catch { return null; } })(),
      }))));
    }
  } finally {
    if (process.argv.includes('--close')) await browser.close();
    else browser.disconnect();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
