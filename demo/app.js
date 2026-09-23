import { h, render } from 'https://esm.sh/preact@10.23.1';
import { useState, useRef, useEffect } from 'https://esm.sh/preact@10.23.1/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
const html = htm.bind(h);

const I = (n,cls='') => html`<span class=${'msym '+cls}>${n}</span>`;
const GRADE = { high:'High', mod:'Moderate', low:'Low', un:'Ungrounded' };

/* ---------------- data ---------------- */

const READ_OKR = { claims:[
  {g:'high',t:'Specific, difficult goals produce higher performance than vague encouragement to "do your best" — among the most replicated findings in organisational psychology, across roughly 400 studies and four decades.',
   src:{name:'Locke & Latham, A Theory of Goal Setting & Task Performance (1990); meta-analytic review 2002',kind:'Peer-reviewed / textbook',link:'doi:10.1037/0003-066X.57.9.705'}},
  {g:'mod',t:'The effect weakens sharply when the task is novel and complex — on unfamiliar work a hard outcome goal can perform worse than a learning goal aimed at finding a method.',
   src:{name:'Seijts & Latham, Learning versus performance goals (2005)',kind:'Peer-reviewed, narrower replication base',link:'doi:10.5465/ame.2005.15841964'}},
  {g:'low',t:'Separating the goal from the compensation review is commonly recommended so that targets stay ambitious rather than sandbagged.',
   src:{name:'Doerr, Measure What Matters (2018) — practitioner account, not a controlled study',kind:'Expert practitioner',link:'ISBN 9780525536222'}},
  {g:'un',t:'For one person running several parallel projects, three concurrent objectives appears to be the practical ceiling before tracking overhead eats the benefit.',
   src:null,note:'No source found for the single-operator case — the literature is almost entirely about teams and firms. Searched OpenAlex + Crossref, 20 Sep. Your hypothesis: untested, not disproven.'},
]};

const READ_ANA = { claims:[
  {g:'high',t:'A p-value below 0.05 does not mean the result is 95% likely to be true; it is the probability of data this extreme if the null hypothesis were correct. The two are routinely confused, including in published work.',
   src:{name:'Wasserstein & Lazar, The ASA Statement on p-Values (2016), The American Statistician',kind:'Professional body statement',link:'doi:10.1080/00031305.2016.1154108'}},
  {g:'mod',t:'Running a test until it reaches significance, then stopping, inflates the false-positive rate well beyond the nominal 5% — the effect is large enough that peeking is a design flaw, not a minor bias.',
   src:{name:'Simmons, Nelson & Simonsohn, False-Positive Psychology (2011), Psychological Science',kind:'Peer-reviewed, widely replicated',link:'doi:10.1177/0956797611417632'}},
  {g:'un',t:'The note in your raw file says a two-week A/B test is "usually enough" for a product this size.',
   src:null,note:'Traced and contradicted. Required sample size depends on baseline rate and minimum detectable effect, not on elapsed time — for a low-conversion funnel two weeks can be an order of magnitude short. Kept visible rather than deleted, because it is the kind of claim that quietly survives otherwise.'},
]};

const COURSES = [
  { id:'pm', title:'Product Management', status:'active', at:8, ready:6,
    vault:'projects/sokrates/wiki/product-management/',
    built:'LLM wiki · 20 researched sources → 14 pages',
    basis:'Built by a Nova cycle from 20 researched source files. The wiki pages are the chapters; the raw/ files are the sources behind them.',
    dist:{high:6,mod:4,low:2,un:2},
    sources:['jobs-to-be-done.md','kano-model.md','okrs-and-metrics.md','rice-prioritization.md',
             'product-market-fit.md','mvp-and-lean-startup.md','diffusion-of-innovations.md',
             '+ 13 more under raw/'],
    chs:['Fundamentals','Discovery and fit','Jobs to be done','Kano model',
         'Strategy and planning','Prioritization','OKRs and metrics','Product roadmaps',
         'Product lifecycle','Execution','Stakeholders','Go-to-market strategy',
         'Pricing strategies','Net promoter score'],
    reading:{7:READ_OKR} },

  { id:'proj', title:'Project Management', status:'active', at:3, ready:9,
    vault:'projects/sokrates/wiki/project-management/',
    built:'LLM wiki · 17 researched sources → 14 pages',
    basis:'Classical PM plus the failure modes — Brooks\' law, the planning fallacy, scope creep — kept as their own sources.',
    dist:{high:9,mod:3,low:1,un:1},
    sources:['scrum-framework.md','kanban.md','critical-path-method.md','earned-value-management.md',
             'work-breakdown-structure.md','brooks-law.md','planning-fallacy.md','+ 10 more under raw/'],
    chs:['Project lifecycle','Predictive methods','Agile vs waterfall','Agile frameworks',
         'Planning tools','Work breakdown structure','Critical path method','Earned value management',
         'Performance tracking','Managing uncertainty','Change control','Project complexity',
         'Stakeholder management','Risk management'] },

  { id:'ana', title:'Analytics', status:'active', at:1, ready:0,
    vault:'projects/sokrates/wiki/analytics/',
    built:'LLM wiki · 24 researched sources → 10 pages',
    basis:'The densest of the wikis. Half of it is statistical pitfalls — Simpson\'s paradox, p-hacking, survivorship bias, Goodhart\'s law.',
    dist:{high:14,mod:6,low:2,un:2},
    sources:['statistical-significance.md','ab-testing.md','cohort-analysis.md','goodharts-law.md',
             'simpsons-paradox.md','survivorship-bias.md','data-dredging-p-hacking.md','+ 17 more under raw/'],
    chs:['Frameworks','KPIs and metrics','Analysis techniques','Experimentation',
         'Web analytics','Data visualization','Infrastructure','Analytics maturity',
         'Pitfalls','Index'],
    reading:{9:READ_ANA} },

  { id:'fin', title:'Business Finance', status:'paused', at:4, ready:0,
    vault:'projects/sokrates/wiki/business-finance/',
    built:'LLM wiki · 20 researched sources → 13 pages · deepened by cycle 1919',
    basis:'Includes a Norway-specific layer — MVA, employer contributions, owner salary, personal tax — kept separate from the general theory.',
    dist:{high:11,mod:5,low:3,un:1},
    sources:['three-financial-statements.md','double-entry-bookkeeping.md','unit-economics-ltv-cac.md',
             'cost-of-capital-and-wacc.md','cap-table-dilution-and-option-pools.md',
             'norway-vat-mva.md','+ 14 more under raw/'],
    chs:['Accounting foundations','Financial statements','Financial analysis','Unit economics',
         'Working capital and cash flow','Break-even analysis','Budgeting and forecasting',
         'Planning and funding','Capital and investments','Business valuation','Operations',
         'Taxes','Norway specifics'] },

  { id:'biz', title:'Running a Business', status:'available', at:0, ready:0,
    vault:'projects/sokrates/wiki/running-a-business/',
    built:'LLM wiki · 17 researched sources → 14 pages',
    basis:'Strategy and operations, with a Norwegian legal layer (AS vs ENK, employer obligations, consumer rights).',
    dist:{high:10,mod:4,low:2,un:1},
    sources:['business-model-canvas.md','porters-five-forces.md','swot-analysis.md',
             'norway-as-limited-company.md','norway-enk-sole-proprietorship.md','+ 12 more under raw/'],
    chs:['Planning','Strategy','Business models','Business structures','Norway structures',
         'Norway accounting','Norway employment','Hiring','Organization','Management',
         'Operations','Marketing','Customer service','Failure'] },

  { id:'a9s', title:'a9s', status:'available', at:0, ready:0,
    vault:'work/platform/learn/a9s/',
    built:'The only one already course-shaped — theory/ + quiz/ + resources/',
    basis:'Has active-recall questions written already. The other wikis have sources and pages but no practice yet.',
    dist:{high:4,mod:2,low:0,un:0},
    sources:['curated-sources.md'],
    chs:['a9s architecture overview'] },

];

const HUE = {
  pm:     {bg:'#D3E3FD', fg:'#041E49', ic:'inventory_2'},
  proj:   {bg:'#C4EED0', fg:'#04210C', ic:'view_timeline'},
  ana:    {bg:'#E8DEF8', fg:'#1D192B', ic:'insights'},
  fin:    {bg:'#FFDCBE', fg:'#2D1600', ic:'payments'},
  biz:    {bg:'#FFD8E4', fg:'#31111D', ic:'storefront'},
  a9s:    {bg:'#B3EBF8', fg:'#001F27', ic:'dns'},
};
const hue = id => HUE[id] || {bg:'var(--surface-container-high)',fg:'var(--on-surface)',ic:'school'};

const INBOX = {label:'Inbox', path:'projects/sokrates/projects/lyceum/inbox.md', ic:'inbox'};
const LEARN = {label:'Want to learn', path:'learn.md', ic:'lightbulb'};
const destOfCourse = c => ({label:c.title, path:c.vault + 'notes.md', ic:'school'});
const destOfProject = t => ({label:t.title, path:t.vault + 'notes.md', ic:'handyman'});
const allDests = () => [
  ...THEORIES.map(destOfProject),
  ...COURSES.map(destOfCourse),
  LEARN,
];

const TOOLS = [
  {id:'endoxa',name:'Prior art',gloss:'What has already been said',ic:'search'},
  {id:'horismos',name:'Define',gloss:'Pin down the terms',ic:'label'},
  {id:'elenchus',name:'Interrogate',gloss:'Question it to breaking point',ic:'help'},
  {id:'aporia',name:'Impasse',gloss:'Find where it gets stuck',ic:'report'},
  {id:'causes',name:'Four causes',gloss:'Why it exists at all',ic:'account_tree'},
  {id:'syllogism',name:'Check the logic',gloss:'Does the conclusion follow',ic:'rule'},
  {id:'falsify',name:'Falsify',gloss:'What would prove it wrong',ic:'science'},
  {id:'empeiria',name:'Evidence plan',gloss:'How to actually test it',ic:'fact_check'},
];


/* Platform Axiology as it would look in Lyceum — real files from the vault folder,
   sorted into DSRM stages, each attached to the discussion that produced it. */
const AXIO = {
  problem: {
    disc:[
      {id:'d1',t:'What is actually wrong with ranking by completeness',w:'2 Jun',n:34,with:'Sokrates'},
      {id:'d2',t:'Arkitekt vs produkteier — hvem eier verdien?',w:'12 Jun',n:21,with:'Sokrates'},
    ],
    files:[
      {f:'initials/platform-axiology-journey.md',by:'Sokrates',from:'d1'},
      {f:'initials/complete-platform-tension-map.md',by:'Sokrates',from:'d1'},
      {f:'initials/philos.md',by:'Edvard',from:null},
      {f:'initials/fundamentale-arkitektursporsmal.md',by:'Edvard',from:null},
      {f:'initials/arkitekt-vs-produkteier.md',by:'Sokrates',from:'d2'},
    ]},
  objectives: {
    disc:[
      {id:'d3',t:'What should a platform actually optimise for',w:'28 Jun',n:41,with:'Sokrates'},
      {id:'d4',t:'Can this be measured at all, or only argued',w:'3 Jul',n:18,with:'Sokrates'},
    ],
    files:[
      {f:'mission/the gist.md',by:'Sokrates',from:'d3'},
      {f:'mission/the how.md',by:'Sokrates',from:'d3'},
      {f:'mission/platform as a startup.md',by:'Sokrates',from:'d3'},
      {f:'mission/measure.md',by:'Sokrates',from:'d4'},
      {f:'mission/thouhts.md',by:'Edvard',from:null},
    ]},
  design: {
    disc:[
      {id:'d5',t:'Exhausting the tension categories',w:'14 Jul',n:57,with:'Aristoteles'},
      {id:'d6',t:'Seven columns or five?',w:'20 Jul',n:26,with:'Aristoteles'},
    ],
    files:[
      {f:'tensions/axiology-v2-cat-1.md',by:'Aristoteles',from:'d5'},
      {f:'tensions/axiology-v2-cat-2.md',by:'Aristoteles',from:'d5'},
      {f:'tensions/axiology-v2-cat-3.md',by:'Aristoteles',from:'d5'},
      {f:'tensions/axiology-v2-cat-4-5.md',by:'Aristoteles',from:'d5'},
      {f:'tensions/axiology-v2-cat-6-7.md',by:'Aristoteles',from:'d5'},
      {f:'initials/platform-tensions-7column.md',by:'Sokrates',from:'d6'},
      {f:'strategic_axis_relationships.md',by:'Sokrates',from:'d6'},
      {f:'initials/tension-category-exhaustion.md',by:'Aristoteles',from:'d5'},
    ]},
  demo: {
    disc:[
      {id:'d7',t:'Designing the workshop session',w:'5 Aug',n:38,with:'Aristoteles'},
    ],
    files:[
      {f:'workshop/workshop.md',by:'Aristoteles',from:'d7'},
      {f:'workshop/workshop questions.pptx',by:'Edvard',from:'d7'},
      {f:'workshop/master set.md',by:'Aristoteles',from:'d7'},
      {f:'ui/tension-explorer.jsx',by:'Sokrates',from:'d7'},
    ]},
  evaluation: {
    disc:[
      {id:'d8',t:'What the workshop actually showed',w:'2 Sep',n:52,with:'Aristoteles'},
      {id:'d9',t:'Do we need a survey, or is the transcript enough?',w:'9 Sep',n:15,with:'Aristoteles'},
    ],
    files:[
      {f:'workshop/transcriptions/transcription - 2.md',by:'Edvard',from:'d8'},
      {f:'workshop/remaining tradeoffs.md',by:'Aristoteles',from:'d8'},
      {f:'workshop/workshop notes.md',by:'Edvard',from:'d8'},
      {f:'metrics & survey/platform-nps-survey.md',by:'Aristoteles',from:'d9'},
      {f:'consumer-ceiling-instrument.md',by:'Aristoteles',from:'d9'},
    ]},
  communication: {
    disc:[],
    files:[
      {f:'metrics & survey/platform-investor-update-template.md',by:'Sokrates',from:null},
      {f:'ui/platform-mapping-tool.jsx',by:'Sokrates',from:null},
    ]},
};

/* one discussion, written out, to show what produces a file */
const DISC_THREAD = {
  d5: [
    {r:'e',t:'I keep finding new tensions. Six categories now. How do I know when I am done?'},
    {r:'a',t:'You do not, by enumeration — that is the wrong test. Ask instead whether a new tension is reducible to one you already have. If every candidate collapses into an existing category, the set is closed for practical purposes.'},
    {r:'e',t:'Give me an example that does not collapse.'},
    {r:'a',t:'Speed against reversibility. It is not cost, and it is not autonomy — a fast irreversible action and a slow reversible one differ on an axis none of your five carry. That is a genuine sixth.'},
    {r:'e',t:'And a seventh?'},
    {r:'a',t:'Legibility against power. A capability a team fully understands but cannot change, versus one they can change without understanding. Your Kubernetes-as-catalogue note is circling this without naming it.'},
    {r:'e',t:'Write it up.'},
    {r:'a',t:'Saved five files under tensions/ — one per category, with the reducibility test stated at the top of cat-1 so the next person can check the set rather than trust it. Also wrote tension-category-exhaustion.md recording why we stopped at seven.',
     saved:['tensions/axiology-v2-cat-1.md','tensions/axiology-v2-cat-2.md','tensions/axiology-v2-cat-3.md','tensions/axiology-v2-cat-4-5.md','tensions/axiology-v2-cat-6-7.md','initials/tension-category-exhaustion.md']},
  ],
};

const STAGE_TOOLS = {
  problem:       ['endoxa','elenchus','aporia'],
  objectives:    ['horismos','syllogism','falsify'],
  design:        ['causes','aporia','horismos'],
  demo:          ['empeiria','elenchus'],
  evaluation:    ['falsify','empeiria','syllogism'],
  communication: ['endoxa','horismos'],
};

const WORK = { axio:{
  endoxa:{h:'Three established frameworks already cover most of this',
    items:['<b>Value Sensitive Design</b> — Friedman, Kahn &amp; Borning. Formalises designing systems around explicit human values; your ranking idea sits inside its "value elicitation" stage.',
           '<b>Wardley Mapping</b> — Simon Wardley. Positions capabilities by user value against evolution. This is the axis pair you were reaching for.',
           '<b>Team Topologies</b> — Skelton &amp; Pais. Already argues a platform is judged by developer experience, not feature count.'],
    foot:'Searched OpenAlex, Crossref and Google Scholar. Two of your seven claims are already settled work — read these rather than rebuilding them. Claims 4 and 6 found no match and stay yours.'},
  horismos:{h:'"Value" is doing three different jobs in your notes',
    items:['<b>Value as adoption</b> — teams actually use the capability.',
           '<b>Value as time saved</b> — measurable hours not spent.',
           '<b>Value as option</b> — it makes some future thing possible that was not before.'],
    foot:'Genus and differentia: you need one definition, not three, or the ranking is unfalsifiable. My suggestion is the third — it is the only one your platform atlas notes actually use.'},
  elenchus:{h:'Four questions your hypothesis does not yet survive',
    items:['If a capability is valuable but unused, is it valuable? Your current wording says no.',
           'Who is the "developer" whose value counts — the one asking, or the one who inherits it?',
           'Can two capabilities be ranked if each is only valuable given the other?',
           'What ranks first on a brand-new platform, where nothing has produced value yet?'],
    foot:'Question three is the one I would work on. It is the standard objection to naive prioritisation scoring.'},
  aporia:{h:'The impasse, stated plainly',
    items:['Value is only observable <i>after</i> a capability is built.',
           'Ranking has to happen <i>before</i> it is built.',
           'So any ranking is a prediction of value, not a measurement — which is precisely what you set out to avoid.'],
    foot:'A real impasse, not a flaw in your thinking. Wardley resolves it with evolution stages as a proxy. You may resolve it differently, but you do have to resolve it.'},
  causes:{h:'The four causes applied to a platform capability',
    items:['<b>Material</b> — the infrastructure and code it is made of.',
           '<b>Formal</b> — the interface it presents; the shape a developer meets.',
           '<b>Efficient</b> — the team that builds and runs it.',
           '<b>Final</b> — the end it serves: work a developer can now do unaided.'],
    foot:'Your axiology is really the claim that only the final cause should drive ranking. Saying that explicitly gives you a sharper thesis than the one currently written down.'},
  syllogism:{h:'The argument as written, formalised',
    items:['<b>P1</b> — A platform exists to let developers ship unaided.',
           '<b>P2</b> — Capabilities differ in how much they enable that.',
           '<b>C</b> — Therefore capabilities should be ranked by developer value.'],
    foot:'Valid, but P2 carries the whole argument and is unsupported. The conclusion is only as strong as your ability to measure "how much" — which is the impasse above.'},
  falsify:{h:'What would prove this wrong',
    items:['A platform ranking purely by technical completeness that produced <i>higher</i> developer throughput than a value-ranked one.',
           'A capability everyone rates low-value that turns out to be load-bearing once removed.',
           'Two teams ranking the same capability set in opposite orders, both correctly for their own context.'],
    foot:'The third is cheapest to test and most likely to fire. Popper\'s criterion — modern, not Aristotelian, flagged as a departure.'},
  empeiria:{h:'An evidence plan you could run this week',
    items:['Rank your current atlas capabilities by your own value definition. About an hour.',
           'Separately, log which ones were actually used in the last quarter.',
           'Compare. Correlation supports the thesis; a flat scatter refutes it.'],
    foot:'n=1 and observational, so weak evidence — but real evidence, and better than asserting the ranking. Want this written onto the bench as a trial?'},
}};

const GENERIC = t => ({h:`${t.name} — not mocked for this hypothesis`,
  items:['The demo only carries full tool output for <b>Platform Axiology</b>.',
         'In the real app every tool runs against whichever hypothesis is open.'],
  foot:'Open Platform Axiology to see a filled-in bench.'});

const DSRM = [
  {k:'problem', n:'Problem', g:'What is wrong, and why it matters'},
  {k:'objectives', n:'Objectives', g:'What a solution would have to do'},
  {k:'design', n:'Design & development', g:'Build the thing'},
  {k:'demo', n:'Demonstration', g:'Show it works at all'},
  {k:'evaluation', n:'Evaluation', g:'Measure how well, against the objectives'},
  {k:'communication', n:'Communication', g:'Write it up so others can use it'},
];
const stageIx = k => DSRM.findIndex(d => d.k === k);

const THEORIES = [
  {id:'axio',title:'Platform Axiology',stage:'demo',
   line:'Platform capabilities should be ranked by the value they create for the developer, not by technical completeness.',
   claims:7,grounded:2,notes:14,since:'started 2 June',
   vault:'work/platform/projects/platform axiology/',
   log:[{d:'14 Sep',t:'Ranked 12 capabilities by gut feel. Three disagreed with actual usage.'},
        {d:'22 Aug',t:'Wrote the first definition of "value" — already suspect it is circular.'},
        {d:'2 Jun',t:'Caught on a run: the atlas ranks by completeness and that feels wrong.'}]},
  {id:'run',title:'Capture-on-the-run',stage:'evaluation',
   line:'Ideas caught within 60 seconds of having them while running survive to become work; ones I recall afterwards do not.',
   claims:4,grounded:1,notes:31,since:'testing since 30 August',
   vault:'work/platform/projects/capture-on-the-run/',
   log:[{d:'18 Sep',t:'Day 14. 31 caught, 9 became real work. Recall group: 2 of 11.'},
        {d:'30 Aug',t:'Started the 28-day trial.'}]},
  {id:'cyc',title:'Cycle-based autonomy',stage:'communication',
   line:'An agent working in bounded, journalled cycles outperforms a continuously-running one, because the boundary forces a written handover.',
   claims:9,grounded:6,notes:22,since:'graduated 4 September',
   vault:'work/platform/projects/cycle-based-autonomy/',
   log:[{d:'4 Sep',t:'Graduated to theory — 6 of 9 claims now grounded.'},
        {d:'11 Jul',t:'Checkpoint/restart literature found. Not a new idea after all.'}]},
];

const CHATS = [
  {id:'c1',topic:'Naming the goal-setting framework',last:'Three candidates, and why I would drop the third…',when:'2h'},
  {id:'c2',topic:'Is analytics worth a course or just reference?',last:'It has 24 sources — that is a course, not a note.',when:'Yesterday'},
  {id:'c3',topic:'Half-formed thought about platform maturity',last:'This might be a workshop project. Shall I open one?',when:'4d'},
];

const THREAD = [
  {r:'e',t:'I keep coming back to goal setting and KPIs but I do not know the theory well enough to build anything.'},
  {r:'a',t:'Then it is two things, not one, and they want different treatment. The established part — OKRs, north-star metrics, Goodhart\'s law, earned value — is already sitting in your own wikis. That is a course.'},
  {r:'a',t:'The part that is yours is the framework for a single operator running parallel projects, which nothing in the literature covers. That is a workshop project, and it starts at problem identification, not at design.'},
  {r:'e',t:'Do both then.'},
  {r:'a',t:'Opening a workshop project. It has no name yet, so I have left the title as a placeholder for you to fix — naming it now would be me deciding something you should.',
   opened:'Workshop project · stage 1, Problem identification'},
];



/* asking about a claim opens a discussion with the claim as its context */
const CLAIM_TALK = {
  'un': [
    {r:'a',t:'This one is yours, not the literature\'s. I searched OpenAlex and Crossref for concurrent-objective limits on a single operator and found nothing — the whole field studies teams and firms. So the honest status is untested, not wrong.'},
    {r:'e',t:'Then why is it in the course at all?'},
    {r:'a',t:'Because you put it there, and because a course that silently drops the unproven parts teaches you that everything in it is equally solid. Marking it is more useful than hiding it. If you want it tested rather than flagged, it belongs on the workshop bench as a hypothesis — say the word and I will open one.'},
  ],
  'high': [
    {r:'a',t:'This is about as settled as findings in this field get — roughly 400 studies over four decades, and the 2002 review in American Psychologist is the one to read if you only read one.'},
    {r:'e',t:'Does it hold for one person, or only teams?'},
    {r:'a',t:'It holds at n=1: the original work was largely individual task performance, and the team literature came later. What does *not* transfer is the coordination argument for OKRs — that one is about alignment between people, so it has nothing to say about you working alone.'},
  ],
  'mod': [
    {r:'a',t:'Weaker evidence than the previous claim, and I would not lean on it hard. The replication base is narrower — one well-designed study and a handful of follow-ups rather than a meta-analysis.'},
    {r:'e',t:'So do I use it or not?'},
    {r:'a',t:'Use it as a caution, not a rule. The useful version: when you genuinely do not know how to do the thing yet, set a goal about finding the method rather than about the outcome. That is cheap to try and costs nothing if the effect is smaller than claimed.'},
  ],
  'low': [
    {r:'a',t:'Practitioner advice, not a study — Doerr is reporting what worked at Intel and Google, which is evidence of a kind but not controlled.'},
    {r:'e',t:'Is there anything better on it?'},
    {r:'a',t:'Not that I found. The academic work on goals and incentives is adjacent but does not test this separation directly. So: reasonable, widely repeated, and unproven. Treat it as a default you are free to break.'},
  ],
};

/* ---------------- tiny markdown renderer ---------------- */
const esc = t => t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const inline = t => esc(t)
  .replace(/`([^`]+)`/g,'<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')
  .replace(/(^|[^*])\*([^*]+)\*/g,'$1<em>$2</em>');

function mdToHtml(src) {
  const out = [];
  let list = null;
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of src.split('\n')) {
    const line = raw.replace(/\s+$/,'');
    if (!line.trim()) { closeList(); continue; }
    let m;
    if (line.trim() === '---') { closeList(); out.push('<hr/>'); }
    else if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
      closeList(); const l = m[1].length; out.push(`<h${l}>${inline(m[2])}</h${l}>`);
    }
    else if ((m = line.match(/^>\s?(.*)$/))) {
      closeList(); out.push(`<blockquote>${inline(m[1])}</blockquote>`);
    }
    else if ((m = line.match(/^\s*[-*]\s+(.*)$/))) {
      if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
      out.push(`<li>${inline(m[1])}</li>`);
    }
    else if ((m = line.match(/^\s*\d+\.\s+(.*)$/))) {
      if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
      out.push(`<li>${inline(m[1])}</li>`);
    }
    else { closeList(); out.push(`<p>${inline(line)}</p>`); }
  }
  closeList();
  return out.join('');
}

/* ---------------- file contents ---------------- */
const FILE_BODY = {
'tensions/axiology-v2-cat-6-7.md': `# Categories 6 and 7

The five original categories were arrived at by collection. These two were
arrived at by testing the set for closure, which is a different and better
reason to believe in them.

## 6 — Speed against reversibility

A capability can be fast to adopt and expensive to leave, or slow to adopt
and cheap to abandon. This is **not** the cost axis and it is **not** the
autonomy axis.

> A fast irreversible action and a slow reversible one differ on an axis
> none of categories 1-5 carry.

- Managed database: fast in, very hard out
- Self-run Postgres on a VM: slow in, trivial to leave
- The platform choice is rarely about which is cheaper today

## 7 — Legibility against power

A team may fully understand a capability it cannot change, or freely change
one it does not understand.

- **Legible, powerless** — a clear runbook for a system owned elsewhere
- **Powerful, illegible** — a Terraform module nobody can read but everyone edits

Category 7 is what the *Kubernetes as a product catalogue* note was circling
without naming.

---

Both categories pass the reducibility test stated in \`axiology-v2-cat-1\`:
neither collapses into an existing category under substitution.`,

'initials/tension-category-exhaustion.md': `# Why we stopped at seven

Not because seven is a natural number of categories. Because the test changed.

## The test

A candidate tension is **new** if it cannot be reduced to an existing category
by substitution. If every new candidate collapses, the set is closed for
practical purposes — which is a weaker claim than completeness, and the only
one the evidence supports.

## What was tried and collapsed

- *Cost against quality* — reduces to category 2
- *Build against buy* — reduces to 2 and 6 together, not a separate axis
- *Central against federated* — this is category 3 restated from the other side
- *Security against velocity* — a special case of 4

## What did not collapse

1. Speed against reversibility → category 6
2. Legibility against power → category 7

## Standing caveat

Closure was tested against candidates **we** generated. A category nobody
here thought of would not have been caught. The workshop was partly designed
to expose exactly that, and did not produce one — which is evidence, not proof.`,

'mission/the gist.md': `# The gist

A platform is not judged by how complete it is. It is judged by what a
developer can now do without asking anyone.

## The claim

> Capabilities should be ranked by the value they create for the developer,
> not by technical completeness.

## Why this is not obvious

Completeness is measurable today and value is not. That asymmetry is why
most platform roadmaps rank by completeness while claiming to rank by value
— the honest version admits the measurement problem rather than hiding it
behind a scoring sheet.

## What follows

- A capability nobody uses has produced no value, however well built
- A capability that removes a request queue has produced value even if it is ugly
- Ranking therefore has to be a **prediction**, and predictions should be
  written down where they can later be checked`,

'metrics & survey/platform-nps-survey.md': `# Platform NPS survey

Instrument, not theory. Fielded after the workshop to test whether the
tension categories describe anything a team recognises.

## Questions

1. How likely are you to recommend the platform to another team? (0-10)
2. What is the last thing you needed that you could not get yourself?
3. How long did it take to get it?
4. Which of these two would you rather have — pick one:
   - A capability you understand but cannot change
   - A capability you can change but do not understand

## Design notes

Question 4 is the only one that tests category 7 directly, and it is
deliberately a forced choice. A Likert scale here produced a flat middle
in the pilot, which told us nothing.

## Known weakness

n is small and the respondents are all from one organisation. This measures
recognition, not generality.`,
};

/* ---------------- pieces ---------------- */

function GradeBar({dist}) {
  const total = dist.high+dist.mod+dist.low+dist.un || 1;
  const pc = n => (n/total)*100;
  const key = [['high','g-high',dist.high],['moderate','g-mod',dist.mod],
               ['low','g-low',dist.low],['ungrounded','g-un',dist.un]];
  return html`
    <div class="gbar">
      ${dist.high?html`<i class="g-high" style=${{width:pc(dist.high)+'%'}}></i>`:null}
      ${dist.mod?html`<i class="g-mod" style=${{width:pc(dist.mod)+'%'}}></i>`:null}
      ${dist.low?html`<i class="g-low" style=${{width:pc(dist.low)+'%'}}></i>`:null}
      ${dist.un?html`<i class="g-un" style=${{width:pc(dist.un)+'%'}}></i>`:null}
    </div>
    <div class="gkey">
      ${key.filter(k=>k[2]).map(k=>html`
        <span class="chip stat" key=${k[0]}>
          <i class=${'dot '+k[1]} style="width:8px;height:8px;border-radius:50%;display:inline-block"></i>
          ${k[2]} ${k[0]}
        </span>`)}
    </div>`;
}


/* ---------------- screens ---------------- */

function Home({go,statuses}) {
  const of = c => statuses[c.id] || c.status;
  const on = COURSES.filter(c => of(c) === 'active');
  return html`
    <div class="sectitle">Where you left off</div>
    ${on.map(c => { const u = hue(c.id); return html`
      <div class="card tinted tap" key=${c.id} style=${{'--c-bg':u.bg,'--c-fg':u.fg}}
           onClick=${()=>go({course:c.id,chapter:c.at})}>
        <div class="row">
          <div class="avatar" style=${{background:'rgba(255,255,255,.55)',color:u.fg}}>${I(u.ic)}</div>
          <div class="grow">
            <h3>${c.title}</h3>
            <p class="supporting">${c.at}. ${c.chs[c.at-1]}</p>
          </div>
          ${I('chevron_right','trail')}
        </div>
        <div class="lin"><i style=${{width:((c.at-1)/c.chs.length*100)+'%'}}></i></div>
      </div>`; })}

    <div class="sectitle s2">Practice, whenever you feel like it</div>
    <div class="card practice">
      ${on.filter(c=>c.ready).map(c => html`
        <div class="li" key=${c.id}>
          <div class="lead">${I('style')}</div>
          <div class="txt">${c.title}
            <div class="sub">${c.ready} cards ready</div></div>
          <button class="btn filled sm" style="background:var(--secondary);color:#fff"
                  onClick=${()=>go({quiz:true})}>Practice</button>
        </div>`)}
    </div>
    <p class="supporting" style="margin:0 4px 4px">
      Ordered by what you are most likely to have forgotten. Nothing is due, nothing expires.</p>

`;
}

function Courses({statuses,setStatus,go}) {
  const [filter,setFilter] = useState('active');
  const of = c => statuses[c.id] || c.status;
  const list = COURSES.filter(c => of(c) === filter);
  const segs = [['active','Enrolled','school'],['paused','Paused','pause_circle'],
                ['available','Available','explore']];
  return html`
    <div class="seg">
      ${segs.map(s=>html`
        <button key=${s[0]} class=${filter===s[0]?'on':''} onClick=${()=>setFilter(s[0])}>
          ${filter===s[0]?I('check'):null}${s[1]}
        </button>`)}
    </div>
    ${list.map(c => { const u = hue(c.id); return html`
      <div class="card" key=${c.id}>
        <div class="row">
          <div class="avatar" style=${{background:u.bg,color:u.fg}}>${I(u.ic)}</div>
          <div class="grow" onClick=${()=>go({course:c.id})}>
            <h3>${c.title}</h3>
            <p class="supporting">
              ${of(c)==='available' ? `${c.chs.length} chapters · ${c.built}`
                : `Chapter ${c.at} of ${c.chs.length} · ${c.chs[c.at-1]}`}</p>
          </div>
          ${of(c)==='active' ? html`<button class="btn outlined sm" onClick=${()=>setStatus(c.id,'paused')}>Pause</button>`:null}
          ${of(c)==='paused' ? html`<button class="btn filled sm" onClick=${()=>setStatus(c.id,'active')}>Resume</button>`:null}
          ${of(c)==='available' ? html`<button class="btn filled sm" onClick=${()=>setStatus(c.id,'active')}>Enrol</button>`:null}
        </div>
        ${of(c)!=='available' ? html`
          <div class="lin"><i style=${{width:((c.at-1)/c.chs.length*100)+'%',
            background:of(c)==='paused'?'var(--outline-variant)':'var(--primary)'}}></i></div>`
        : html`<p class="supporting" style="margin-top:8px">Opens with: ${c.chs.slice(0,2).join(' · ')}…</p>`}
      </div>`; })}
    ${!list.length ? html`<p class="supporting" style="text-align:center;padding:32px 0">
      Nothing here yet.</p>`:null}
    ${filter==='available' ? html`
      <div class="card out tap" style="text-align:center">
        <h3 style="color:var(--primary)">Request a topic</h3>
        <p class="supporting">Aristoteles finds how it is really taught, then builds the curriculum, wiki and cards.</p>
      </div>`:null}`;
}

function CourseDetail({course,statuses,setStatus,go}) {
  const st = statuses[course.id] || course.status, c = course, u = hue(c.id);
  return html`
    <div class="hero" style=${{'--c-bg':u.bg,'--c-fg':u.fg}}>
      <h2>${c.title}</h2>
      <p>${c.built}</p>
    </div>
    <div class="card">
      <p style="margin:0;font-size:15px;line-height:22px">${c.basis}</p>
    </div>

    <div class="sectitle">Evidence behind this course</div>
    <div class="card">
      <${GradeBar} dist=${c.dist} />
      <p class="supporting" style="margin-top:10px">
        Across ${c.dist.high+c.dist.mod+c.dist.low+c.dist.un} claims. Ungrounded means untested —
        not wrong.</p>
    </div>

    <div class="sectitle">Chapters</div>
    <div class="card">
      ${c.chs.map((t,i) => {
        const n=i+1, read = st!=='available' && n<c.at, now = st!=='available' && n===c.at;
        return html`
          <div class=${'li'+(read?' read':'')+(now?' now':'')} key=${n}
               onClick=${()=>go({course:c.id,chapter:n})}>
            <div class="lead">${read?I('check'):n}</div>
            <div class="txt" style="font-size:15px;line-height:21px">${t}</div>
            ${I('chevron_right','trail')}
          </div>`;
      })}
    </div>

    <div class="sectitle">Sources</div>
    <div class="card">
      ${c.sources.map((s,i)=>html`
        <p class="supporting" key=${i} style="margin:6px 0">${s}</p>`)}
    </div>

    <div class="row" style="justify-content:flex-end;margin-top:16px">
      ${st==='active'?html`<button class="btn outlined" onClick=${()=>setStatus(c.id,'paused')}>Pause course</button>`:null}
      ${st==='paused'?html`<button class="btn filled" onClick=${()=>setStatus(c.id,'active')}>Resume course</button>`:null}
      ${st==='available'?html`<button class="btn filled" onClick=${()=>setStatus(c.id,'active')}>Enrol</button>`:null}
    </div>`;
}


/* The composer is a textarea that starts at one line and grows to ten, as Nova's does.
   A textarea also keeps Chrome's autofill strip (passwords, cards, addresses) away —
   it only attaches to single-line inputs. */
function GrowBox({placeholder, value, onInput}) {
  const ref = useRef(null);
  const fit = () => {
    const el = ref.current; if (!el) return;
    const cs = getComputedStyle(el);
    let line = parseFloat(cs.lineHeight); if (!(line > 0)) line = parseFloat(cs.fontSize) * 1.4 || 21;
    const frame = (parseFloat(cs.paddingTop)||0) + (parseFloat(cs.paddingBottom)||0);
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, line * 10 + frame) + 'px';
  };
  useEffect(fit, [value]);
  return html`<textarea ref=${ref} rows="1" class="growbox" placeholder=${placeholder}
    value=${value} onInput=${e => { onInput && onInput(e); fit(); }}></textarea>`;
}

const CLAIM_STORE = {};

function ClaimDrawer({claim,k,close,bump}) {
  const [msgs,setMsgs] = useState(CLAIM_STORE[k] || []);
  const [text,setText] = useState('');
  const [closing,setClosing] = useState(false);
  const replies = (CLAIM_TALK[claim.g] || CLAIM_TALK.mod).filter(m => m.r === 'a');
  const scroller = useRef(null);
  useEffect(() => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight; }, [msgs.length]);
  const send = e => {
    e.preventDefault(); const q = text.trim(); if (!q) return;
    const a = [...msgs, {r:'e',t:q}]; CLAIM_STORE[k] = a; setMsgs(a); setText(''); bump();
    setTimeout(() => {
      const cur = CLAIM_STORE[k]; const nth = cur.filter(m => m.r === 'a').length;
      const t = replies[nth] ? replies[nth].t
        : 'Tell me which part you are unsure of and I will go back to the source for it.';
      const b = [...cur, {r:'a',t}]; CLAIM_STORE[k] = b; setMsgs(b); bump();
    }, 900);
  };
  const shut = () => { setClosing(true); setTimeout(close, 210); };
  return html`
    <div class=${'scrim drawerscrim'+(closing?' out':'')} onClick=${shut}></div>
    <div class=${'drawer'+(closing?' out':'')}>
      <div class="grab" onClick=${shut}></div>
      <div class=${'trace'+(claim.g==='un'?' un':'')} style="margin:0 0 10px">
        <div class="lvl">${GRADE[claim.g]}</div>
        <div>${claim.t}</div>
      </div>
      <div class="drawerchat" ref=${scroller}>
        <div class="chat">${msgs.map((m,i)=>html`<div class=${'bub '+m.r} key=${i}>${m.t}</div>`)}</div>
      </div>
      <form class="composer" onSubmit=${send}>
        <${GrowBox} placeholder="Ask about this…" value=${text} onInput=${e=>setText(e.target.value)} />
        <button class="iconbtn" type="submit">${I('send')}</button>
      </form>
    </div>`;
}

function Reading({course,n}) {
  const [open,setOpen] = useState(null);
  const [ask,setAsk] = useState(null);
  const [,setTick] = useState(0);
  const bump = () => setTick(t => t + 1);
  const r = (course.reading||{})[n], title = course.chs[n-1];
  const key = i => course.id + '|' + n + '|' + i;
  const count = i => (CLAIM_STORE[key(i)] || []).length;

  if (!r) return html`
    <div class="read"><h2>${n}. ${title}</h2></div>
    <p class="supporting">This chapter is not written out in the demo — two carry full text.
      Try <b>Product Management</b> chapter 7, or <b>Analytics</b> chapter 9.</p>`;

  return html`
    <div class="read">
      <h2>${n}. ${title}</h2>
      ${r.claims.map((c,i)=>html`
        <div key=${i}>
          <p class="claim">${c.t}
            <i class=${'mark m-'+c.g} onClick=${()=>setOpen(open===i?null:i)}></i>
            ${count(i) ? html`<span class="talked" onClick=${()=>setAsk(i)}>${I('forum')}${count(i)}</span>` : null}
          </p>
          ${open===i ? html`
            <div class=${'trace'+(c.g==='un'?' un':'')}>
              <div class="lvl">${GRADE[c.g]}${c.src?' · '+c.src.kind:' · not sourced'}</div>
              ${c.src ? html`<div><b>${c.src.name}</b><br/><a href="#">${c.src.link}</a></div>`
                      : html`<div>${c.note}</div>`}
              <div style="display:flex;justify-content:flex-end;margin-top:10px">
                <button class="btn tonal sm" onClick=${()=>setAsk(i)}>
                  ${I('forum')}${count(i) ? 'Open conversation' : 'Ask about this'}</button>
              </div>
            </div>`:null}
        </div>`)}
    </div>
    ${ask !== null ? html`<${ClaimDrawer} claim=${r.claims[ask]} k=${key(ask)}
        close=${()=>setAsk(null)} bump=${bump} />` : null}`;
}

function DiscussionView({d}) {
  const thread = DISC_THREAD[d.id];
  return html`
    ${thread ? html`
      <div class="chatscroll"><div class="chat">
        ${thread.map((m,i)=>html`
          <div key=${i}>
            <div class=${'bub '+m.r}>${m.t}</div>
            ${m.saved?html`
              <div class="saved">
                <div class="hd">${I('note_add')}Saved to the vault</div>
                ${m.saved.map(f=>html`<div class="f" key=${f}>${f}</div>`)}
              </div>`:null}
          </div>`)}
      </div></div>
      <div class="composer pinned">
        <${GrowBox} placeholder="Continue…" />
        <button class="iconbtn">${I('send')}</button>
      </div>`
    : html`<div class="chatscroll"><p class="supporting">Only the tension-category discussion is written out in the demo.</p></div>
      <div class="composer pinned"><${GrowBox} placeholder="Continue…" /><button class="iconbtn">${I('send')}</button></div>`}`;
}

const baseName = p => {
  const n = p.split('/').pop();
  return n.endsWith('.md') ? n.slice(0,-3) : n;
};
const extOf = p => { const n = p.split('/').pop(); const i = n.lastIndexOf('.');
  return i<0 ? '' : n.slice(i+1).toLowerCase(); };
const fileIcon = e => e==='jsx'||e==='js'?'code' : e==='pptx'?'slideshow'
  : e==='png'||e==='svg'?'bar_chart' : e==='zip'?'folder_zip' : 'description';

function FileList({files,disc,open}) {
  return html`
    <div class="card">
      ${files.map(f=>{
        const e = extOf(f.f);
        return html`
          <div class="filerow" key=${f.f} onClick=${()=>open(f)}>
            <div class="fi">${I(fileIcon(e))}</div>
            <div class="fn">${baseName(f.f)}
              ${f.from?html`<div class="supporting" style="font-size:12px;line-height:17px">
                from “${(disc.find(d=>d.id===f.from)||{}).t}”</div>`:null}</div>
            ${e && e!=='md' ? html`<span class="ft">${e}</span>` : null}
          </div>`;
      })}
    </div>`;
}

function FileView({file}) {
  const body = FILE_BODY[file.f];
  return html`
    <div class="docbar">
      <div class="grow"><div class="docpath">${file.f}</div></div>
      <button class="btn tonal sm">${I('edit')}Edit</button>
    </div>
    ${body ? html`<div class="doc" dangerouslySetInnerHTML=${{__html:mdToHtml(body)}}></div>`
           : html`<p class="supporting">Not written out in the demo. Four files carry real
             text — the two tension files, <b>the gist</b>, and <b>platform-nps-survey</b>.</p>`}`;
}

function StageSheet({open,here,close,pick}) {
  return html`
    <div class="scrim" onClick=${close}></div>
    <div class="sheet">
      <div class="grab"></div>
      <h3>Design Science Research</h3>
      ${DSRM.map((d,i)=>{
        const done = i<here, cur = i===here, sel = i===open;
        return html`
          <div class=${'li'+(done?' read':'')+(cur?' now':'')} key=${d.k}
               onClick=${()=>{pick(i);close();}}
               style=${sel?{background:'var(--tertiary-container)',borderRadius:'12px',
                            margin:'2px -8px',padding:'10px 8px'}:null}>
            <div class="lead">${done?I('check'):i+1}</div>
            <div class="txt" style="font-size:15px;line-height:20px">
              ${d.n}<div class="sub">${d.g}</div></div>
            ${cur?html`<span class="chip stat hyp">here</span>`:null}
          </div>`;
      })}
    </div>`;
}

function Bench({theory,push,stageIn,setStageIn}) {
  const here = stageIx(theory.stage);
  const open = stageIn ?? here;
  const setOpen = setStageIn;
  const [tool,setTool] = useState(null);
  const [all,setAll] = useState(false);
  const [sheet,setSheet] = useState(false);
  const [ran,setRan] = useState({});
  const [busy,setBusy] = useState(false);

  const stage = DSRM[open];
  const data = (theory.id==='axio' ? AXIO[stage.k] : null) || {disc:[],files:[]};


  const ids = all ? TOOLS.map(t=>t.id) : STAGE_TOOLS[stage.k];
  const shown = ids.map(id => TOOLS.find(t => t.id === id));
  const out = tool ? ((WORK[theory.id]||{})[tool.id] || GENERIC(tool)) : null;
  const pick = i => { setOpen(i); setTool(null); setAll(false); };
  const run = () => { setBusy(true);
    setTimeout(()=>{ setBusy(false); setRan({...ran,[tool.id]:true}); }, 1400); };

  return html`
    <div class="stagebar" onClick=${()=>setSheet(true)}>
      <div class="n">${open+1}</div>
      <div class="t">${stage.n}<div class="of">Stage ${open+1} of 6${open===here?'':' · you are on '+(here+1)}</div></div>
      <div class="segs">
        ${DSRM.map((d,i)=>html`<i key=${d.k} class=${i===open?'on':i<here?'done':''}></i>`)}
      </div>
      ${I('unfold_more')}
    </div>

    <p class="statement">${theory.line}</p>

    <div class="sectitle s2">Discussions</div>
    ${data.disc.length ? data.disc.map(d=>html`
      <div class="card tap" key=${d.id} onClick=${()=>push({kind:'disc',d})}>
        <div class="row">
          <div class="avatar" style="background:var(--secondary-container);
            color:var(--on-secondary-container)">${I('forum')}</div>
          <div class="grow">
            <h3 style="font-size:15px">${d.t}</h3>
            <p class="supporting">${d.n} messages · ${d.w}</p>
          </div>
          ${I('chevron_right','trail')}
        </div>
      </div>`)
    : html`<p class="supporting" style="margin:0 4px 8px">None at this stage.</p>`}
    ${data.files.length ? html`
      <div class="sectitle">Files</div>
      <${FileList} files=${data.files} disc=${data.disc} open=${f=>push({kind:'file',file:f,theoryId:theory.id})} />` : null}

    <div class="sectitle s3">${all ? 'All tools' : 'Tools for ' + stage.n.toLowerCase()}</div>
    <div class="rack">
      ${shown.map(t=>html`
        <button class=${'tool'+(tool&&tool.id===t.id?' on':'')} key=${t.id}
                onClick=${()=>setTool(tool&&tool.id===t.id?null:t)}>
          ${I(t.ic)}
          <span class="nm">${t.name}</span>
          <span class="gr">${t.gloss}</span>
        </button>`)}
    </div>
    <div class="row" style="justify-content:flex-end;margin:-4px 0 8px">
      <button class="btn text" onClick=${()=>{setAll(!all);setTool(null);}}>
        ${all ? 'Show only this stage' : 'Show all tools'}</button>
    </div>

    ${tool && !ran[tool.id] ? html`
      <div class="toolcard">
        <h4>${tool.name}</h4>
        <p>${tool.gloss} — run against this project at stage ${open+1}, ${stage.n.toLowerCase()}.</p>
        <div class="act">
          ${busy ? html`<div class="working"><div class="spin"></div>Aristoteles is working…</div>`
                 : html`<button class="btn start" onClick=${run}>${I('play_arrow')}Start</button>`}
        </div>
      </div>`:null}

    ${tool && ran[tool.id] && out ? html`
      <div class="toolout">
        <div class="who">${tool.name} · Aristoteles</div>
        <h4>${out.h}</h4>
        <ul>${out.items.map((i,k)=>html`<li key=${k} dangerouslySetInnerHTML=${{__html:i}}></li>`)}</ul>
        <p class="foot">${out.foot}</p>
        <div class="act" style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px">
          <button class="btn text" style="color:var(--on-tertiary-container)"
                  onClick=${()=>setRan({...ran,[tool.id]:false})}>Run again</button>
          <button class="btn start">${I('note_add')}Save as file</button>
        </div>
      </div>`:null}

    ${sheet?html`<${StageSheet} open=${open} here=${here}
        close=${()=>setSheet(false)} pick=${pick} />`:null}`;
}

function Workshop({setTheory}) {
  return html`
    ${THEORIES.map(t=>html`
      <div class="card tap" key=${t.id} onClick=${()=>setTheory(t)}>
        <div class="row" style="margin-bottom:6px">
          <div class="grow"><h3>${t.title}</h3></div>
          <span class=${'chip stat '+(t.stage==='communication'?'theory':'hyp')}>
            ${stageIx(t.stage)+1}. ${DSRM[stageIx(t.stage)].n}</span>
        </div>
        <p style="margin:0 0 8px;font-size:15px;line-height:21px">${t.line}</p>
        <p class="supporting">${t.notes} notes · ${t.claims} claims · ${t.grounded} grounded</p>
      </div>`)}`;
}

function Chat({thread,setThread}) {
  if (thread===null) return html`
    <div class="dests" style="margin:4px 0 12px">
      <button class="chip">${I('handyman')}Start a workshop project</button>
      <button class="chip">${I('school')}Build a course</button>
    </div>
    ${CHATS.map(c=>html`
      <div class="card tap" key=${c.id} onClick=${()=>setThread(c.id)}>
        <div class="row">
          <div class="lead" style="flex:0 0 40px;height:40px;border-radius:50%;
            background:var(--primary-container);color:var(--on-primary-container);
            display:flex;align-items:center;justify-content:center">${I('forum')}</div>
          <div class="grow"><h3>${c.topic}</h3><p class="supporting">${c.last}</p></div>
          <span class="supporting">${c.when}</span>
        </div>
      </div>`)}`;
  return html`
    <div class="chatscroll"><div class="chat">
      ${THREAD.map((m,i)=>html`
        <div key=${i}>
          <div class=${'bub '+m.r}>${m.t}</div>
          ${m.opened?html`
            <div class="saved">
              <div class="hd">${I('handyman')}Created</div>
              <div class="f" style="font-family:Roboto,sans-serif;font-size:13.5px">${m.opened}</div>
            </div>`:null}
        </div>`)}
    </div></div>
    <div class="composer pinned">
      <${GrowBox} placeholder="Ask Aristoteles…" />
      <button class="iconbtn">${I('send')}</button>
    </div>`;
}

function NoteSheet({close,onSave,here}) {
  const first = here || INBOX;
  const [dest,setDest] = useState(first);
  const [other,setOther] = useState(false);
  const [text,setText] = useState('');
  const quick = here ? [here, INBOX] : [INBOX];
  const rest = allDests().filter(d => !quick.some(q => q.path === d.path));
  const chip = d => html`
    <button class=${'chip'+(dest.path===d.path?' on':'')} key=${d.path} onClick=${()=>setDest(d)}>
      ${I(dest.path===d.path ? 'check' : d.ic)}${d.label}
    </button>`;
  return html`
    <div class="scrim" onClick=${close}></div>
    <div class="sheet">
      <div class="grab"></div>
      <h3>New note</h3>
      <textarea placeholder="Write it down now. Shape it later."
        value=${text} onInput=${e=>setText(e.target.value)}></textarea>
      <div class="sectitle s3" style="margin:14px 0 2px">Where it goes</div>
      <div class="dests">
        ${quick.map(chip)}
        ${!quick.some(q => q.path === dest.path) ? chip(dest) : null}
        <button class="chip" onClick=${()=>setOther(!other)}>
          ${I(other ? 'expand_less' : 'more_horiz')}Other</button>
      </div>
      ${other ? html`<div class="dests" style="margin-top:0">
        ${rest.filter(d => d.path !== dest.path).map(d => html`
          <button class="chip" key=${d.path} onClick=${()=>{ setDest(d); setOther(false); }}>
            ${I(d.ic)}${d.label}</button>`)}
      </div>` : null}
      <div class="sheetact">
        <button class="btn text" onClick=${close}>Cancel</button>
        <button class="btn filled" onClick=${()=>onSave(dest.path)}>Save</button>
      </div>
    </div>`;
}

function GeneralTalk({title,close}) {
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
        <div class="chat">
          <div class="bub a">I have this chapter and its sources open. Ask about any of it —
            or push back on it, which is usually more useful.</div>
          <div class="bub a">If you would rather start somewhere: the weakest thing in this
            chapter is the claim about separating goals from compensation review. It is
            practitioner advice with no controlled study behind it, and you are running a
            platform team where that separation may not even be yours to make.</div>
        </div>
      </div>
      <div class="composer">
        <${GrowBox} placeholder="Ask Aristoteles…" />
        <button class="iconbtn">${I('send')}</button>
      </div>
    </div>`;
}

const CARDS = [
  {kind:'Multiple choice', g:'high',
   q:'In the Kano model, what happens to a delighter over time?',
   opts:['It stays a delighter as long as it is well built',
         'It decays into a performance need, then a basic expectation',
         'It becomes irrelevant once competitors copy it'],
   a:1,
   why:'Kano called this the lifecycle of an attribute. Anti-lock brakes were a delighter, then a selling point, and are now assumed — a feature that stops being noticed has not stopped mattering.',
   src:'Kano et al. (1984) — Attractive quality and must-be quality'},

  {kind:'True or false', g:'high',
   q:'Specific, difficult goals produce higher performance than telling someone to do their best.',
   opts:['True','False'], a:0,
   why:'One of the most replicated findings in organisational psychology — roughly 400 studies over four decades, and it holds at n=1, not only for teams.',
   src:'Locke & Latham (2002), American Psychologist'},

  {kind:'Fill the blank', g:'mod', cloze:true,
   q:'In RICE prioritisation, the R stands for ___.',
   opts:['Revenue','Reach','Risk','Readiness'], a:1,
   why:'Reach — how many people the change affects in a period. The scoring is Reach × Impact × Confidence, divided by Effort.',
   src:'Intercom (2016) — RICE scoring, practitioner method'},

  {kind:'Write an answer', g:'mod', short:true,
   q:'In one line: why can a learning goal beat an outcome goal on unfamiliar work?',
   model:'Because on a task you do not yet know how to do, a hard outcome target pushes you to force a method you have not found, while a learning goal directs effort at finding one.',
   why:'Graded against the source rather than against keywords. Yours did not have to match the wording — it had to carry the mechanism: unfamiliar task, method not yet known.',
   src:'Seijts & Latham (2005) — narrower replication base than the previous card, so treat it as a caution rather than a rule'},

  {kind:'Your own claim', g:'un', hypothesis:true,
   q:'You wrote that three concurrent objectives is the practical ceiling for one person. Nothing in the literature tests this. What would test it?',
   opts:['Read more of the OKR literature until something confirms it',
         'Run two weeks at three objectives and two at five, tracking the same measures',
         'Ask other people whether it sounds right'],
   a:1,
   why:'The first cannot work — I searched, and the single-operator case is not studied. The third gathers opinion, not evidence. The second is weak evidence but real evidence, and it is yours to run.',
   src:'Ungrounded — untested, not disproven. This belongs on the workshop bench as a hypothesis.'},
];

function Practice({close}) {
  const [i,setI] = useState(0);
  const [sel,setSel] = useState(null);
  const [text,setText] = useState('');
  const [shown,setShown] = useState(false);
  const [missed,setMissed] = useState([]);

  if (i >= CARDS.length) {
    return html`
      <div class="quizwrap">
        <div class="qtop">
          <div class="grow"></div>
          <button class="btn text" onClick=${close}>Close</button>
        </div>
        <div class="qbody">
          <div class="pdone">
            <div class="big">${CARDS.length - missed.length}<span style="opacity:.4">/${CARDS.length}</span></div>
            <p class="supporting">Product Management</p>
          </div>
          ${missed.length ? html`
            <div class="sectitle s3" style="margin-top:20px">Worth another look</div>
            <div class="card">
              ${missed.map(k=>html`
                <div class="li" key=${k} style="cursor:default">
                  <div class="lead">${I('help')}</div>
                  <div class="txt" style="font-size:14.5px;line-height:20px">${CARDS[k].q}</div>
                </div>`)}
            </div>` : null}
        </div>
        <div class="qact">
          <button class="btn tonal" onClick=${close}>${I('forum')}Discuss these</button>
          <button class="btn filled" onClick=${close}>Done</button>
        </div>
      </div>`;
  }

  const c = CARDS[i];
  const answered = shown;
  const correct = c.short ? true : sel === c.a;

  const next = () => {
    if (!correct && !c.short) setMissed([...missed, i]);
    setI(i+1); setSel(null); setText(''); setShown(false);
  };

  return html`
    <div class="quizwrap">
      <div class="qtop">
        <div class="qprog"><i style=${{width:((i)/CARDS.length*100)+'%'}}></i></div>
        <button class="btn text" onClick=${close}>Close</button>
      </div>

      <div class="qbody">
        <p class="qkind">${c.kind} · card ${i+1} of ${CARDS.length}</p>
        <p class="qq">${c.cloze
          ? html`${c.q.split('___')[0]}<span class="cloze">${sel!==null?c.opts[sel]:' '}</span>${c.q.split('___')[1]||''}`
          : c.q}</p>

        ${c.short ? html`
          <textarea class="qinput" placeholder="Your answer…" value=${text}
            onInput=${e=>setText(e.target.value)} disabled=${answered}></textarea>`
        : html`
          <div class="qopts">
            ${c.opts.map((o,k)=>html`
              <button key=${k} disabled=${answered}
                class=${'qopt'+(answered
                  ? (k===c.a?' right':(k===sel?' wrong':' muted'))
                  : (sel===k?' sel':''))}
                onClick=${()=>setSel(k)}>${o}</button>`)}
          </div>`}

        ${answered ? html`
          <div class=${'fb '+(c.hypothesis?'neutral':correct?'ok':'no')}>
            <div class="hd">
              ${I(c.hypothesis?'science':correct?'check_circle':'cancel')}
              ${c.hypothesis?'Your hypothesis':correct?'Correct':'Not quite'}
            </div>
            ${c.short && c.model ? html`<p><b>A good answer:</b> ${c.model}</p>`:null}
            <p>${c.why}</p>
            <div class="srcx">${c.src}</div>
            <div class="act">
              <button class="btn text" style="color:inherit">${I('forum')}Ask about this</button>
            </div>
          </div>`:null}
      </div>

      <div class="qact">
        ${!answered ? html`
          <button class="btn text" onClick=${next}>Skip</button>
          <button class="btn filled"
            disabled=${c.short ? !text.trim() : sel===null}
            onClick=${()=>setShown(true)}>Check</button>`
        : html`
          <button class="btn filled" onClick=${next}>
            ${i+1 >= CARDS.length ? 'Finish' : 'Next'}</button>`}
      </div>
    </div>`;
}

/* ---------------- shell ---------------- */

const TABS = [
  {id:'home',ic:'home',label:'Home'},
  {id:'courses',ic:'school',label:'Courses'},
  {id:'work',ic:'handyman',label:'Workshop'},
  {id:'chat',ic:'forum',label:'Aristoteles'},
];

const COURSE = id => COURSES.find(c => c.id === id);
const THEORY = id => THEORIES.find(t => t.id === id);

function App() {
  const [stack,setStack] = useState([{kind:'home'}]);
  useEffect(() => {
    const isBox = el => el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.type !== 'checkbox'));
    const on = e => { if (isBox(e.target)) document.body.classList.add('typing'); };
    const off = () => setTimeout(() => {
      if (!isBox(document.activeElement)) document.body.classList.remove('typing');
    }, 0);
    document.addEventListener('focusin', on); document.addEventListener('focusout', off);
    return () => { document.removeEventListener('focusin', on); document.removeEventListener('focusout', off); };
  }, []);
  const [quiz,setQuiz] = useState(false);
  const [note,setNote] = useState(false);
  const [talk,setTalk] = useState(false);
  const [dial,setDial] = useState(false);
  const [snack,setSnack] = useState(null);
  const [statuses,setStatuses] = useState({});
  const [dx,setDx] = useState(0);
  const [anim,setAnim] = useState(false);
  const armed = useRef(false);
  const pendingTab = useRef(null);
  const drag = useRef(null);

  const top = stack[stack.length - 1];
  const tab = stack[0].kind;

  /* The phone's back button: one history entry stands in for "there is somewhere to go back to".
     Popping it pops one page, instantly; the entry is re-armed while the stack is still deep. */
  useEffect(() => {
    const onPop = () => {
      armed.current = false;
      const t = pendingTab.current; pendingTab.current = null;
      setDx(0); setAnim(false); setDial(false);
      if (t) setStack([{kind:t}]);
      else setStack(s => s.length > 1 ? s.slice(0, -1) : s);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  useEffect(() => {
    if (stack.length > 1 && !armed.current) { history.pushState({lyceum:1}, ''); armed.current = true; }
  }, [stack.length]);

  const push = v => { setDial(false); setStack(s => [...s, v]); };
  const back = () => {
    if (armed.current) history.back();
    else { setDx(0); setAnim(false); setStack(s => s.length > 1 ? s.slice(0, -1) : s); }
  };
  const toTab = t => {
    setDial(false);
    if (armed.current) { pendingTab.current = t; history.back(); } else setStack([{kind:t}]);
  };
  const patchTop = p => setStack(s => [...s.slice(0, -1), {...s[s.length - 1], ...p}]);
  const go = o => {
    if (o.quiz) return setQuiz(true);
    if (o.theory) return setStack([{kind:'work'}, {kind:'theory', id:o.theory}]);
    if (o.course) {
      const base = [{kind:'courses'}, {kind:'course', id:o.course}];
      return setStack(o.chapter ? [...base, {kind:'chapter', id:o.course, n:o.chapter}] : base);
    }
    if (o.tab) return toTab(o.tab);
  };
  const setStatus = (id,st) => setStatuses({...statuses, [id]:st});

  const view = (v, isTop) => {
    switch (v.kind) {
      case 'home':    return {title:'Lyceum', body:html`<${Home} go=${go} statuses=${statuses} />`};
      case 'courses': return {title:'Courses', body:html`<${Courses} statuses=${statuses} setStatus=${setStatus} go=${go} />`};
      case 'work':    return {title:'Workshop', body:html`<${Workshop} setTheory=${t => push({kind:'theory', id:t.id})} />`};
      case 'chat':    return {title:'Aristoteles', body:html`<${Chat} thread=${null} setThread=${id => push({kind:'thread', id})} />`};
      case 'course':  { const c = COURSE(v.id);
        return {title:c.title, discuss:true, ctx:c.title, here:destOfCourse(c),
                body:html`<${CourseDetail} course=${c} statuses=${statuses} setStatus=${setStatus} go=${go} />`}; }
      case 'chapter': { const c = COURSE(v.id);
        return {title:c.title, discuss:true, ctx:c.chs[v.n - 1], here:destOfCourse(c), body:html`<${Reading} course=${c} n=${v.n} />`}; }
      case 'theory':  { const t = THEORY(v.id);
        return {title:t.title, discuss:true, ctx:t.title, here:destOfProject(t),
                body:html`<${Bench} theory=${t} push=${push} stageIn=${v.stage}
                            setStageIn=${isTop ? (st => patchTop({stage:st})) : (() => {})} />`}; }
      case 'file':    return {title:baseName(v.file.f), discuss:true, ctx:baseName(v.file.f),
                              here:destOfProject(THEORY(v.theoryId || 'axio')),
                              body:html`<${FileView} file=${v.file} />`};
      case 'disc':    return {title:v.d.t, chat:true, body:html`<${DiscussionView} d=${v.d} />`};
      case 'thread':  return {title:CHATS.find(x => x.id === v.id).topic, chat:true,
                              body:html`<${Chat} thread=${v.id} setThread=${() => {}} />`};
    }
  };

  /* Swipe right anywhere to go back. The page you came from lies still underneath; the page
     you are on slides off to the right and uncovers it. */
  const W = () => window.innerWidth || 400;
  const onTouchStart = e => {
    if (stack.length < 2 || anim) return;
    const p = e.touches[0];
    drag.current = {x:p.clientX, y:p.clientY, dx:0, lock:null, t:Date.now()};
  };
  const onTouchMove = e => {
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
         style=${style} key=${'p' + (depth - 1) + v.kind}>
      <header class=${'appbar' + (depth > 1 ? ' hasback' : '')}>
        ${depth > 1 ? html`<button class="iconbtn" onClick=${isTop ? back : null}>${I('arrow_back')}</button>` : null}
        <h1>${p.title}</h1>
      </header>
      <main class=${p.chat ? 'chatmain' : ''}>${p.body}</main>
    </div>`;

  const cur = view(top, true);
  const showUnder = stack.length > 1 && (dx > 0 || anim);
  const under = showUnder ? stack[stack.length - 2] : null;

  const fab = cur.chat ? null : cur.discuss ? html`
    ${dial ? html`<div class="dialscrim" onClick=${() => setDial(false)}></div>` : null}
    <div class="fabstack" style=${dx ? {opacity:0} : null}>
      ${dial ? html`
        <button class="minifab" onClick=${() => { setDial(false); setTalk(true); }}>
          <span class="lbl">Discuss</span>
          <span class="mf" style="background:var(--tertiary);color:#fff">${I('forum')}</span></button>
        <button class="minifab" onClick=${() => { setDial(false); setNote(true); }}>
          <span class="lbl">Note</span>
          <span class="mf" style="background:var(--primary-container);color:var(--on-primary-container)">${I('edit_note')}</span></button>` : null}
      <button class=${'fab dial' + (dial ? ' open' : '')} onClick=${() => setDial(!dial)}>${I('add')}</button>
    </div>` : html`
    <div class="fabstack" style=${dx ? {opacity:0} : null}>
      <button class="fab dial" onClick=${() => setNote(true)}>${I('edit_note')}</button>
    </div>`;

  return html`
    <div class="stage" onTouchStart=${onTouchStart} onTouchMove=${onTouchMove}
         onTouchEnd=${onTouchEnd} onTouchCancel=${onTouchEnd}>
      ${under ? page(under, stack.length - 1, false, view(under, false),
          {'--dim': (0.18 * (1 - dx / W())).toFixed(3)}) : null}
      ${page(top, stack.length, true, cur,
          {transform: dx ? `translateX(${dx}px)` : 'none',
           transition: anim ? 'transform .23s cubic-bezier(.2,0,0,1)' : 'none'})}
    </div>
    ${fab}
    <nav class="navbar">
      ${TABS.map(t => html`
        <button key=${t.id} class=${tab === t.id && stack.length === 1 ? 'on' : ''}
          onClick=${() => toTab(t.id)}>
          <span class="ind">${I(t.ic)}</span>${t.label}
        </button>`)}
    </nav>
    ${quiz ? html`<${Practice} close=${() => setQuiz(false)} />` : null}
    ${talk ? html`<${GeneralTalk} close=${() => setTalk(false)} title=${cur.ctx || ''} />` : null}
    ${note ? html`<${NoteSheet} here=${cur.here} close=${() => setNote(false)}
        onSave=${d => { setNote(false); setSnack(d); setTimeout(() => setSnack(null), 4000); }} />` : null}
    ${snack ? html`<div class="snack">Saved to <code>${snack}</code></div>` : null}`;
}

render(html`<${App} />`, document.getElementById('app'));
