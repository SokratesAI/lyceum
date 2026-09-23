/* Issue #267, the half of it a browser can settle: a page you have already
   opened must draw its last answer on the next cold start, not "Loading…".
   Nothing in this repo renders a component, so this drives the real app.js in
   Chromium and reads the pixels' worth of text the phone would show.

   The second page is a new JS realm in the SAME browser context: that is what a
   home-screen launch is -- localStorage survives, every in-memory Map does not.
   Its API answers are held for API_DELAY ms, so content on screen before that
   can only have come from storage. Against the in-memory version this probe
   fails on `cold_start_first_paint`; that is what it is for.

     node test/cold-start.probe.mjs <repo root>
*/
import pw from '/opt/nova-browser/node_modules/playwright-core/index.js';
import fs from 'fs';
const { chromium } = pw;
const ROOT = process.argv[2] || '.';
const API_DELAY = 2500;
const FIX = {
  '/api/courses': { courses: [{ slug: 'x', title: 'Thermodynamics', chapterCount: 3, sourceCount: 2 }] },
  '/api/workshop': { projects: [] },
};
const serve = (delay) => async (route) => {
  const u = new URL(route.request().url());
  if (u.hostname !== 'lyceum.test') return route.abort();
  if (u.pathname.startsWith('/api/')) {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(FIX[u.pathname] ?? {}) });
  }
  const f = u.pathname === '/' ? '/index.html' : u.pathname;
  try {
    const body = fs.readFileSync(ROOT + '/public' + f);
    const ct = f.endsWith('.js') ? 'text/javascript' : f.endsWith('.html') ? 'text/html' : 'text/plain';
    return route.fulfill({ contentType: ct, body });
  } catch { return route.fulfill({ status: 404, body: '' }); }
};
const text = async (p) => (await p.innerText('body')).replace(/\s+/g, ' ');

const fails = [];
const check = (name, ok, saw) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${saw === undefined ? '' : ' -- ' + saw}`);
  if (!ok) fails.push(name);
};

(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 412, height: 915 } });
  const errs = [];
  /* `page.route` cannot serve a service worker script, so registration always
     fails under this harness and says nothing about the app. The worker itself
     is exercised against a real HTTP server, not here. */
  const noise = /register a ServiceWorker/;
  ctx.on('page', (p) => p.on('pageerror', (e) => { if (!noise.test(String(e))) errs.push(String(e)); }));

  const first = await ctx.newPage();
  await first.route('**/*', serve(0));
  await first.goto('https://lyceum.test/');
  await first.waitForSelector('nav.navbar', { timeout: 15000 });
  await first.waitForFunction(() => !document.body.innerText.includes('Loading'), null, { timeout: 15000 });
  check('first_visit_settles', (await text(first)).includes('Thermodynamics'), (await text(first)).slice(0, 80));
  await first.close();

  const cold = await ctx.newPage();
  await cold.route('**/*', serve(API_DELAY));
  await cold.goto('https://lyceum.test/');
  await cold.waitForSelector('nav.navbar', { timeout: 15000 });
  const early = await text(cold);
  check('cold_start_first_paint', early.includes('Thermodynamics') && !early.includes('Loading'), early.slice(0, 100));

  await cold.waitForTimeout(API_DELAY + 800);
  const late = await text(cold);
  check('fresh_answer_still_lands', late.includes('Thermodynamics'), late.slice(0, 80));

  /* The cache shares one origin quota with his enrolment and where-you-left-off,
     and nothing in it ever expires. Fill the quota to the byte with cache keys,
     let the app boot and make one cache write against a full store, and his own
     settings must still be writable afterwards. A cache that cannot give way
     starves them silently, because the app's `store.set` swallows the
     QuotaExceededError -- he would pause a course and find it enrolled again.
     The fill steps down through three sizes because stopping at the first throw
     leaves most of a block free, which is enough room for a small setting and
     would make this check pass against the broken code too. */
  const starve = await ctx.newPage();
  await starve.route('**/*', serve(0));
  await starve.goto('https://lyceum.test/');
  await starve.waitForSelector('nav.navbar', { timeout: 15000 });
  const filled = await starve.evaluate(() => {
    let n = 0, full = false;
    for (const size of [65536, 1024, 32, 1]) {
      const blob = 'x'.repeat(size);
      full = false;
      try { for (let i = 0; i < 60000; i++, n++) localStorage.setItem('lyceum.json/filler/' + n, blob); }
      catch { full = true; }   // this size no longer fits; step down
    }
    return { n, full };
  });
  check('store_really_is_full', filled.full === true, `${filled.n} filler keys, last write threw: ${filled.full}`);

  /* The app has to attempt a cache write it has not made before: re-writing a key
     that is already there at the same size costs no new bytes and cannot throw,
     so a reload of a page it has already cached proves nothing. Opening Workshop
     is a URL this session has never stored. */
  await starve.reload();
  await starve.waitForSelector('nav.navbar', { timeout: 15000 });
  await starve.click('text=Workshop');
  await starve.waitForTimeout(1500);
  const setting = await starve.evaluate(() => {
    try { localStorage.setItem('lyceum.status', JSON.stringify({ x: 'paused' })); }
    catch (e) { return 'threw ' + e.name; }
    return JSON.parse(localStorage.getItem('lyceum.status')).x;
  });
  check('his_settings_still_writable_when_cache_is_full', setting === 'paused', `setting -> ${setting}`);
  await starve.close();

  check('no_page_errors', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  await b.close();
  if (fails.length) { console.log('FAILED: ' + fails.join(', ')); process.exit(1); }
  console.log('all checks passed');
})().catch((e) => { console.log('PROBE CRASHED: ' + e); process.exit(1); });
