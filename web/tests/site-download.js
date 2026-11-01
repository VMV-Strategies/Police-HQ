// Tests installing content published in web/content/ (see docs/WEB_APP.md).
// Serve the repository's parent folder on port 8765, then: node PoliceHQ/web/tests/site-download.js <screenshot-dir>
const { chromium } = require('playwright');
const path = require('path');
const BASE = process.env.PHQ_BASE || 'http://localhost:8765/PoliceHQ/web/';
const res = []; const check = (n, ok, i = '') => { res.push(ok); console.log(ok ? 'PASS' : 'FAIL', n, i); };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(BASE);
  await p.waitForSelector('text=Download and install content', { timeout: 20000 });
  check('fresh phone offers site download', true, await p.locator('.empty button').innerText());
  await p.screenshot({ path: process.argv[2] + '/site-01.png' });
  const t0 = Date.now();
  await p.locator('.empty button').click();
  await p.waitForSelector('.progress-label:has-text("Downloading")', { timeout: 20000 });
  await p.screenshot({ path: process.argv[2] + '/site-02.png' });
  await p.waitForSelector('textarea', { timeout: 300000 });
  check('downloads, verifies and installs from site', true, `${((Date.now() - t0) / 1000).toFixed(1)} s`);
  await p.goto(BASE + '#/settings'); await p.waitForSelector('text=Up to date', { timeout: 20000 });
  check('settings says up to date', (await p.locator('#view').innerText()).includes('2026.11.01-dev'));
  await ctx.setOffline(true);
  await p.goto(BASE + '#/statutes'); await p.reload(); await p.waitForSelector('.row', { timeout: 20000 });
  check('works offline afterwards', (await p.locator('.row').count()) > 100);
  // update banner when site has a different version
  await ctx.setOffline(false);
  const fs = require('fs'); const LJ = path.join(__dirname, '..', 'content', 'latest.json'); const orig = fs.readFileSync(LJ, 'utf8');
  fs.writeFileSync(LJ, orig.replace('"2026.11.01-dev"', '"2026.12.01"'));
  await p.goto(BASE + '#/'); await p.reload(); await p.waitForSelector('text=New content available: 2026.12.01', { timeout: 20000 });
  fs.writeFileSync(LJ, orig);
  check('update banner when site has newer package', true);
  check('no errors', errs.length === 0, errs.join(' | '));
  console.log(`${res.filter(Boolean).length}/${res.length} passed`);
  await b.close();
})().catch(e => { console.log('CRASH', e.message); process.exit(1); });
