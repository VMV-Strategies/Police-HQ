const { chromium } = require('playwright');
// End-to-end test of the web app in a phone-sized Chromium (Playwright).
// Usage (from the repository's parent folder, so the site is served at /PoliceHQ/web/):
//   python3 -m http.server 8765 &
//   node PoliceHQ/web/tests/e2e.js <work-dir> <package.phqpkg>
// <work-dir> must contain tamper-file.phqpkg and tamper-manifest.phqpkg (see make_tampered.py) and a shots/ folder.
const SP = process.argv[2];
const PKG = process.argv[3];
const BASE = process.env.PHQ_BASE || 'http://localhost:8765/PoliceHQ/web/';
const results = [];
const check = (name, ok, info = '') => { results.push([ok ? 'PASS' : 'FAIL', name, info]); console.log(ok ? 'PASS' : 'FAIL', name, info); };
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'light' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('dialog', d => d.accept());
  const external = [];
  page.on('request', r => { if (!r.url().startsWith('http://localhost:8765/') && !r.url().startsWith('blob:') && !r.url().startsWith('data:')) external.push(r.url()); });
  const shot = n => page.screenshot({ path: `${SP}/shots/${n}.png` });
  const text = () => page.locator('#view').innerText();
  const nav = async (u) => { await page.evaluate(() => { const v = document.getElementById('view'); if (v) v.replaceChildren(); }).catch(() => {}); await page.goto(u); await page.evaluate(() => window.dispatchEvent(new HashChangeEvent('hashchange'))); };

  await page.goto(BASE);
  await page.waitForSelector('.hero');
  check('home shows opening text', (await text()).includes('What are you dealing with?') && (await text()).includes('Describe the situation, or choose a guide.'));
  check('no content message', (await text()).includes('No content installed'));
  await shot('01-no-content');

  // import
  await nav(BASE + '#/settings');
  await page.waitForSelector('text=Content status');
  let t0 = Date.now();
  await page.setInputFiles('input[type=file]', PKG);
  await page.waitForSelector('text=2026.11.01-dev', { timeout: 300000 });
  check('package imports', true, `${((Date.now() - t0) / 1000).toFixed(1)} s`);
  await shot('02-settings-installed');
  const st = await text();
  check('status shows key and not-a-currency-date', st.includes('phq-dev-2026') && st.includes('not a currency date'));
  check('storage mode is on-device file storage (OPFS)', st.includes('On-device file storage'));

  // tampered packages rejected, current kept
  for (const [f, expect] of [['tamper-file.phqpkg', 'Hash mismatch'], ['tamper-manifest.phqpkg', 'Signature not valid']]) {
    await nav(BASE + '#/settings'); await page.waitForSelector('text=Content status');
    await page.setInputFiles('input[type=file]', `${SP}/${f}`);
    await page.waitForSelector('text=Package not installed', { timeout: 300000 });
    const tx = await text();
    check(`${f} rejected`, tx.includes(expect) && tx.includes('has not changed'), tx.split('\n').slice(0, 3).join(' | '));
  }
  await shot('03-tamper-rejected');
  await nav(BASE + '#/statutes'); await page.waitForSelector('.row');
  check('content still usable after rejected imports', (await page.locator('.row').count()) > 100, `${await page.locator('.row').count()} sources`);

  // offline reload
  await page.reload(); await page.waitForTimeout(1500);
  await ctx.setOffline(true);
  await nav(BASE + '#/statutes'); await page.waitForSelector('.row', { timeout: 20000 });
  check('works offline after reload', (await page.locator('.row').count()) > 100);
  await page.getByRole('button', { name: 'Municipal', exact: true }).click();
  await page.getByRole('button', { name: 'Brampton', exact: true }).click();
  await page.waitForTimeout(400);
  const brampton = await page.locator('.row-sub').allInnerTexts();
  check('Brampton filter shows only Brampton', brampton.length > 10 && brampton.every(s => s.includes('Municipal — Brampton')), `${brampton.length}`);
  await shot('04-statutes-brampton');

  // reader at 495(1)
  await nav(BASE + '#/doc/ca-criminal-code?p=' + encodeURIComponent('ca-criminal-code:495(1)'));
  await page.waitForSelector('.prov.flash', { timeout: 20000 });
  const rt = await text();
  check('reader header labels', rt.includes('Federal — Canada') && rt.includes('Current to') && rt.includes('Not verified against publisher') && rt.includes('Unofficial reproduction'));
  const flashed = await page.locator('.prov.flash').innerText();
  check('no stray null text', !flashed.includes('null'));
  check('jumped to s. 495(1)', /A peace officer may arrest without warrant/.test(flashed));
  await shot('05-reader-495');
  await page.fill('.find input', 'warrant');
  await page.press('.find input', 'Enter');
  await page.waitForSelector('.find-count:has-text("of")', { timeout: 20000 });
  const fc = await page.locator('.find-count').innerText();
  await page.locator('[aria-label="Next match"]').click(); await page.waitForTimeout(300);
  const fc2 = await page.locator('.find-count').innerText();
  check('search this document navigates matches', fc.startsWith('1 of') && fc2.startsWith('2 of'), `${fc} → ${fc2}`);
  check('matches highlighted', (await page.locator('.doc-text mark').count()) > 0);
  await shot('06-reader-find');
  await page.locator('button', { hasText: 'Contents' }).click();
  await page.fill('.sheet input', '503');
  await page.waitForTimeout(500);
  await page.locator('.toc-row', { hasText: 's. 503' }).first().click();
  await page.waitForTimeout(500);
  check('contents jump to s. 503', (await page.locator('.prov.flash').innerText()).includes('503'));

  // search all
  await nav(BASE + '#/search?q=trespass');
  await page.waitForSelector('.hit', { timeout: 20000 });
  const jls = new Set(await page.locator('.hit .jl').allInnerTexts());
  check('search all sources returns several jurisdictions', jls.size >= 2, [...jls].join(', '));
  await shot('07-search');

  // guides
  await nav(BASE + '#/authorities'); await page.waitForSelector('.row');
  check('six authority categories', (await page.locator('.row').count()) === 6);
  await nav(BASE + '#/guide/auth-detention-investigative-common-law'); await page.waitForSelector('.detail-title');
  const inv = await text();
  check('common-law card states the source gap', /not installed/i.test(inv), '');
  await nav(BASE + '#/guide/auth-arrest-peace-officer-warrantless'); await page.waitForSelector('.detail-title');
  await shot('08-guide-arrest');
  const q1 = await page.locator('.quote-text').allInnerTexts();
  await page.selectOption('.level select', 'very-simple'); await page.waitForTimeout(200);
  const q2 = await page.locator('.quote-text').allInnerTexts();
  check('explanation level leaves quoted wording unchanged', q1.length > 0 && JSON.stringify(q1) === JSON.stringify(q2));
  await nav(BASE + '#/cautions'); await page.waitForSelector('.row');
  const ct = await text();
  check('cautions show Approved wording not installed.', (ct.match(/Approved wording not installed\./g) || []).length === 6);
  await nav(BASE + '#/guide/caution-rights-to-counsel'); await page.waitForSelector('.not-installed');
  for (const lv of ['very-simple', 'plain-language', 'detailed', 'legal-analysis']) {
    await page.selectOption('.level select', lv);
    if (!(await page.locator('.ni-title').innerText()).includes('Approved wording not installed.')) check('caution at ' + lv, false);
  }
  check('caution notice at every level', true);
  await shot('09-caution');

  // penalties
  await nav(BASE + '#/penalties/offence-hta-speeding'); await page.waitForSelector('.pline');
  await page.fill('input[type=number]', '25'); await page.waitForTimeout(200);
  const pt = await text();
  check('speeding 25 km/h over = $112.50 statutory', pt.includes('$112.50'));
  check('total cannot be verified', pt.includes('Total cannot be verified.'));
  check('no missing component shown as $0', !/\$0\.00/.test(pt));
  await shot('10-penalties');

  // bookmarks persist
  await nav(BASE + '#/doc/ca-criminal-code?p=' + encodeURIComponent('ca-criminal-code:495(1)'));
  await page.waitForSelector('.prov.flash');
  await page.locator('.prov.flash .star').click();
  await nav(BASE + '#/saved'); await page.waitForSelector('.row');
  check('bookmark saved', (await text()).includes('495(1)'));
  await shot('11-saved');

  // home describe helper
  await nav(BASE + '#/');
  await page.waitForSelector('textarea');
  await page.fill('textarea', 'Driver doing 85 in a 60, radar reading');
  await page.click('text=Find guides');
  await page.waitForSelector('text=Possibly relevant guides');
  check('describe helper suggests speeding guide', (await text()).includes('Speeding'));
  await shot('12-home');

  // dark mode screenshot
  await page.emulateMedia({ colorScheme: 'dark' });
  await nav(BASE + '#/guide/auth-arrest-peace-officer-warrantless'); await page.waitForSelector('.detail-title');
  await shot('13-dark');

  check('no false update banner', await page.locator('#update').isHidden());
  check('no network requests outside the site', external.length === 0, external.slice(0, 3).join(' '));
  const realErrors = errors.filter(e => !/Failed to load resource/.test(e));
  check('no console errors', realErrors.length === 0, realErrors.slice(0, 5).join(' || '));
  console.log(`\n${results.filter(r => r[0] === 'PASS').length}/${results.length} passed`);
  await browser.close();
})().catch(e => { console.error('CRASH', e); process.exit(1); });
