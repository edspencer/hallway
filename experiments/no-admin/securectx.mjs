// Q-SECURE-CONTEXT: what each browser engine makes of plain-HTTP origins. Serves a probe page on 0.0.0.0:<port> and
// loads it as http://localhost, http://127.0.0.1, http://app.localhost, http://a.b.localhost and (control) the
// machine's LAN address, in Playwright's Chromium, Firefox and WebKit (and installed Chrome / msedge when present).
import http from 'node:http';
import os from 'node:os';
import { chromium, firefox, webkit } from 'playwright';

const port = Number(process.env.PORT ?? 4480);
const page = `<!doctype html><script>
window.probe = async () => {
  const r = { isSecureContext: window.isSecureContext, subtle: typeof crypto.subtle,
    serviceWorker: 'serviceWorker' in navigator, clipboard: !!navigator.clipboard,
    getUserMedia: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) };
  document.cookie = 'plain=1; path=/';
  document.cookie = 'sec=1; Secure; path=/';
  r.cookies = document.cookie;
  try { await navigator.serviceWorker.register('/sw.js'); r.swRegister = 'ok'; } catch (e) { r.swRegister = String(e).slice(0, 80); }
  try { await crypto.subtle.digest('SHA-256', new Uint8Array(1)); r.digest = 'ok'; } catch (e) { r.digest = String(e).slice(0, 60); }
  return r;
};
</script>`;
const server = http.createServer((req, res) => {
  if (req.url === '/sw.js') {
    res.writeHead(200, { 'content-type': 'text/javascript' });
    return res.end('self.addEventListener("fetch", () => {});');
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(page);
});
await new Promise((r) => server.listen(port, '0.0.0.0', r));

const lan = Object.values(os.networkInterfaces()).flat().find((a) => a.family === 'IPv4' && !a.internal)?.address;
const urls = ['localhost', '127.0.0.1', 'app.localhost', 'a.b.localhost', lan].filter(Boolean)
  .map((h) => `http://${h}:${port}/`);

const engines = [['chromium', chromium, {}], ['firefox', firefox, {}], ['webkit', webkit, {}]];
if (process.env.CHANNELS) for (const c of process.env.CHANNELS.split(',')) engines.push([c, chromium, { channel: c }]);

for (const [name, type, opts] of engines) {
  let browser;
  try { browser = await type.launch(opts); } catch (e) { console.log(`${name}: launch failed: ${String(e).split('\n')[0]}`); continue; }
  console.log(`\n== ${name} ${browser.version()}`);
  for (const url of urls) {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    try {
      await p.goto(url, { timeout: 10000 });
      console.log(url.padEnd(32), JSON.stringify(await p.evaluate(() => window.probe())));
    } catch (e) {
      console.log(url.padEnd(32), 'FAILED', String(e).split('\n')[0].slice(0, 120));
    }
    await ctx.close();
  }
  await browser.close();
}
server.close();
