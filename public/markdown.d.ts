/* Types for the buildless browser module beside this file. `markdown.js` is
   loaded straight into the page by a `<script type="module">` and is never
   compiled, so it stays plain JavaScript; this declaration exists only so that
   `tsc --noEmit` can check the vitest suite that imports it. */
export type Inline =
  | { t: 'text'; v: string }
  | { t: 'strong'; v: string }
  | { t: 'em'; v: string }
  | { t: 'code'; v: string }
  | { t: 'source'; v: string }
  | { t: 'link'; v: string; href: string };

export type Block =
  | { kind: 'blank' }
  | { kind: 'hr' }
  | { kind: 'p'; content: Inline[] }
  | { kind: 'heading'; level: number; content: Inline[] }
  | { kind: 'code'; text: string }
  | { kind: 'ul'; items: Inline[][] }
  | { kind: 'ol'; start: number; items: Inline[][] }
  | { kind: 'table'; header: Inline[][] | null; rows: Inline[][][] }
  | { kind: 'mixed'; parts: Block[] };

export function blocksOf(body: string): string[];
export function parseBlock(raw: string): Block;
export function inlineTokens(raw: string): Inline[];
export function sourceLabel(file: string, sourcesById: Record<string, { title?: string }>): string;
