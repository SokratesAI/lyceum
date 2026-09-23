/* Does an answer reach the server before the deck is finished?
 *
 * Nothing in this repo renders a component, so a source-reading test here would
 * only prove the file contains a string. This drives the real app in Chromium
 * with the API stubbed, answers ONE card of three, and then asks what was
 * posted. Against `main` before this change the answer is "nothing" -- the
 * session was reported once, at the end -- so closing the deck early threw the
 * whole session away. Run it against both trees; a probe that passes on both
 * measured nothing.
 *
 *   node test/practice-report.probe.mjs <repo root>
 */
import pw from '/opt/nova-browser/node_modules/playwright-core/index.js';
import fs from 'fs';
const { chromium } = pw;
const ROOT = process.argv[2];
const CARD = (n) => ({
  id: `card:x:ch:00${n}`, cardType: 'multiple_choice', prompt: `Question ${n}?`,
  options: ['Yes', 'No'], answer: 'Yes', why: '', grade: 'settled',
  claimStatus: 'settled', chapterId: 'c1', sources: [],
});
const FIX = {
  '/api/courses': { courses: [{ slug: 'x', title: 'Course X', chapterCount: 1, cardCount: 3, state: 'active' }] },
  '/api/notes/dests': { dests: [{ kind: 'inbox', label: 'Inbox', path: 'nova/inbox.md' }] },
  '/api/workshop': { projects: [] },
  '/api/courses/x/practice': { course: { slug: 'x', title: 'Course X' }, total: 3, cards: [CARD(1), CARD(2), CARD(3)] },
};
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 412, height: 915 } });
  const errs = [];
  const posts = [];
  let failNext = false;
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.route('**/*', (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (u.hostname !== 'lyceum.test') return route.abort();
    if (u.pathname === '/api/practice/answers' && req.method() === 'POST') {
      const body = JSON.parse(req.postData() || '{}');
      posts.push({ ids: body.answers.map((a) => a.answerId), refused: failNext });
      // A phone on a bad connection: the answer never lands.
      if (failNext) return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ stored: body.answers.length }) });
    }
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
  await p.waitForSelector('.card.practice', { timeout: 15000 });
  await p.$eval('.card.practice button', (b) => b.click());
  await p.waitForSelector('.qact', { timeout: 8000 });

  // 1. One card of three answered, deck still open.
  await p.$eval('.qact .btn.text', (b) => b.click());            // Skip
  await p.waitForTimeout(600);
  console.log('after-1-of-3: ' + JSON.stringify({ posted: posts.length, answers: posts.flatMap((x) => x.ids).length }));

  // 2. The next one is refused, so it must be carried into the following post.
  failNext = true;
  await p.$eval('.qact .btn.text', (b) => b.click());
  await p.waitForTimeout(600);
  failNext = false;
  await p.$eval('.qact .btn.text', (b) => b.click());
  await p.waitForTimeout(600);
  const landed = new Set(posts.filter((x) => !x.refused).flatMap((x) => x.ids));
  const all = new Set(posts.flatMap((x) => x.ids));
  console.log('every-answer-landed: ' + JSON.stringify({ tried: all.size, landed: landed.size }));
  console.log('no-duplicate-ids: ' + JSON.stringify(all.size === 3));
  console.log('pageerrors: ' + JSON.stringify(errs));
  await b.close();
})().catch((e) => { console.log('FAILED ' + e.message); process.exit(1); });
