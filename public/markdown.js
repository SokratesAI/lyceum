/* The chapter text is markdown, and until now the reading view printed it raw --
   `# Analysis Techniques` and `[source: cohort-analysis.md]` sat on the page as
   literal characters. This module turns one block of that markdown into tokens.

   It is a parser and not a renderer on purpose: it returns plain data, so the
   vnodes get built in `app.js` where Preact lives and the tokens can be checked
   by an ordinary test that never opens a browser. Nothing here produces HTML,
   so there is no innerHTML anywhere in the reading path and course text cannot
   inject markup into the page.

   The one rule the rest of the view depends on: **`blocksOf` must return the
   same array `paragraphsOf` in `src/claims.ts` returns**, blank entries and all.
   A GRADE mark is placed by index into that array, so dropping or merging a
   block here moves every mark after it onto the wrong text. `blocksOf` is that
   same split, written out here rather than imported because the server is
   TypeScript and this file is loaded straight into the browser.

   Deliberately not supported, because the six courses contain none of it:
   nested lists, reference links, setext headings, inline HTML. Measured across
   all 61 chapters in the live database -- 1,412 paragraphs, 688 headings, 64
   bullet lists, 38 numbered lists, 7 tables, 6 code fences, 3 rules, and inline
   1,482 source markers, 816 bold, 63 italic, 10 code, 0 links. */

export function blocksOf(body) {
  return String(body == null ? '' : body).split(/\n{2,}/);
}

/** One block of markdown -> a block token. `content` fields hold inline tokens. */
export function parseBlock(raw) {
  const text = String(raw == null ? '' : raw);
  const trimmed = text.trim();
  if (!trimmed) return { kind: 'blank' };

  const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
  if (heading) return { kind: 'heading', level: heading[1].length, content: inlineTokens(heading[2]) };

  if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) return { kind: 'hr' };

  if (trimmed.startsWith('```')) {
    const lines = trimmed.split('\n');
    if (lines[0].startsWith('```')) lines.shift();
    if (lines.length && lines[lines.length - 1].trim() === '```') lines.pop();
    return { kind: 'code', text: lines.join('\n') };
  }

  const lines = trimmed.split('\n');
  if (lines.every((l) => /^\s*\|/.test(l)) && lines.length >= 2) {
    const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    const rows = lines.map(cells);
    const isRule = (r) => r.length > 0 && r.every((c) => /^:?-{1,}:?$/.test(c));
    const header = isRule(rows[1]) ? rows.shift() : null;
    if (header) rows.shift(); // the |---| separator
    return {
      kind: 'table',
      header: header ? header.map(inlineTokens) : null,
      rows: rows.map((r) => r.map(inlineTokens)),
    };
  }

  if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
    return { kind: 'ul', items: lines.map((l) => inlineTokens(l.replace(/^\s*[-*]\s+/, ''))) };
  }
  if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) {
    const start = Number(/^\s*(\d+)/.exec(lines[0])[1]);
    return { kind: 'ol', start, items: lines.map((l) => inlineTokens(l.replace(/^\s*\d+[.)]\s+/, ''))) };
  }

  /* A block whose lines are not all the same kind. Four of the 61 chapters put a
     `## heading` or a ``` fence on the line *after* a sentence, with only a
     single newline between them, so the whole run arrives here as one block and
     would print its markers raw. It is split into homogeneous parts and the
     parts are parsed again -- but it stays **one** block, because the block
     array is what a GRADE mark's index points into. */
  const parts = groupLines(lines);
  if (parts.length > 1) return { kind: 'mixed', parts: parts.map(parseBlock) };

  return { kind: 'p', content: inlineTokens(text) };
}

/** Lines -> runs of one kind each: a heading alone, a fenced block whole, prose together. */
function groupLines(lines) {
  const out = [];
  let run = [];
  let fenced = false;
  const flush = () => { if (run.length) { out.push(run.join('\n')); run = []; } };
  for (const line of lines) {
    if (fenced) {
      run.push(line);
      if (line.trim().startsWith('```')) { fenced = false; flush(); }
      continue;
    }
    if (line.trim().startsWith('```')) { flush(); run.push(line); fenced = true; continue; }
    if (/^\s*#{1,6}\s+/.test(line)) { flush(); out.push(line); continue; }
    run.push(line);
  }
  flush();
  return out;
}

/* Inline markers, longest and least ambiguous first. `**` has to be tried
   before `*` or every bold run parses as two empty italics. A source marker is
   matched before anything else because its body is a filename and a filename
   can contain the characters the emphasis rules use. */
const INLINE = new RegExp(
  [
    /\[source:\s*([^\]]+)\]/.source,      // 1: source marker
    /`([^`\n]+)`/.source,                 // 2: code
    /\*\*([^*]+)\*\*/.source,             // 3: strong
    /\*([^*\n]+)\*/.source,               // 4: em
    /\[([^\]]+)\]\(([^)\s]+)\)/.source,   // 5,6: link
  ].join('|'),
  'g',
);

/** A run of inline markdown -> text/strong/em/code/source/link tokens. */
export function inlineTokens(raw) {
  const text = String(raw == null ? '' : raw);
  const out = [];
  let at = 0;
  let m;
  INLINE.lastIndex = 0;
  while ((m = INLINE.exec(text)) !== null) {
    if (m.index > at) out.push({ t: 'text', v: text.slice(at, m.index) });
    if (m[1] !== undefined) out.push({ t: 'source', v: m[1].trim() });
    else if (m[2] !== undefined) out.push({ t: 'code', v: m[2] });
    else if (m[3] !== undefined) out.push({ t: 'strong', v: m[3] });
    else if (m[4] !== undefined) out.push({ t: 'em', v: m[4] });
    else out.push({ t: 'link', v: m[5], href: m[6] });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ t: 'text', v: text.slice(at) });
  return out;
}

/* A source marker names a file (`cohort-analysis.md`). The chapter endpoint
   returns the sources its claims cite, keyed by document id -- `source:<course>:<slug>`
   -- so the file's stem is the slug, and the title is whatever the import read
   off the source note. A marker whose source is not in that map (the endpoint
   sends only cited ones) keeps its own stem rather than being dropped: the
   course said where the sentence came from and that is worth showing even when
   the title is not to hand. */
export function sourceLabel(file, sourcesById) {
  const stem = String(file || '').replace(/\.md$/i, '');
  for (const id of Object.keys(sourcesById || {})) {
    if (id.split(':').pop() === stem) return (sourcesById[id] || {}).title || stem;
  }
  return stem;
}
