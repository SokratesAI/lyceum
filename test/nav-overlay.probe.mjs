import pw from '/opt/nova-browser/node_modules/playwright-core/index.js';
import fs from 'fs';
const { chromium } = pw;
const ROOT = process.argv[2];
const FIX = {
  '/api/courses': { courses: [{ slug: 'x', title: 'Course X', chapters: 3, done: 0, state: 'active' }] },
  '/api/notes/dests': { dests: [{ kind: 'inbox', label: 'Inbox', path: 'nova/inbox.md' }] },
  '/api/workshop': { projects: [] },
  '/api/courses/x': { course: { slug: 'x', title: 'Course X' }, sources: [], grades: {}, chapters: [{ id: 'c1', title: 'Chapter One' }] },
};
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 412, height: 915 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.hostname !== 'lyceum.test') return route.abort();
    if (u.pathname.startsWith('/api/'))
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(FIX[u.pathname] ?? {}) });
    const f = u.pathname === '/' ? '/index.html' : u.pathname;
    try {
      const body = fs.readFileSync(ROOT + '/public' + f);
      const ct = f.endsWith('.js') ? 'text/javascript' : f.endsWith('.html') ? 'text/html' : 'text/plain';
      return route.fulfill({ contentType: ct, body });
    } catch { return route.fulfill({ status: 404, body: '' }); }
  });
  await p.goto('https://lyceum.test/');
  await p.waitForSelector('nav.navbar', { timeout: 15000 });
  const step = async (name, fn) => { const v = await fn(); console.log(name + ': ' + JSON.stringify(v)); return v; };

  // 1. go one page deep, so we can tell "closed the overlay" from "popped the page"
  await p.click('nav.navbar button:nth-child(1)');
  await p.waitForSelector('text=Course X', { timeout: 8000 });
  await p.click('text=Course X');
  await p.waitForTimeout(500);
  const onCourse = () => p.evaluate(() => !!document.body.innerText.match(/researched sources/));
  console.log('pushed-course-page: ' + JSON.stringify(await onCourse()));
  await p.click('.fab.dial');
  await p.waitForTimeout(300);
  if (await p.$('.minifab')) { await p.click('.minifab:nth-child(2)'); }
  await p.waitForSelector('.sheet textarea', { timeout: 5000 });
  await p.fill('.sheet textarea', 'half a thought');
  await p.goBack();
  await p.waitForTimeout(500);
  console.log('after-back: ' + JSON.stringify({ sheet: !!(await p.$('.sheet')), stillOnCourse: await onCourse() }));
  await p.click('.fab.dial');
  await p.waitForTimeout(300);
  if (await p.$('.minifab')) { await p.click('.minifab:nth-child(2)'); }
  await p.waitForSelector('.sheet textarea', { timeout: 5000 });
  console.log('draft-after-reopen: ' + JSON.stringify(await p.evaluate(() => document.querySelector('.sheet textarea').value)));
  await p.evaluate(() => document.querySelector('.scrim').click());
  await p.waitForTimeout(400);
  console.log('after-scrim: ' + JSON.stringify({ sheet: !!(await p.$('.sheet')), stillOnCourse: await onCourse() }));
  await p.goBack();
  await p.waitForTimeout(500);
  console.log('back-after-scrim-pops-page: ' + JSON.stringify({ stillOnCourse: await onCourse() }));
  console.log('pageerrors: ' + JSON.stringify(errs));
  await b.close();
})().catch((e) => { console.log('FAILED ' + e.message); process.exit(1); });
