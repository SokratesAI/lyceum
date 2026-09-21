/* The chapter reading view's markdown parser (`public/markdown.js`).

   It is browser code with no DOM in it, so vitest can import it directly and
   check the tokens. The test that matters most is the last one: a GRADE mark is
   placed by index into the block array, and `blocksOf` here must return exactly
   what `paragraphsOf` in `claims.ts` returns or every mark after a dropped
   block lands on the wrong text. */
import { describe, it, expect } from 'vitest';
import { blocksOf, parseBlock, inlineTokens, sourceLabel } from '../public/markdown.js';
import { paragraphsOf } from './claims.js';

describe('blocks', () => {
  it('reads a heading and its level', () => {
    expect(parseBlock('## Cohort Analysis')).toEqual({
      kind: 'heading', level: 2, content: [{ t: 'text', v: 'Cohort Analysis' }],
    });
  });

  it('does not treat a sentence beginning with # as a heading', () => {
    expect(parseBlock('#1 is the rank we want').kind).toBe('p');
  });

  it('reads a bullet list as one block of items', () => {
    const b: any = parseBlock('- first\n- second');
    expect(b.kind).toBe('ul');
    expect(b.items.map((i: any) => i[0].v)).toEqual(['first', 'second']);
  });

  it('keeps a numbered list starting where it started', () => {
    const b: any = parseBlock('3. third\n4. fourth');
    expect(b.kind).toBe('ol');
    expect(b.start).toBe(3);
  });

  it('reads a pipe table with its header row', () => {
    const b: any = parseBlock('| Metric | Meaning |\n|---|---|\n| DAU | daily actives |');
    expect(b.kind).toBe('table');
    expect(b.header.map((c: any) => c[0].v)).toEqual(['Metric', 'Meaning']);
    expect(b.rows).toHaveLength(1);
    expect(b.rows[0][1][0].v).toBe('daily actives');
  });

  it('strips the fences off a code block', () => {
    expect(parseBlock('```sql\nselect 1\n```')).toEqual({ kind: 'code', text: 'select 1' });
  });

  it('keeps an empty block empty rather than dropping it', () => {
    expect(parseBlock('   ')).toEqual({ kind: 'blank' });
  });
});

describe('inline', () => {
  it('pulls a source marker out as its own token', () => {
    expect(inlineTokens('…over time. [source: cohort-analysis.md]')).toEqual([
      { t: 'text', v: '…over time. ' },
      { t: 'source', v: 'cohort-analysis.md' },
    ]);
  });

  it('reads bold before italic, so ** never parses as two empty italics', () => {
    expect(inlineTokens('what are called **actionable metrics** here')).toEqual([
      { t: 'text', v: 'what are called ' },
      { t: 'strong', v: 'actionable metrics' },
      { t: 'text', v: ' here' },
    ]);
  });

  it('leaves a lone asterisk alone', () => {
    expect(inlineTokens('2 * 3 = 6')).toEqual([{ t: 'text', v: '2 * 3 = 6' }]);
  });

  it('reads code and a link', () => {
    expect(inlineTokens('run `npm test` per [the docs](https://x.test/d)')).toEqual([
      { t: 'text', v: 'run ' },
      { t: 'code', v: 'npm test' },
      { t: 'text', v: ' per ' },
      { t: 'link', v: 'the docs', href: 'https://x.test/d' },
    ]);
  });

  it('loses no characters, whatever the markup', () => {
    const line = 'A **bold** and *thin* `code` line. [source: a-b.md]';
    const back = inlineTokens(line).map((t: any) => t.v).join('');
    expect(back).toBe('A bold and thin code line. a-b.md');
  });
});

describe('source labels', () => {
  const sources = { 'source:analytics:cohort-analysis': { title: 'Cohort Analysis' } };

  it('titles a marker whose source the chapter sent', () => {
    expect(sourceLabel('cohort-analysis.md', sources)).toBe('Cohort Analysis');
  });

  it('keeps the file stem when the source was not sent, rather than dropping it', () => {
    expect(sourceLabel('never-cited.md', sources)).toBe('never-cited');
    expect(sourceLabel('never-cited.md', {})).toBe('never-cited');
  });
});

describe('block indexes match the server that places the marks', () => {
  const bodies = [
    '# One\n\nfirst\n\n\nsecond\n\n- a\n- b\n',
    'only one paragraph',
    'a\n\n\n\n\nb',
    '',
  ];
  for (const body of bodies) {
    it(`agrees with paragraphsOf on ${JSON.stringify(body.slice(0, 24))}`, () => {
      expect(blocksOf(body)).toEqual(paragraphsOf(body));
    });
  }

  it('renders one block per entry, so a mark index cannot shift', () => {
    const body = '# One\n\n\n\nafter a blank';
    const blocks = blocksOf(body);
    expect(blocks).toHaveLength(2);
    expect(blocks.map(parseBlock).map((b: any) => b.kind)).toEqual(['heading', 'p']);
  });
});

describe('a block whose lines are not all one kind', () => {
  it('splits a heading that follows a sentence, without becoming two blocks', () => {
    const b: any = parseBlock('A sentence.\n### Then a heading\nand more prose');
    expect(b.kind).toBe('mixed');
    expect(b.parts.map((x: any) => x.kind)).toEqual(['p', 'heading', 'p']);
    expect(b.parts[1].level).toBe(3);
  });

  it('splits a fence opening mid-paragraph and keeps the formula', () => {
    const b: any = parseBlock('**TCPI** is:\n```\nTCPI = (BAC - EV) / (BAC - AC)\n```');
    expect(b.kind).toBe('mixed');
    expect(b.parts.map((x: any) => x.kind)).toEqual(['p', 'code']);
    expect(b.parts[1].text).toBe('TCPI = (BAC - EV) / (BAC - AC)');
  });

  it('leaves an ordinary multi-line paragraph as one paragraph', () => {
    expect(parseBlock('one line\nand its continuation').kind).toBe('p');
  });
});
