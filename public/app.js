/* Lyceum PWA shell -- build step 4 of projects/sokrates/projects/lyceum/lyceum.md.
   Preact + htm, buildless, per ADR 0010. The Material 3 tokens and the four-tab
   layout are the approved demo's, ported onto the real courses in CouchDB. */
import { blocksOf, parseBlock, sourceLabel } from './markdown.js';

const { html, render, useState, useEffect, useRef } = window.htmPreact;

const I = (n, cls = '') => html`<span class=${'msym ' + cls}>${n}</span>`;

/* The approved demo's container colours and icons, keyed by the real course
   slugs (the demo used short ids: pm, proj, ana, fin, biz, a9s). */
const HUE = {
  'product-management': { bg: '#D3E3FD', fg: '#041E49', ic: 'inventory_2' },
  'project-management': { bg: '#C4EED0', fg: '#04210C', ic: 'view_timeline' },
  analytics:            { bg: '#E8DEF8', fg: '#1D192B', ic: 'insights' },
  'business-finance':   { bg: '#FFDCBE', fg: '#2D1600', ic: 'payments' },
  'running-a-business': { bg: '#FFD8E4', fg: '#31111D', ic: 'storefront' },
  a9s:                  { bg: '#B3EBF8', fg: '#001F27', ic: 'dns' },
};
const hue = (slug) => HUE[slug] || { bg: 'var(--surface-container-high)', fg: 'var(--on-surface)', ic: 'school' };

/* Enrolment and "where you left off" live on this device. The demo kept them
   in component state; nothing on the server records either yet. */
const store = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem('lyceum.' + k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem('lyceum.' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const statusOf = (slug) => store.get('status', {})[slug] || 'active';
const setStatusOf = (slug, s) => store.set('status', { ...store.get('status', {}), [slug]: s });
const placeOf = (slug) => store.get('place', {})[slug] || null;   // { n, title, id }
const setPlaceOf = (slug, place) => store.set('place', { ...store.get('place', {}), [slug]: place });

const TABS = [
  { id: 'home',        icon: 'home',   label: 'Home' },
  { id: 'courses',     icon: 'school', label: 'Courses' },
  { id: 'workshop',    icon: 'handyman', label: 'Workshop' },
  { id: 'aristoteles', icon: 'forum',  label: 'Aristoteles' },
];

const getJSON = (url) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`${r.status} from ${url}`);
    return r.json();
  });

/* The last answer for every URL this session has read, so going back to a page
   draws it at once from here and swaps in the fresh answer when it lands,
   instead of blanking to Loading on every visit (issue #267). */
const lastJSON = new Map();

function useJSON(url, { cache = true } = {}) {
  const [state, setState] = useState(() => (cache && lastJSON.has(url) ? { data: lastJSON.get(url) } : { loading: true }));
  useEffect(() => {
    let live = true;
    setState(cache && lastJSON.has(url) ? { data: lastJSON.get(url) } : { loading: true });
    getJSON(url).then(
      (data) => { if (cache) lastJSON.set(url, data); if (live) setState({ data }); },
      (err) => live && !(cache && lastJSON.has(url)) && setState({ error: String(err.message || err) }),
    );
    return () => { live = false; };
  }, [url]);
  return state;
}

const Loading = () => html`<p class="supporting">Loading…</p>`;
const Failed = ({ error }) => html`
  <div class="card out">
    <h3>That did not load</h3>
    <p class="supporting">${error}</p>
  </div>`;

/* An empty state says which build step fills it, rather than pretending to be
   a finished screen. The spec's build sequence is the source of these numbers. */
const NotBuiltYet = ({ title, step, what }) => html`
  <div class="card out">
    <h3>${title}</h3>
    <p class="supporting">${what} Build step ${step}.</p>
  </div>`;


function Courses({ onOpen }) {
  const { loading, error, data } = useJSON('/api/courses');
  const [filter, setFilter] = useState('active');
  const [, redraw] = useState(0);
  if (loading) return html`<${Loading} />`;
  if (error) return html`<${Failed} error=${error} />`;
  if (!data.courses.length) {
    return html`<${NotBuiltYet} title="No courses yet" step="3"
      what="The wiki import has not run against this database." />`;
  }
  const set = (slug, s) => { setStatusOf(slug, s); redraw((x) => x + 1); };
  const list = data.courses.filter((c) => statusOf(c.slug) === filter);
  const segs = [['active', 'Enrolled'], ['paused', 'Paused'], ['available', 'Available']];
  return html`
    <div class="seg">
      ${segs.map((s) => html`
        <button key=${s[0]} class=${filter === s[0] ? 'on' : ''} onClick=${() => setFilter(s[0])}>
          ${filter === s[0] ? I('check') : null}${s[1]}
        </button>`)}
    </div>
    ${list.map((c) => {
      const u = hue(c.slug), st = statusOf(c.slug), at = placeOf(c.slug);
      return html`
      <div class="card" key=${c.slug}>
        <div class="row">
          <div class="avatar" style=${{ background: u.bg, color: u.fg }}>${I(u.ic)}</div>
          <div class="grow" onClick=${() => onOpen(c.slug)}>
            <h3>${c.title}</h3>
            <p class="supporting">
              ${st === 'available' || !at ? `${c.chapterCount} ${c.chapterCount === 1 ? 'chapter' : 'chapters'} · ${c.sourceCount} ${c.sourceCount === 1 ? 'source' : 'sources'}`
                : `Chapter ${at.n} of ${c.chapterCount} · ${at.title}`}</p>
          </div>
          ${st === 'active' ? html`<button class="btn outlined sm" onClick=${() => set(c.slug, 'paused')}>Pause</button>` : null}
          ${st === 'paused' ? html`<button class="btn filled sm" onClick=${() => set(c.slug, 'active')}>Resume</button>` : null}
          ${st === 'available' ? html`<button class="btn filled sm" onClick=${() => set(c.slug, 'active')}>Enrol</button>` : null}
        </div>
        ${st !== 'available' ? html`
          <div class="lin"><i style=${{ width: (at ? (at.n - 1) / c.chapterCount * 100 : 0) + '%',
            background: st === 'paused' ? 'var(--outline-variant)' : 'var(--primary)' }}></i></div>` : null}
      </div>`; })}
    ${!list.length ? html`<p class="supporting" style="text-align:center;padding:32px 0">
      Nothing here yet.</p>` : null}`;
}

function GradeBar({ dist }) {
  const total = dist.high + dist.mod + dist.low + dist.un || 1;
  const pc = (n) => (n / total) * 100;
  const key = [['high', 'g-high', dist.high], ['moderate', 'g-mod', dist.mod],
               ['low', 'g-low', dist.low], ['ungrounded', 'g-un', dist.un]];
  return html`
    <div class="gbar">
      ${key.filter((k) => k[2]).map((k) => html`<i key=${k[0]} class=${k[1]} style=${{ width: pc(k[2]) + '%' }}></i>`)}
    </div>
    <div class="gkey">
      ${key.filter((k) => k[2]).map((k) => html`
        <span class="chip stat" key=${k[0]}>
          <i class=${'dot ' + k[1]} style="width:8px;height:8px;border-radius:50%;display:inline-block"></i>
          ${k[2]} ${k[0]}
        </span>`)}
    </div>`;
}
function Course({ slug, onOpenChapter, onTitle }) {
  const { loading, error, data } = useJSON(`/api/courses/${slug}`);
  const [, redraw] = useState(0);
  useEffect(() => { if (data && onTitle) onTitle(data.course.title); }, [data]);
  if (loading) return html`<${Loading} />`;
  if (error) return html`<${Failed} error=${error} />`;
  const u = hue(slug), st = statusOf(slug), at = placeOf(slug);
  const set = (s) => { setStatusOf(slug, s); redraw((x) => x + 1); };
  const g = data.grades || {};
  const dist = { high: g.high || 0, mod: g.moderate || 0, low: g.low || 0, un: g.ungrounded || 0 };
  const claims = Object.values(g).reduce((a, b) => a + b, 0);
  const open = (ch, n) => {
    setPlaceOf(slug, { n, title: ch.title, id: ch.id });
    onOpenChapter(ch.id);
  };
  return html`
    <div class="hero" style=${{ '--c-bg': u.bg, '--c-fg': u.fg }}>
      <h2>${data.course.title}</h2>
      <p>LLM wiki · ${data.sources.length} researched sources → ${data.chapters.length} pages</p>
    </div>
    <div class="card">
      <p style="margin:0;font-size:15px;line-height:22px">${data.course.basis}</p>
    </div>

    <div class="sectitle">Evidence behind this course</div>
    <div class="card">
      ${claims
        ? html`<${GradeBar} dist=${dist} />
          <p class="supporting" style="margin-top:10px">
            Across ${claims} claims. Ungrounded means untested — not wrong.</p>`
        : html`<p class="supporting" style="margin:0">No claims extracted for this course yet.</p>`}
    </div>

    <div class="sectitle">Chapters</div>
    <div class="card">
      ${data.chapters.map((ch, i) => {
        const n = i + 1, read = st !== 'available' && at && n < at.n, now = st !== 'available' && at && n === at.n;
        return html`
          <div class=${'li' + (read ? ' read' : '') + (now ? ' now' : '')} key=${ch.id} onClick=${() => open(ch, n)}>
            <div class="lead">${read ? I('check') : n}</div>
            <div class="txt" style="font-size:15px;line-height:21px">${ch.title}</div>
            ${I('chevron_right', 'trail')}
          </div>`;
      })}
    </div>

    <div class="sectitle">Sources</div>
    <div class="card">
      ${data.sources.map((s) => html`
        <p class="supporting" key=${s.id} style="margin:6px 0">${s.title}</p>`)}
    </div>

    <div class="row" style="justify-content:flex-end;margin-top:16px">
      ${st === 'active' ? html`<button class="btn outlined" onClick=${() => set('paused')}>Pause course</button>` : null}
      ${st === 'paused' ? html`<button class="btn filled" onClick=${() => set('active')}>Resume course</button>` : null}
      ${st === 'available' ? html`<button class="btn filled" onClick=${() => set('active')}>Enrol</button>` : null}
    </div>`;
}

/* The GRADE mark's class, and the word under it when the trace is open. The
   four levels are the approved encoding: filled, lighter, hollow, dashed amber.
   `contradicted` and `unverified` are claim *statuses* rather than grades and
   carry no colour of their own, so they fall through to the hollow mark and say
   what they are in words -- inventing a fifth dot for a state the design never
   settled would be redesigning the UI, which the spec forbids. */
const MARK_CLASS = { high: 'm-high', moderate: 'm-mod', low: 'm-low', ungrounded: 'm-un' };

const TRACE_WORD = {
  contradicted: 'The source says otherwise',
  unverified: 'Never checked against a source',
};

/* One claim's source trace, opened by tapping its mark.
   It answers the question the mark raises and nothing else: how solid is this,
   and what is it standing on. The verbatim `quote` is the whole value of the
   grounded case -- it is the sentence in the source that the claim was checked
   against, so he can disagree with the check rather than take it on trust. */
function Trace({ claim, sources, onAsk }) {
  const grounded = claim.status === 'grounded';
  const cited = (claim.sourceIds || []).map((id) => sources[id]?.title || id);
  return html`
    <div class=${'trace' + (grounded ? '' : ' un')}>
      <div class="lvl">${TRACE_WORD[claim.status] || GRADE_WORD[claim.grade] || claim.grade}</div>
      ${claim.quote
        ? html`<div>“${claim.quote}”</div>`
        : html`<div>Nothing in this course's sources states this. It is the author's
            own reasoning, and the course keeps it rather than dropping it so that
            you can see it is untested.</div>`}
      ${cited.length ? html`<div style="margin-top:6px"><b>Source:</b> ${cited.join(', ')}</div>` : null}
      ${onAsk ? html`<div style="display:flex;justify-content:flex-end;margin-top:10px">
        <button class="btn tonal sm" onClick=${() => onAsk(claim)}>${I('forum')}Ask about this</button>
      </div>` : null}
    </div>`;
}

/* Tokens from `markdown.js` -> vnodes. The chapter body is markdown and was
   printed raw until now, so a reader saw `# Analysis Techniques` and
   `[source: cohort-analysis.md]` as literal text on the page.

   A source marker becomes a small chip carrying the source's title rather than
   its filename. It is kept rather than hidden: the marker is the course saying
   which document a sentence came from, and that is the same thing the GRADE
   trace is for -- one is the author's attribution, the other is my check of it,
   and they disagree often enough to be worth seeing side by side.

   Every branch here builds vnodes, never markup. Course text is data and gets
   escaped by Preact like any other string. */
function inlineRun(tokens, sources) {
  return tokens.map((t, i) => {
    if (t.t === 'strong') return html`<b key=${i}>${t.v}</b>`;
    if (t.t === 'em') return html`<i key=${i}>${t.v}</i>`;
    if (t.t === 'code') return html`<code key=${i}>${t.v}</code>`;
    if (t.t === 'link') return html`<a key=${i} href=${t.href} target="_blank" rel="noopener">${t.v}</a>`;
    if (t.t === 'source') return html`<span key=${i} class="srcmark">${sourceLabel(t.v, sources)}</span>`;
    return t.v;
  });
}

function block(b, marks, sources) {
  const run = (tokens) => inlineRun(tokens, sources);
  // parts of one block, in order; the block's marks go after the last of them
  if (b.kind === 'mixed') return b.parts.map((part, i) => block(part, i === b.parts.length - 1 ? marks : [], sources));
  if (b.kind === 'blank') return marks.length ? html`<p class="claim">${marks}</p>` : null;
  if (b.kind === 'hr') return html`<hr />${marks}`;
  if (b.kind === 'heading') {
    const H = 'h' + Math.min(b.level + 1, 6); // the page's own h1 is the app bar
    return html`<${H} class=${'rh rh' + b.level}>${run(b.content)}${marks}<//>`;
  }
  if (b.kind === 'code') return html`<pre class="rcode"><code>${b.text}</code></pre>${marks}`;
  if (b.kind === 'ul') return html`<ul class="rlist">${b.items.map((it, i) => html`<li key=${i}>${run(it)}</li>`)}</ul>${marks}`;
  if (b.kind === 'ol') return html`<ol class="rlist" start=${b.start}>${b.items.map((it, i) => html`<li key=${i}>${run(it)}</li>`)}</ol>${marks}`;
  if (b.kind === 'table') {
    return html`<div class="rtablewrap"><table class="rtable">
      ${b.header ? html`<thead><tr>${b.header.map((c, i) => html`<th key=${i}>${run(c)}</th>`)}</tr></thead>` : null}
      <tbody>${b.rows.map((r, i) => html`<tr key=${i}>${r.map((c, j) => html`<td key=${j}>${run(c)}</td>`)}</tr>`)}</tbody>
    </table></div>${marks}`;
  }
  return html`<p class="claim">${run(b.content)}${marks}</p>`;
}

/* The reading view -- build step 7, the app's half.

   A mark sits inline immediately after the paragraph its claim was drawn from,
   the way a citation marker sits at the end of a sentence; the right-margin
   gutter the demo started with is deliberately gone. The server decides which
   paragraph each mark belongs to (`claims.ts`), because that is a measurement
   against the chapter text rather than a rendering decision.

   A claim the server could not place carries `paragraph: null` and is listed
   under the chapter instead of being attached to a guess. That is eight of the
   2,607 claims in the live database, and putting one of them under the wrong
   paragraph would attribute a source to text that did not produce it. */
function Chapter({ id, onTitle }) {
  const { loading, error, data } = useJSON(`/api/chapters/${encodeURIComponent(id)}`);
  const [open, setOpen] = useState(null);
  const [asking, setAsking] = useState(null);
  useEffect(() => { if (data && onTitle) onTitle(data.chapter.title); }, [data]);
  if (loading) return html`<${Loading} />`;
  if (error) return html`<${Failed} error=${error} />`;
  if (asking) return html`<${ClaimTalk} claim=${asking} where=${data.chapter.title} back=${() => setAsking(null)} />`;

  const claims = data.claims || [];
  const sources = data.sources || {};
  const byParagraph = new Map();
  const unplaced = [];
  for (const c of claims) {
    if (c.paragraph === null || c.paragraph === undefined) { unplaced.push(c); continue; }
    if (!byParagraph.has(c.paragraph)) byParagraph.set(c.paragraph, []);
    byParagraph.get(c.paragraph).push(c);
  }
  const toggle = (cid) => setOpen((was) => (was === cid ? null : cid));
  const mark = (c) => html`<span key=${c.id} class=${'mark ' + (MARK_CLASS[c.grade] || 'm-low')}
      role="button" tabIndex="0" title=${GRADE_WORD[c.grade] || c.grade}
      onClick=${() => toggle(c.id)} />`;

  return html`
    <article class="reading read">
      ${blocksOf(data.chapter.body).map((p, n) => {
        // A chapter written from a wiki page keeps that page's frontmatter as
        // its first block. It is skipped, not cut out of the body: claims are
        // anchored by block index, so removing it would move every mark.
        if (n === 0 && /^---\n[\s\S]*\n---$/.test(p.trim())) return null;
        const here = byParagraph.get(n) || [];
        return html`<div key=${n}>
          ${block(parseBlock(p), here.map(mark), sources)}
          ${here.filter((c) => c.id === open).map((c) => html`<${Trace} key=${c.id} claim=${c} sources=${sources} onAsk=${setAsking} />`)}
        </div>`;
      })}
    </article>
    ${unplaced.length ? html`
      <div class="sectitle">Also claimed in this chapter</div>
      <div class="card">
        <p class="supporting">${unplaced.length} claim${unplaced.length === 1 ? '' : 's'} could not be
          matched to a single paragraph of this text, so ${unplaced.length === 1 ? 'it is' : 'they are'}
          listed here rather than marked in the wrong place.</p>
        ${unplaced.map((c) => html`<div key=${c.id} style="margin-top:10px">
          <p style="margin:0 0 4px">${c.text}${mark(c)}</p>
          ${c.id === open ? html`<${Trace} claim=${c} sources=${sources} onAsk=${setAsking} />` : null}
        </div>`)}
      </div>` : null}`;
}

const postJSON = (url, body) =>
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `${r.status} from ${url}`);
    return data;
  });

/* One open discussion with Aristoteles -- build step 5.
   Agora holds the transcript, so this polls rather than storing messages: the
   reply is written by a model somewhere else and arrives whenever it arrives.
   Polling stops as soon as it lands, because `waiting` is false once the last
   message is his rather than Edvard's. */
function Discussion({ id, onTitle, placeholder = 'Ask Aristoteles…' }) {
  const [state, setState] = useState({ loading: true });
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const end = useRef(null);

  const load = () =>
    getJSON(`/api/discussions/${encodeURIComponent(id)}/messages`).then(
      (data) => { setState({ data }); onTitle && onTitle(data.discussion.title); },
      (err) => setState({ error: String(err.message || err) }),
    );

  useEffect(() => { load(); }, [id]);

  useEffect(() => {
    if (!state.data || !state.data.waiting) return;
    const t = setTimeout(load, 3000);
    return () => clearTimeout(t);
  }, [state.data]);

  useEffect(() => { end.current && end.current.scrollIntoView({ block: 'end' }); }, [state.data]);

  const send = (e) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    postJSON(`/api/discussions/${encodeURIComponent(id)}/messages`, { text }).then(
      () => { setDraft(''); setSending(false); load(); },
      (err) => { setSending(false); setState((s) => ({ ...s, error: String(err.message || err) })); },
    );
  };

  if (state.loading) return html`<${Loading} />`;
  if (state.error && !state.data) return html`<${Failed} error=${state.error} />`;
  const { messages, waiting, discussion } = state.data;
  const about = discussion.about;
  return html`
    ${about && about.kind === 'claim' ? html`<${AboutClaim} about=${about} />` : null}
    <div class="chat">
      ${messages.map((m, n) => html`
        <div key=${n} class=${'bub ' + (m.sender === 'Edvard' ? 'e' : 'a')}>${m.text}</div>`)}
      ${waiting ? html`<div class="bub a supporting">Aristoteles is thinking…</div>` : null}
      <div ref=${end}></div>
    </div>
    ${state.error ? html`<p class="supporting">${state.error}</p>` : null}
    <form class="composer" onSubmit=${send}>
      <input value=${draft} disabled=${sending} placeholder=${placeholder}
             onInput=${(e) => setDraft(e.target.value)} />
      <button class="iconbtn" type="submit" aria-label="Send">${I('send')}</button>
    </form>`;
}

const AboutClaim = ({ about }) => html`
  <div class=${'trace' + (about.grade === 'ungrounded' ? ' un' : '')} style="margin-bottom:14px">
    <div class="lvl">${GRADE_WORD[about.grade] || 'A claim'} · asking about this claim</div>
    <div>${about.text}</div>
  </div>`;

/* A thread that does not exist until he says something in it -- the demo's
   ClaimTalk and GeneralTalk open onto an empty composer, and creating the
   Agora conversation on open would leave an empty thread in his list every
   time he looked and closed. The first send creates it, carrying `about`, and
   from then on it is an ordinary Discussion. */
function NewThread({ title, about, workshop }) {
  const [id, setId] = useState(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  if (id) return html`<${Discussion} id=${id} />`;
  const send = (e) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    postJSON('/api/discussions', { title: title.slice(0, 200), about, ...(workshop ? { workshop } : {}) })
      .then((d) => postJSON(`/api/discussions/${encodeURIComponent(d.discussion.id)}/messages`, { text })
        .then(() => setId(d.discussion.id)))
      .catch((err) => { setSending(false); setError(String(err.message || err)); });
  };
  return html`
    ${about.kind === 'claim' ? html`<${AboutClaim} about=${about} />` : null}
    <div class="chat">
      <div class="bub a">${about.kind === 'claim'
        ? 'Ask about this claim, or push back on it.'
        : `Ask about “${about.text}”, or push back on it — that is usually more useful.`}</div>
    </div>
    ${error ? html`<p class="supporting">${error}</p>` : null}
    <form class="composer" onSubmit=${send}>
      <input value=${draft} disabled=${sending} placeholder="Ask Aristoteles…"
             onInput=${(e) => setDraft(e.target.value)} />
      <button class="iconbtn" type="submit" aria-label="Send">${I(sending ? 'hourglass_empty' : 'send')}</button>
    </form>`;
}

/* Asking about one claim, inside the reading view -- the demo's ClaimTalk. */
function ClaimTalk({ claim, where, back }) {
  return html`
    <button onClick=${back} style="background:none;border:0;padding:4px 0 10px;
      color:var(--primary);font:500 13px Roboto,sans-serif;cursor:pointer">‹ Back to chapter</button>
    <${NewThread} title=${claim.text.length > 80 ? claim.text.slice(0, 80).replace(/\s+\S*$/, '') + '…' : claim.text} about=${{ kind: 'claim', text: claim.text, grade: claim.grade, where }} />`;
}

/* The Discuss button over a course, chapter or workshop project -- the demo's
   GeneralTalk, a full-screen sheet over what he was reading rather than a jump
   to another tab. From a project it is a workshop discussion at the stage he
   is looking at, so it lists on the bench there like a tool's thread does. */
function GeneralTalk({ title, where, close, about, workshop }) {
  return html`
    <div class="quizwrap">
      <div class="qtop">
        <div class="grow" style="flex:1;min-width:0">
          <div style="font:500 16px/22px Roboto,sans-serif;white-space:nowrap;
            overflow:hidden;text-overflow:ellipsis">${title}</div>
          <div class="supporting">New discussion</div>
        </div>
        <button class="btn text" onClick=${close}>Close</button>
      </div>
      <div style="flex:1;overflow-y:auto;padding-top:14px">
        <${NewThread} title=${title} about=${about || { kind: 'chapter', text: title, where }} workshop=${workshop} />
      </div>
    </div>`;
}

const ago = (iso) => {
  if (!iso) return '';
  const m = (Date.now() - Date.parse(iso)) / 60000;
  if (m < 60) return `${Math.max(1, Math.round(m))}m`;
  if (m < 1440) return `${Math.round(m / 60)}h`;
  if (m < 2880) return 'Yesterday';
  return `${Math.round(m / 1440)}d`;
};

/* The global Aristoteles tab: per-topic threads, newest first. The spec's own
   reason for a list rather than one endless chat -- "in those chats I ask Ari
   to create a new workshop for me or create a new course". */
function Discussions({ onOpen }) {
  const [state, setState] = useState({ loading: true });
  const [starting, setStarting] = useState(false);

  const load = () =>
    getJSON('/api/discussions').then(
      (data) => setState({ data }),
      (err) => setState({ error: String(err.message || err) }),
    );
  useEffect(() => { load(); }, []);

  const start = (preset) => {
    const title = preset || prompt('What do you want to talk about?');
    if (!title || !title.trim() || starting) return;
    setStarting(true);
    postJSON('/api/discussions', { title: title.trim() }).then(
      (data) => { setStarting(false); onOpen(data.discussion.id); },
      (err) => { setStarting(false); setState((s) => ({ ...s, error: String(err.message || err) })); },
    );
  };

  if (state.loading) return html`<${Loading} />`;
  if (state.error && !state.data) return html`<${Failed} error=${state.error} />`;
  const list = state.data.discussions;
  return html`
    ${state.error ? html`<${Failed} error=${state.error} />` : null}
    <div class="dests" style="margin:4px 0 12px">
      <button class="chip" onClick=${() => start('Start a workshop project')}>${I('handyman')}Start a workshop project</button>
      <button class="chip" onClick=${() => start('Build a course')}>${I('school')}Build a course</button>
      <button class="chip" onClick=${() => start()}>${I(starting ? 'hourglass_empty' : 'add')}New thread</button>
    </div>
    ${list.length
      ? list.map((d) => html`
          <div class="card tap" key=${d.id} onClick=${() => onOpen(d.id)}>
            <div class="row">
              <div class="lead" style="flex:0 0 40px;height:40px;border-radius:50%;
                background:var(--primary-container);color:var(--on-primary-container);
                display:flex;align-items:center;justify-content:center">${I('forum')}</div>
              <div class="grow"><h3>${d.title}</h3>
                ${d.about && d.about.where ? html`<p class="supporting">${d.about.where}</p>` : null}</div>
              <span class="supporting">${ago(d.createdAt)}</span>
            </div>
          </div>`)
      : html`<div class="card out"><h3>No threads yet</h3>
          <p class="supporting">Start one and Aristoteles answers in it.</p></div>`}`;
}

/* Practice -- build step 8's half that he can see. The layout, the class names
   and the feedback shapes are the approved demo's, ported onto real cards; the
   spec's hardest line is "do not redesign what the demo already settled".

   Two rules from the spec are carried in code rather than in copy. A card
   never claims more confidence than the claim under it, so a `design` card --
   the one made from something he asserted and no source tests -- gets neutral
   feedback and is never marked wrong. And nothing is scheduled: the end screen
   has a count and a "worth another look" list, no streak and no next date. */
const GRADE_WORD = {
  high: 'High confidence',
  moderate: 'Moderate confidence',
  low: 'Low confidence',
  ungrounded: 'Untested — this is yours, not a finding',
};

const norm = (v) => String(v).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/* Cloze is typed, so it needs a comparison rather than a click. A stored answer
   often carries its own gloss -- "click-through rate (CTR)" -- so either side
   containing the other counts, and nothing under three characters counts at
   all, because "a" is inside almost every answer there is. */
const clozeOk = (typed, answer) => {
  const t = norm(typed);
  const a = norm(answer);
  if (t.length < 3) return false;
  return t === a || a.includes(t) || t.includes(a);
};

const CHOICE = ['multiple_choice', 'true_false'];
const TYPED = ['written', 'design'];
const KIND = {
  multiple_choice: 'Multiple choice',
  true_false: 'True or false',
  cloze: 'Fill the blank',
  written: 'Write an answer',
  design: 'What would test this?',
};

function Practice({ slug, onClose, onAsk }) {
  const { loading, error, data } = useJSON(`/api/courses/${slug}/practice`, { cache: false });  // ordered by his last answers; a stale deck would swap cards mid-session
  const [i, setI] = useState(0);
  const [sel, setSel] = useState(null);
  const [text, setText] = useState('');
  const [shown, setShown] = useState(false);
  const [missed, setMissed] = useState([]);
  const [log, setLog] = useState([]);
  const sent = useRef(false);

  const cards = (data && data.cards) || [];
  const over = cards.length > 0 && i >= cards.length;

  /* Reported once, when the session is over rather than per card: the only
     reader is the ordering of the next session, and a failed write costs him
     nothing he can see, so it must not be able to break the end screen. */
  useEffect(() => {
    if (!over || sent.current || !log.length) return;
    sent.current = true;
    postJSON('/api/practice/answers', { answers: log }).catch(() => {});
  }, [over, log]);

  if (loading) return html`<${Loading} />`;
  if (error) return html`<${Failed} error=${error} />`;
  if (!cards.length) {
    return html`
      <${NotBuiltYet} title="No cards for this course yet" step="8"
        what="Cards are generated from this course's claim atoms." />
      <button class="btn text" onClick=${onClose}>Back</button>`;
  }

  if (over) {
    const graded = log.filter((a) => a.result === 'correct' || a.result === 'missed').length;
    return html`
      <div class="quizwrap">
        <div class="qtop"><div class="grow"></div>
          <button class="btn text" onClick=${onClose}>Close</button></div>
        <div class="qbody">
          <div class="done">
            <div class="big">${graded - missed.length}<span style="opacity:.4">/${graded}</span></div>
            <p class="supporting">${data.course.title}</p>
          </div>
          ${missed.length ? html`
            <div class="sectitle">Worth another look</div>
            <div class="card">
              ${missed.map((n) => html`
                <div class="li" key=${n}>
                  <div class="lead">${I('help')}</div>
                  <div class="txt" style="font-size:14.5px;line-height:20px">${cards[n].prompt}</div>
                </div>`)}
            </div>` : null}
        </div>
        <div class="qact">
          ${missed.length ? html`
            <button class="btn tonal"
              onClick=${() => onAsk(`Practice: ${cards[missed[0]].prompt}`)}>
              ${I('forum')}Discuss these</button>` : null}
          <button class="btn filled" onClick=${onClose}>Done</button>
        </div>
      </div>`;
  }

  const c = cards[i];
  const choice = CHOICE.includes(c.cardType);
  const typed = TYPED.includes(c.cardType);
  const hypothesis = c.cardType === 'design';
  /* A written answer is shown its model answer and not marked: the spec leaves
     strict-versus-lenient grading open, and a keyword match would be the strict
     version by accident. */
  const correct = typed ? true : choice ? c.options[sel] === c.answer : clozeOk(text, c.answer);
  const ready = choice ? sel !== null : text.trim().length > 0;

  const record = (result) => setLog((l) => [...l, { cardId: c.id, result }]);
  const next = (result) => {
    record(result);
    if (result === 'missed') setMissed((m) => [...m, i]);
    setI(i + 1); setSel(null); setText(''); setShown(false);
  };

  return html`
    <div class="quizwrap">
      <div class="qtop">
        <div class="qprog"><i style=${{ width: (i / cards.length * 100) + '%' }}></i></div>
        <button class="btn text" onClick=${onClose}>Close</button>
      </div>

      <div class="qbody">
        <p class="qkind">${KIND[c.cardType] || c.cardType} · card ${i + 1} of ${cards.length}</p>
        <p class="qq">${c.cardType === 'cloze'
          ? html`${c.prompt.split('___')[0]}<span class="cloze">${text || ' '}</span>${c.prompt.split('___')[1] || ''}`
          : c.prompt}</p>

        ${choice ? html`
          <div class="qopts">
            ${c.options.map((o, k) => html`
              <button key=${k} disabled=${shown}
                class=${'qopt' + (shown
                  ? (o === c.answer ? ' right' : (k === sel ? ' wrong' : ' muted'))
                  : (sel === k ? ' sel' : ''))}
                onClick=${() => setSel(k)}>${o}</button>`)}
          </div>`
        : html`
          <textarea class="qinput" placeholder="Your answer…" value=${text}
            onInput=${(e) => setText(e.target.value)} disabled=${shown}></textarea>`}

        ${shown ? html`
          <div class=${'fb ' + (hypothesis ? 'neutral' : correct ? 'ok' : 'no')}>
            <div class="hd">
              ${I(hypothesis ? 'science' : correct ? 'check_circle' : 'cancel')}
              ${hypothesis ? 'Your hypothesis' : correct ? 'Correct' : 'Not quite'}
            </div>
            ${typed || !correct ? html`<p><b>${hypothesis ? 'One way to test it:' : 'A good answer:'}</b> ${c.answer}</p>` : null}
            ${c.why ? html`<p>${c.why}</p>` : null}
            <div class="srcx">
              ${GRADE_WORD[c.grade] || c.grade}${c.sources.length ? ' · ' + c.sources.join(', ') : ''}
            </div>
            <div class="act">
              <button class="btn text" style="color:inherit"
                onClick=${() => onAsk(`Practice: ${c.prompt}`)}>${I('forum')}Ask about this</button>
            </div>
          </div>` : null}
      </div>

      <div class="qact">
        ${!shown ? html`
          <button class="btn text" onClick=${() => next('skipped')}>Skip</button>
          <button class="btn filled" disabled=${!ready} onClick=${() => setShown(true)}>Check</button>`
        : html`
          <button class="btn filled"
            onClick=${() => next(typed ? 'seen' : correct ? 'correct' : 'missed')}>
            ${i + 1 >= cards.length ? 'Finish' : 'Next'}</button>`}
      </div>
    </div>`;
}

function Home({ onOpen, onOpenChapter, onPractise }) {
  const { loading, error, data } = useJSON('/api/courses');
  if (loading) return html`<${Loading} />`;
  if (error) return html`<${Failed} error=${error} />`;
  const on = data.courses.filter((c) => statusOf(c.slug) === 'active');
  const ready = on.filter((c) => c.cardCount > 0);
  return html`
    <div class="sectitle">Where you left off</div>
    ${!on.length ? html`<p class="supporting" style="margin:0 4px 4px">
      No course enrolled. Enrol in one under Courses.</p>` : null}
    ${on.map((c) => { const u = hue(c.slug), at = placeOf(c.slug); return html`
      <div class="card tinted tap" key=${c.slug} style=${{ '--c-bg': u.bg, '--c-fg': u.fg }}
           onClick=${() => (at ? onOpenChapter(c.slug, at.id, c.title) : onOpen(c.slug))}>
        <div class="row">
          <div class="avatar" style=${{ background: 'rgba(255,255,255,.55)', color: u.fg }}>${I(u.ic)}</div>
          <div class="grow">
            <h3>${c.title}</h3>
            <p class="supporting">${at ? `${at.n}. ${at.title}` : `${c.chapterCount} ${c.chapterCount === 1 ? 'chapter' : 'chapters'} · not started`}</p>
          </div>
          ${I('chevron_right', 'trail')}
        </div>
        <div class="lin"><i style=${{ width: (at ? (at.n - 1) / c.chapterCount * 100 : 0) + '%' }}></i></div>
      </div>`; })}

    <div class="sectitle s2">Practice, whenever you feel like it</div>
    <div class="card practice">
      ${ready.map((c) => html`
        <div class="li" key=${c.slug}>
          <div class="lead">${I('style')}</div>
          <div class="txt">${c.title}
            <div class="sub">${c.cardCount} cards ready</div></div>
          <button class="btn filled sm" style="background:var(--secondary);color:#fff"
                  onClick=${() => onPractise(c.slug)}>Practice</button>
        </div>`)}
      ${!ready.length ? html`<p class="supporting" style="margin:0">No cards yet for an enrolled course.</p>` : null}
    </div>
    <p class="supporting" style="margin:0 4px 4px">
      Nothing is due, nothing expires.</p>`;
}

/* The demo's Note sheet, as approved: the note is appended to the vault file
   the chip names. The chips and their order are the demo's DESTS. */
const DESTS = [
  'work/platform/projects/platform atlas/notes.md',
  'projects/sokrates/projects/nova/notes.md',
  'learn.md',
  'notes.md',
];

function NoteSheet({ close, onSaved }) {
  const [dest, setDest] = useState(DESTS[0]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = () => {
    setBusy(true); setErr('');
    postJSON('/api/notes', { text, dest })
      .then(() => onSaved(dest),
            () => { setBusy(false); setErr('Could not save. Your text is still here.'); });
  };
  return html`
    <div class="scrim" onClick=${close}></div>
    <div class="sheet">
      <div class="grab"></div>
      <h3>New note</h3>
      <textarea placeholder="Write it down now. Shape it later."
        value=${text} onInput=${(e) => setText(e.target.value)}></textarea>
      <div class="sectitle s3" style="margin:14px 0 2px">Where it goes</div>
      <div class="dests">
        ${DESTS.map((d) => html`
          <button class=${'chip' + (dest === d ? ' on' : '')} key=${d} onClick=${() => setDest(d)}>
            ${dest === d ? I('check') : null}${d.split('/').slice(-2).join('/')}
          </button>`)}
        <button class="chip">${I('add')}New topic</button>
      </div>
      ${err ? html`<p class="supporting" style="color:var(--error)">${err}</p>` : null}
      <div class="sheetact">
        <button class="btn text" onClick=${close}>Cancel</button>
        <button class="btn filled" disabled=${busy || !text.trim()} onClick=${save}>Save</button>
      </div>
    </div>`;
}

/* ---- Workshop (build step 10): the demo's Workshop, Bench, StageSheet,
   FileList and FileView, on the /api/workshop records. The tools are the
   demo's; Start runs one as a real Aristoteles discussion and shows his reply
   in the demo's output card. */
const TOOLS = [
  { id: 'endoxa', name: 'Prior art', gloss: 'What has already been said', ic: 'search' },
  { id: 'horismos', name: 'Define', gloss: 'Pin down the terms', ic: 'label' },
  { id: 'elenchus', name: 'Interrogate', gloss: 'Question it to breaking point', ic: 'help' },
  { id: 'aporia', name: 'Impasse', gloss: 'Find where it gets stuck', ic: 'report' },
  { id: 'causes', name: 'Four causes', gloss: 'Why it exists at all', ic: 'account_tree' },
  { id: 'syllogism', name: 'Check the logic', gloss: 'Does the conclusion follow', ic: 'rule' },
  { id: 'falsify', name: 'Falsify', gloss: 'What would prove it wrong', ic: 'science' },
  { id: 'empeiria', name: 'Evidence plan', gloss: 'How to actually test it', ic: 'fact_check' },
];
const STAGE_TOOLS = {
  problem: ['endoxa', 'elenchus', 'aporia'],
  objectives: ['horismos', 'syllogism', 'falsify'],
  design: ['causes', 'aporia', 'horismos'],
  demo: ['empeiria', 'elenchus'],
  evaluation: ['falsify', 'empeiria', 'syllogism'],
  communication: ['endoxa', 'horismos'],
};
const DSRM = [
  { k: 'problem', n: 'Problem', g: 'What is wrong, and why it matters' },
  { k: 'objectives', n: 'Objectives', g: 'What a solution would have to do' },
  { k: 'design', n: 'Design & development', g: 'Build the thing' },
  { k: 'demo', n: 'Demonstration', g: 'Show it works at all' },
  { k: 'evaluation', n: 'Evaluation', g: 'Measure how well, against the objectives' },
  { k: 'communication', n: 'Communication', g: 'Write it up so others can use it' },
];
const stageIx = (k) => DSRM.findIndex((d) => d.k === k);
const fileIcon = (e) => e === 'jsx' || e === 'js' ? 'code' : e === 'pptx' ? 'slideshow'
  : e === 'png' || e === 'svg' ? 'bar_chart' : e === 'zip' ? 'folder_zip' : 'description';

function Workshop({ onOpen }) {
  const { loading, error, data } = useJSON('/api/workshop');
  if (loading) return html`<${Loading} />`;
  if (error) return html`<${Failed} error=${error} />`;
  return html`
    ${data.projects.map((t) => html`
      <div class="card tap" key=${t.slug} onClick=${() => onOpen(t)}>
        <div class="row" style="margin-bottom:6px">
          <div class="grow"><h3>${t.title}</h3></div>
          <span class=${'chip stat ' + (t.stage === 'communication' ? 'theory' : 'hyp')}>
            ${stageIx(t.stage) + 1}. ${DSRM[stageIx(t.stage)].n}</span>
        </div>
        <p style="margin:0 0 8px;font-size:15px;line-height:21px">${t.line}</p>
        <p class="supporting">${t.fileCount} files</p>
      </div>`)}`;
}

function FileList({ files, open }) {
  return html`
    <div class="card">
      ${files.map((f) => html`
        <div class="filerow" key=${f.path} onClick=${() => open(f)}>
          <div class="fi">${I(fileIcon(f.ext))}</div>
          <div class="fn">${f.name}</div>
          ${f.ext && f.ext !== 'md' ? html`<span class="ft">${f.ext}</span>` : null}
        </div>`)}
    </div>`;
}

function FileView({ slug, file }) {
  const { loading, error, data } = useJSON(`/api/workshop/${encodeURIComponent(slug)}/file?path=${encodeURIComponent(file.path)}`);
  return html`
    <div class="docbar">
      <div class="grow"><div class="docpath">${file.path}</div></div>
    </div>
    ${loading ? html`<${Loading} />` : error ? html`<${Failed} error=${error} />`
      : file.ext === 'md' ? html`<div class="doc">${blocksOf(data.file.text).map((p, n) => html`<div key=${n}>${block(parseBlock(p), [], {})}</div>`)}</div>`
      : html`<pre class="doc" style="white-space:pre-wrap;overflow-x:auto">${data.file.text}</pre>`}`;
}

function StageSheet({ open, here, close, pick }) {
  return html`
    <div class="scrim" onClick=${close}></div>
    <div class="sheet">
      <div class="grab"></div>
      <h3>Design Science Research</h3>
      ${DSRM.map((d, i) => {
        const done = i < here, cur = i === here, sel = i === open;
        return html`
          <div class=${'li' + (done ? ' read' : '') + (cur ? ' now' : '')} key=${d.k}
               onClick=${() => { pick(i); close(); }}
               style=${sel ? { background: 'var(--tertiary-container)', borderRadius: '12px',
                               margin: '2px -8px', padding: '10px 8px' } : null}>
            <div class="lead">${done ? I('check') : i + 1}</div>
            <div class="txt" style="font-size:15px;line-height:20px">
              ${d.n}<div class="sub">${d.g}</div></div>
            ${cur ? html`<span class="chip stat hyp">here</span>` : null}
          </div>`;
      })}
    </div>`;
}

/* A tool run is a real discussion: created, sent the tool's instruction, and
   read back until Aristoteles has answered. */
function runTool(project, stage, tool) {
  const title = `${tool.name} · ${project.title}`;
  const text = `${tool.name} — ${tool.gloss.toLowerCase()}. Run it against my workshop project "${project.title}", now at DSRM stage ${stageIx(stage.k) + 1}, ${stage.n.toLowerCase()}. The project's statement: ${project.line}`;
  return postJSON('/api/discussions', { title: title.slice(0, 200), workshop: { project: project.slug, stage: stage.k } }).then((d) =>
    postJSON(`/api/discussions/${encodeURIComponent(d.discussion.id)}/messages`, { text }).then(() => d.discussion.id));
}
function awaitReply(id) {
  return getJSON(`/api/discussions/${encodeURIComponent(id)}/messages`).then((data) => {
    if (data.waiting) return new Promise((r) => setTimeout(r, 3000)).then(() => awaitReply(id));
    const last = [...data.messages].reverse().find((m) => m.sender !== 'Edvard');
    return last ? last.text : '';
  });
}

/* The demo's DiscussionView: a discussion opened on the bench, read and
   continued in place. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayMonth = (iso) => { if (!iso) return ''; const d = new Date(iso); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
const countLine = (d) => (d.messages === null ? '' : `${d.messages} messages · `);
function StageDiscussion({ d }) {
  return html`
    <p class="supporting" style="margin:0 0 10px">${countLine(d)}with Aristoteles · ${dayMonth(d.createdAt)}</p>
    <${Discussion} id=${d.id} placeholder="Continue…" />`;
}

function Bench({ slug, stageIn, setStageIn, refresh, openFile, openDisc }) {
  const [version, setVersion] = useState(0);
  useEffect(() => { if (refresh) setVersion((v) => v + 1); }, [refresh]);
  const { loading, error, data } = useJSON(`/api/workshop/${encodeURIComponent(slug)}${version ? `?v=${version}` : ''}`);
  const open = stageIn === undefined ? null : stageIn;
  const [tool, setTool] = useState(null);
  const [all, setAll] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [ran, setRan] = useState({});
  const [busy, setBusy] = useState(false);
  const [runError, setRunError] = useState(null);
  const [saved, setSaved] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  if (loading) return html`<${Loading} />`;
  if (error) return html`<${Failed} error=${error} />`;

  const theory = data.project;
  const here = stageIx(theory.stage);
  const at = open === null ? here : open;
  const stage = DSRM[at];
  const stageData = theory.stages[at];

  const ids = all ? TOOLS.map((t) => t.id) : STAGE_TOOLS[stage.k];
  const shown = ids.map((id) => TOOLS.find((t) => t.id === id));
  const key = tool ? `${at}:${tool.id}` : null;
  const pick = (i) => { setStageIn(i); setTool(null); setAll(false); };
  const run = () => {
    setBusy(true); setRunError(null);
    runTool(theory, stage, tool).then(awaitReply).then(
      (reply) => { setBusy(false); setRan({ ...ran, [key]: reply }); setVersion(version + 1); },
      (err) => { setBusy(false); setRunError(String(err.message || err)); });
  };
  // Save as file: the answer becomes a file of this project at this stage.
  const save = () => {
    setSaving(true); setSaveError(null);
    postJSON(`/api/workshop/${encodeURIComponent(slug)}/files`, { tool: tool.name, stage: stage.k, text: ran[key] }).then(
      (d) => { setSaving(false); setSaved({ ...saved, [key]: d.file.path }); setVersion(version + 1); },
      (err) => { setSaving(false); setSaveError(String(err.message || err)); });
  };

  return html`
    <div class="stagebar" onClick=${() => setSheet(true)}>
      <div class="n">${at + 1}</div>
      <div class="t">${stage.n}<div class="of">Stage ${at + 1} of 6${at === here ? '' : ' · you are on ' + (here + 1)}</div></div>
      <div class="pips">
        ${DSRM.map((d, i) => html`<i key=${d.k} class=${i === at ? 'on' : i < here ? 'done' : ''}></i>`)}
      </div>
      ${I('unfold_more')}
    </div>

    <p class="statement">${theory.line}</p>

    <div class="sectitle s2">Discussions</div>
    ${stageData.discussions.length ? stageData.discussions.map((d) => html`
      <div class="card tap" key=${d.id} onClick=${() => openDisc(d)}>
        <div class="row">
          <div class="avatar" style="background:var(--secondary-container);
            color:var(--on-secondary-container)">${I('forum')}</div>
          <div class="grow">
            <h3 style="font-size:15px">${d.title}</h3>
            <p class="supporting">${countLine(d)}${dayMonth(d.createdAt)}</p>
          </div>
          ${I('chevron_right', 'trail')}
        </div>
      </div>`)
    : html`<p class="supporting" style="margin:0 4px 8px">None at this stage.</p>`}
    ${stageData.files.length ? html`
      <div class="sectitle">Files</div>
      <${FileList} files=${stageData.files} open=${openFile} />` : null}

    <div class="sectitle s3">${all ? 'All tools' : 'Tools for ' + stage.n.toLowerCase()}</div>
    <div class="rack">
      ${shown.map((t) => html`
        <button class=${'tool' + (tool && tool.id === t.id ? ' on' : '')} key=${t.id}
                onClick=${() => setTool(tool && tool.id === t.id ? null : t)}>
          ${I(t.ic)}
          <span class="nm">${t.name}</span>
          <span class="gr">${t.gloss}</span>
        </button>`)}
    </div>
    <div class="row" style="justify-content:flex-end;margin:-4px 0 8px">
      <button class="btn text" onClick=${() => { setAll(!all); setTool(null); }}>
        ${all ? 'Show only this stage' : 'Show all tools'}</button>
    </div>

    ${tool && ran[key] === undefined ? html`
      <div class="toolcard">
        <h4>${tool.name}</h4>
        <p>${tool.gloss} — run against this project at stage ${at + 1}, ${stage.n.toLowerCase()}.</p>
        ${runError ? html`<p class="supporting">${runError}</p>` : null}
        <div class="act">
          ${busy ? html`<div class="working"><div class="spin"></div>Aristoteles is working…</div>`
                 : html`<button class="btn start" onClick=${run}>${I('play_arrow')}Start</button>`}
        </div>
      </div>` : null}

    ${tool && ran[key] !== undefined ? html`
      <div class="toolout">
        <div class="who">${tool.name} · Aristoteles</div>
        ${blocksOf(ran[key]).map((p, n) => html`<div key=${n}>${block(parseBlock(p), [], {})}</div>`)}
        <div class="act" style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px">
          <button class="btn text" style="color:var(--on-tertiary-container)"
                  onClick=${() => { const r = { ...ran }; delete r[key]; setRan(r); const v = { ...saved }; delete v[key]; setSaved(v); }}>Run again</button>
          <button class="btn start" disabled=${saving || saved[key] !== undefined} onClick=${save}>
            ${I(saved[key] ? 'check' : 'note_add')}${saved[key] ? 'Saved' : saving ? 'Saving…' : 'Save as file'}</button>
        </div>
        ${saveError ? html`<p class="supporting" style="margin-top:8px">${saveError}</p>` : null}
      </div>` : null}

    ${sheet ? html`<${StageSheet} open=${at} here=${here}
        close=${() => setSheet(false)} pick=${pick} />` : null}`;
}

/* One stack of pages, as in the approved demo: every page (course, chapter,
   practice, workshop project, file, stage discussion, thread) is an entry, the
   first entry is the tab. Swipe right anywhere to go back -- the page you came
   from lies still underneath and the page you are on slides off to the right --
   and the phone's back button pops one page, instantly. */
function App() {
  const [stack, setStack] = useState([{ kind: 'home' }]);
  const [talk, setTalk] = useState(false);
  const [note, setNote] = useState(false);
  const [snack, setSnack] = useState(null);
  const [benchRefresh, setBenchRefresh] = useState(0);
  const [dx, setDx] = useState(0);
  const [anim, setAnim] = useState(false);
  const armed = useRef(false);
  const pendingTab = useRef(null);
  const drag = useRef(null);

  const top = stack[stack.length - 1];
  const tab = stack[0].kind;

  /* The phone's back button: one history entry stands in for "there is somewhere
     to go back to". Popping it pops one page; it is re-armed while the stack is deep. */
  useEffect(() => {
    const onPop = () => {
      armed.current = false;
      const t = pendingTab.current; pendingTab.current = null;
      setDx(0); setAnim(false); setTalk(false); setNote(false);
      if (t) setStack(Array.isArray(t) ? t : [{ kind: t }]);
      else setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  useEffect(() => {
    if (stack.length > 1 && !armed.current) { history.pushState({ lyceum: 1 }, ''); armed.current = true; }
  }, [stack.length]);

  const push = (v) => setStack((s) => [...s, v]);
  const back = () => {
    if (armed.current) history.back();
    else { setDx(0); setAnim(false); setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)); }
  };
  // Replace the whole stack (a tab, or a jump like Home -> a chapter), unwinding the history entry first.
  const reset = (s) => {
    if (armed.current) { pendingTab.current = s; history.back(); } else setStack(s);
  };
  const toTab = (t) => reset([{ kind: t }]);
  // A page learns its own title after it loads; it is kept on its entry so going back shows it at once.
  const patchAt = (depth, p) => setStack((s) => (s[depth] ? [...s.slice(0, depth), { ...s[depth], ...p }, ...s.slice(depth + 1)] : s));

  /* "Ask about this" is the gesture that makes practice tutoring rather than
     marking (the spec's Khanmigo line), so it opens a real Aristoteles thread
     rather than a dead button: one discussion, titled after the card. */
  const ask = (title) => {
    postJSON('/api/discussions', { title: title.slice(0, 200) }).then((data) => {
      reset([{ kind: 'aristoteles' }, { kind: 'thread', id: data.discussion.id }]);
    }, () => {});
  };

  const view = (v, depth) => {
    const titled = (t) => patchAt(depth, { title: t });
    switch (v.kind) {
      case 'home': return { title: 'Lyceum', body: html`<${Home}
          onOpen=${(slug) => push({ kind: 'course', slug })}
          onOpenChapter=${(slug, id, name) => reset([{ kind: 'courses' }, { kind: 'course', slug, title: name }, { kind: 'chapter', id, courseTitle: name }])}
          onPractise=${(slug) => push({ kind: 'practice', slug })} />` };
      case 'courses': return { title: 'Courses', body: html`<${Courses} onOpen=${(slug) => push({ kind: 'course', slug })} />` };
      case 'workshop': return { title: 'Workshop', body: html`<${Workshop} onOpen=${(project) => push({ kind: 'project', project })} />` };
      case 'aristoteles': return { title: 'Aristoteles', body: html`<${Discussions} onOpen=${(id) => push({ kind: 'thread', id })} />` };
      case 'course': return { title: v.title || 'Course', discuss: true, body: html`<${Course} slug=${v.slug}
          onOpenChapter=${(id) => push({ kind: 'chapter', id, courseTitle: v.title })} onTitle=${titled} />` };
      case 'chapter': return { title: v.courseTitle || 'Reading', discuss: true, body: html`<${Chapter} id=${v.id}
          onTitle=${(t) => patchAt(depth, { chapterTitle: t })} />` };
      case 'practice': return { title: 'Practice', practice: true, body: html`<${Practice} slug=${v.slug} onClose=${back} onAsk=${ask} />` };
      case 'project': return { title: v.project.title, discuss: true, body: html`<${Bench} slug=${v.project.slug}
          stageIn=${v.stage} setStageIn=${(i) => patchAt(depth, { stage: i })} refresh=${benchRefresh}
          openFile=${(file) => push({ kind: 'file', slug: v.project.slug, file })}
          openDisc=${(d) => push({ kind: 'disc', d })} />` };
      case 'file': return { title: v.file.path.split('/').pop(), body: html`<${FileView} slug=${v.slug} file=${v.file} />` };
      case 'disc': return { title: v.d.title, chat: true, body: html`<${StageDiscussion} d=${v.d} />` };
      case 'thread': return { title: v.title || 'Aristoteles', chat: true, body: html`<${Discussion} id=${v.id} onTitle=${titled} />` };
    }
  };

  /* Swipe right anywhere to go back. */
  const W = () => window.innerWidth || 400;
  const onTouchStart = (e) => {
    if (stack.length < 2 || anim || talk || note) return;
    const p = e.touches[0];
    drag.current = { x: p.clientX, y: p.clientY, dx: 0, lock: null, t: Date.now() };
  };
  const onTouchMove = (e) => {
    const d = drag.current; if (!d) return;
    const p = e.touches[0]; const mx = p.clientX - d.x, my = p.clientY - d.y;
    if (d.lock === null) {
      if (Math.abs(mx) < 10 && Math.abs(my) < 10) return;
      d.lock = (mx > 0 && Math.abs(mx) > Math.abs(my) * 1.2) ? 'x' : 'y';
    }
    if (d.lock !== 'x') { drag.current = null; return; }
    d.dx = Math.max(0, mx); setDx(d.dx);
  };
  const onTouchEnd = () => {
    const d = drag.current; drag.current = null;
    if (!d || d.lock !== 'x') return;
    const speed = d.dx / Math.max(1, Date.now() - d.t);
    const leave = d.dx > W() * 0.33 || speed > 0.6;
    setAnim(true); setDx(leave ? W() : 0);
    setTimeout(() => { if (leave) back(); else setAnim(false); }, 230);
  };

  const page = (v, depth, isTop, p, style) => html`
    <div class=${'page ' + (isTop ? 'top' : 'under') + (isTop && dx > 0 ? ' moving' : '')}
         style=${style} key=${'p' + depth + v.kind}>
      <header class=${'appbar' + (depth > 0 ? ' hasback' : '')}>
        ${depth > 0 ? html`<button class="iconbtn" onClick=${isTop ? back : null} aria-label="Back">${I('arrow_back')}</button>` : null}
        <h1>${p.title}</h1>
      </header>
      <main class=${p.discuss ? 'stacked' : ''}>${p.body}</main>
    </div>`;

  const depth = stack.length - 1;
  const cur = view(top, depth);
  const under = stack.length > 1 && (dx > 0 || anim) ? stack[depth - 1] : null;

  // Discuss over a course, chapter or workshop project; Note everywhere else.
  const onProject = top.kind === 'project';
  const benchStage = onProject ? DSRM[top.stage ?? stageIx(top.project.stage)] : null;
  const course = stack.find((e) => e.kind === 'course');
  const talkTitle = top.kind === 'chapter' ? (top.chapterTitle || top.courseTitle || '') : onProject ? top.project.title : (top.title || top.slug || '');

  const fab = cur.chat || cur.practice ? null : cur.discuss ? html`
    <div class="fabstack">
      <button class="fab small" aria-label="Note" style="background:var(--primary-container);
        color:var(--on-primary-container)" onClick=${() => setNote(true)}>${I('edit_note')}</button>
      <button class="fab slidein" style="background:var(--tertiary);color:#fff"
              onClick=${() => setTalk(true)}>${I('forum')}Discuss</button>
    </div>` : html`
    <div class="fabstack">
      <button class="fab" style="background:var(--primary);color:#fff"
              onClick=${() => setNote(true)}>${I('edit_note')}Note</button>
    </div>`;

  return html`
    <div class="stage" onTouchStart=${onTouchStart} onTouchMove=${onTouchMove}
         onTouchEnd=${onTouchEnd} onTouchCancel=${onTouchEnd}>
      ${under ? page(under, depth - 1, false, view(under, depth - 1),
          { '--dim': (0.18 * (1 - dx / W())).toFixed(3) }) : null}
      ${page(top, depth, true, cur,
          { transform: dx ? `translateX(${dx}px)` : 'none',
            transition: anim ? 'transform .23s cubic-bezier(.2,0,0,1)' : 'none' })}
    </div>
    ${dx ? null : fab}
    <nav class="navbar">
      ${TABS.map((t) => html`
        <button key=${t.id} class=${t.id === tab && stack.length === 1 ? 'on' : ''}
                onClick=${() => toTab(t.id)}>
          <span class="ind">${I(t.icon)}</span>${t.label}
        </button>`)}
    </nav>
    ${talk && !onProject && (top.kind === 'course' || top.kind === 'chapter') ? html`<${GeneralTalk} close=${() => setTalk(false)}
        title=${talkTitle} where=${top.kind === 'chapter' ? (course && course.title) || top.courseTitle || '' : ''} />` : null}
    ${talk && onProject ? html`<${GeneralTalk}
        close=${() => { setTalk(false); setBenchRefresh(benchRefresh + 1); }}
        title=${top.project.title}
        about=${{ kind: 'project', text: top.project.title, ...(benchStage ? { where: benchStage.n.toLowerCase() } : {}) }}
        workshop=${{ project: top.project.slug, stage: benchStage ? benchStage.k : top.project.stage }} />` : null}
    ${note ? html`<${NoteSheet} close=${() => setNote(false)}
        onSaved=${(where) => { setNote(false); setSnack(where); setTimeout(() => setSnack(null), 4000); }} />` : null}
    ${snack ? html`<div class="snack">Saved to <code>${snack}</code></div>` : null}`;
}

render(html`<${App} />`, document.getElementById('app'));
