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
const placeOf = (slug) => store.get('place', {})[slug] || null;   // { n, title, id, of }
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

function useJSON(url) {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    let live = true;
    setState({ loading: true });
    getJSON(url).then(
      (data) => live && setState({ data }),
      (err) => live && setState({ error: String(err.message || err) }),
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
function Trace({ claim, sources }) {
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
function Chapter({ id }) {
  const { loading, error, data } = useJSON(`/api/chapters/${encodeURIComponent(id)}`);
  const [open, setOpen] = useState(null);
  if (loading) return html`<${Loading} />`;
  if (error) return html`<${Failed} error=${error} />`;

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
        const here = byParagraph.get(n) || [];
        return html`<div key=${n}>
          ${block(parseBlock(p), here.map(mark), sources)}
          ${here.filter((c) => c.id === open).map((c) => html`<${Trace} key=${c.id} claim=${c} sources=${sources} />`)}
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
          ${c.id === open ? html`<${Trace} claim=${c} sources=${sources} />` : null}
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
function Discussion({ id, onTitle }) {
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
  const { messages, waiting } = state.data;
  return html`
    <div class="chat">
      ${messages.map((m, n) => html`
        <div key=${n} class=${'bub ' + (m.sender === 'Edvard' ? 'e' : 'a')}>${m.text}</div>`)}
      ${waiting ? html`<div class="bub a supporting">Aristoteles is thinking…</div>` : null}
      <div ref=${end}></div>
    </div>
    ${state.error ? html`<p class="supporting">${state.error}</p>` : null}
    <form class="composer" onSubmit=${send}>
      <input value=${draft} disabled=${sending} placeholder="Ask Aristoteles"
             onInput=${(e) => setDraft(e.target.value)} />
      <button class="iconbtn" type="submit" aria-label="Send">${I('send')}</button>
    </form>`;
}

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

  const start = () => {
    const title = prompt('What do you want to talk about?');
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
    <div class="sectitle">Threads</div>
    ${list.length
      ? list.map((d) => html`
          <div class="card tap" key=${d.id} onClick=${() => onOpen(d.id)}>
            <div class="row">
              <div class="avatar" style=${{ background: '#6750A4' }}>${I('forum')}</div>
              <div class="grow"><h3>${d.title}</h3>
                <p class="supporting">${d.createdAt ? d.createdAt.slice(0, 16).replace('T', ' ') : ''}</p>
              </div>
              ${I('chevron_right', 'chev')}
            </div>
          </div>`)
      : html`<div class="card out"><h3>No threads yet</h3>
          <p class="supporting">Start one and Aristoteles answers in it.</p></div>`}
    <button class="fab" onClick=${start} aria-label="New thread">${I(starting ? 'hourglass_empty' : 'add')}</button>`;
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
  const { loading, error, data } = useJSON(`/api/courses/${slug}/practice`);
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

function App() {
  const [tab, setTab] = useState('home');
  const [course, setCourse] = useState(null);
  const [chapter, setChapter] = useState(null);
  const [practice, setPractice] = useState(null);
  const [discussion, setDiscussion] = useState(null);
  const [discussionTitle, setDiscussionTitle] = useState('Aristoteles');
  const [courseTitle, setCourseTitle] = useState('');

  const openCourse = (slug) => { setCourseTitle(''); setCourse(slug); setChapter(null); };
  const back = () => {
    if (practice) return setPractice(null);
    if (discussion) return setDiscussion(null);
    return chapter ? setChapter(null) : setCourse(null);
  };
  /* "Ask about this" is the gesture that makes practice tutoring rather than
     marking (the spec's Khanmigo line), so it opens a real Aristoteles thread
     rather than a dead button: one discussion, titled after the card. */
  const ask = (title) => {
    postJSON('/api/discussions', { title: title.slice(0, 200) }).then((data) => {
      setPractice(null);
      setDiscussionTitle('Aristoteles');
      setTab('aristoteles');
      setDiscussion(data.discussion.id);
    }, () => {});
  };
  const inDetail = Boolean(course) || Boolean(discussion) || Boolean(practice);

  let title = tab === 'home' ? 'Lyceum' : TABS.find((t) => t.id === tab).label;
  let body;
  if (practice) { title = 'Practice'; body = html`<${Practice} slug=${practice} onClose=${() => setPractice(null)} onAsk=${ask} />`; }
  else if (chapter) { title = courseTitle || 'Reading'; body = html`<${Chapter} id=${chapter} />`; }
  else if (course) { title = courseTitle || 'Course'; body = html`<${Course} slug=${course} onOpenChapter=${setChapter} onTitle=${setCourseTitle} />`; }
  else if (tab === 'home') body = html`<${Home} onOpen=${openCourse} onOpenChapter=${(slug, id, name) => { setCourseTitle(name); setCourse(slug); setChapter(id); }} onPractise=${setPractice} />`;
  else if (tab === 'courses') body = html`<${Courses} onOpen=${openCourse} />`;
  else if (tab === 'workshop')
    body = html`<${NotBuiltYet} title="The workshop is not built yet" step="10"
      what="DSRM stage stepper, tool rack and bench log." />`;
  else if (discussion) {
    title = discussionTitle;
    body = html`<${Discussion} id=${discussion} onTitle=${setDiscussionTitle} />`;
  }
  else body = html`<${Discussions} onOpen=${(id) => { setDiscussionTitle('Aristoteles'); setDiscussion(id); }} />`;

  return html`
    <header class=${'appbar' + (inDetail ? ' hasback' : '')}>
      ${inDetail ? html`<button class="iconbtn" onClick=${back} aria-label="Back">${I('arrow_back')}</button>` : null}
      <h1>${title}</h1>
    </header>
    <main class=${course && !practice ? 'stacked' : ''}>${body}</main>
    ${course && !practice ? html`
      <div class="fabstack">
        <button class="fab slidein" style="background:var(--tertiary);color:#fff"
                onClick=${() => ask(courseTitle || course)}>${I('forum')}Discuss</button>
      </div>` : null}
    <nav class="navbar">
      ${TABS.map((t) => html`
        <button key=${t.id} class=${t.id === tab && !inDetail ? 'on' : ''}
                onClick=${() => { setTab(t.id); setCourse(null); setChapter(null); setDiscussion(null); setPractice(null); }}>
          <span class="ind">${I(t.icon)}</span>${t.label}
        </button>`)}
    </nav>`;
}

render(html`<${App} />`, document.getElementById('app'));
