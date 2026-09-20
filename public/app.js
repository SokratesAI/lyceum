/* Lyceum PWA shell -- build step 4 of projects/sokrates/projects/lyceum/lyceum.md.
   Preact + htm, buildless, per ADR 0010. The Material 3 tokens and the four-tab
   layout are the approved demo's, ported onto the real courses in CouchDB. */
const { html, render, useState, useEffect, useRef } = window.htmPreact;

const I = (n, cls = '') => html`<span class=${'msym ' + cls}>${n}</span>`;

/* Colour is a requirement, not a finish -- every course carries its own identity
   colour and icon across card, avatar and header. Blue is established knowledge,
   amber is his own material (a9s is the platform he runs). */
const IDENTITY = {
  analytics:            { c: '#0B57D0', i: 'insights' },
  'business-finance':   { c: '#00687B', i: 'account_balance' },
  'product-management': { c: '#6750A4', i: 'category' },
  'project-management': { c: '#146C2E', i: 'checklist' },
  'running-a-business': { c: '#8B5000', i: 'storefront' },
  a9s:                  { c: '#B3261E', i: 'dns' },
};
const identity = (slug) => IDENTITY[slug] || { c: '#44474E', i: 'menu_book' };

const TABS = [
  { id: 'home',        icon: 'home',   label: 'Home' },
  { id: 'courses',     icon: 'school', label: 'Courses' },
  { id: 'workshop',    icon: 'science', label: 'Workshop' },
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

function CourseCard({ course, onOpen }) {
  const { c, i } = identity(course.slug);
  return html`
    <div class="card tap" onClick=${() => onOpen(course.slug)}>
      <div class="row">
        <div class="avatar" style=${{ background: c }}>${I(i)}</div>
        <div class="grow">
          <h3>${course.title}</h3>
          <p class="supporting">${course.chapterCount} chapters · ${course.sourceCount} sources</p>
        </div>
        ${I('chevron_right', 'chev')}
      </div>
      <div class="bar"><div class="fill" style=${{ background: c, width: '0%' }}></div></div>
    </div>`;
}

function Courses({ onOpen }) {
  const { loading, error, data } = useJSON('/api/courses');
  if (loading) return html`<${Loading} />`;
  if (error) return html`<${Failed} error=${error} />`;
  if (!data.courses.length) {
    return html`<${NotBuiltYet} title="No courses yet" step="3"
      what="The wiki import has not run against this database." />`;
  }
  return html`
    <div class="sectitle">Enrolled</div>
    ${data.courses.map((c) => html`<${CourseCard} key=${c.slug} course=${c} onOpen=${onOpen} />`)}`;
}

function Course({ slug, onOpenChapter }) {
  const { loading, error, data } = useJSON(`/api/courses/${slug}`);
  if (loading) return html`<${Loading} />`;
  if (error) return html`<${Failed} error=${error} />`;
  const { c, i } = identity(slug);
  return html`
    <div class="card el" style=${{ borderTop: `4px solid ${c}` }}>
      <div class="row">
        <div class="avatar" style=${{ background: c }}>${I(i)}</div>
        <div class="grow"><h3>${data.course.title}</h3>
          <p class="supporting">${data.chapters.length} chapters · ${data.sources.length} sources</p>
        </div>
      </div>
    </div>
    <div class="sectitle">Chapters</div>
    ${data.chapters.map((ch) => html`
      <div class="card tap" key=${ch.id} onClick=${() => onOpenChapter(ch.id)}>
        <div class="row"><div class="grow"><h3>${ch.title}</h3></div>${I('chevron_right', 'chev')}</div>
      </div>`)}
    <div class="sectitle">Sources</div>
    ${data.sources.map((s) => html`
      <div class="card out" key=${s.id}>
        <h3>${s.title}</h3>
        ${s.url ? html`<p class="supporting">${s.url}</p>` : null}
      </div>`)}`;
}

/* The reading view proper -- GRADE marks in the right margin, tappable for the
   source trace -- is build step 7, because it needs claim atoms that do not
   exist yet. This renders the chapter body so the shell is walkable end to end. */
function Chapter({ id }) {
  const { loading, error, data } = useJSON(`/api/chapters/${encodeURIComponent(id)}`);
  if (loading) return html`<${Loading} />`;
  if (error) return html`<${Failed} error=${error} />`;
  return html`
    <article class="reading">${data.chapter.body.split(/\n{2,}/).map((p, n) => html`<p key=${n}>${p}</p>`)}</article>
    <${NotBuiltYet} title="No claim marks yet" step="7"
      what="GRADE marks in the right margin need claim atoms, which are not extracted yet." />`;
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

function Home({ onOpen }) {
  const { loading, error, data } = useJSON('/api/courses');
  if (loading) return html`<${Loading} />`;
  if (error) return html`<${Failed} error=${error} />`;
  const first = data.courses[0];
  return html`
    <div class="sectitle">Where you left off</div>
    ${first
      ? html`<${CourseCard} course=${first} onOpen=${onOpen} />`
      : html`<${NotBuiltYet} title="Nothing started yet" step="3" what="No courses are imported." />`}
    <div class="sectitle">Practice</div>
    <${NotBuiltYet} title="No cards yet" step="8"
      what="Practice cards are generated from claims." />`;
}

function App() {
  const [tab, setTab] = useState('home');
  const [course, setCourse] = useState(null);
  const [chapter, setChapter] = useState(null);
  const [discussion, setDiscussion] = useState(null);
  const [discussionTitle, setDiscussionTitle] = useState('Aristoteles');

  const openCourse = (slug) => { setCourse(slug); setChapter(null); };
  const back = () => {
    if (discussion) return setDiscussion(null);
    return chapter ? setChapter(null) : setCourse(null);
  };
  const inDetail = Boolean(course) || Boolean(discussion);

  let title = TABS.find((t) => t.id === tab).label;
  let body;
  if (chapter) { title = 'Reading'; body = html`<${Chapter} id=${chapter} />`; }
  else if (course) { title = 'Course'; body = html`<${Course} slug=${course} onOpenChapter=${setChapter} />`; }
  else if (tab === 'home') body = html`<${Home} onOpen=${openCourse} />`;
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
    <main>${body}</main>
    <nav class="navbar">
      ${TABS.map((t) => html`
        <button key=${t.id} class=${t.id === tab && !inDetail ? 'on' : ''}
                onClick=${() => { setTab(t.id); setCourse(null); setChapter(null); setDiscussion(null); }}>
          <span class="ind">${I(t.icon)}</span>${t.label}
        </button>`)}
    </nav>`;
}

render(html`<${App} />`, document.getElementById('app'));
