#!/usr/bin/env node
// Builds REPORT.html, the main report a person reads: one self-contained page
// rendered from the knowledge base's Markdown, with images embedded, IDs linked,
// and no scripts or external requests. No dependencies.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const USAGE = 'Usage: node build-report.mjs <kb-dir> [--out <file.html>] [--help]';
const ID_PATTERN = /\b(FL|SRC|EV|BR|F|S|C|R|E|B|Q|L)-(\d{3})\b/g;
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const COVERAGE = ['done', 'partial', 'blocked', 'todo', 'n/a'];
const CHIP_WORDS = /^(blocks launch|blocks feature|adds lead time|adds cost|moat|required to sell|important|minor)\b/i;
const CATALOG_FILES = ['inventory/features.md', 'inventory/screens.md', 'sources.md', 'questions.md', 'findings.md'];

const escapeHtml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const read = (kb, file) => (existsSync(join(kb, file)) ? readFileSync(join(kb, file), 'utf8') : '');
// A comment on its own line goes with its line, so tables around it stay intact.
const stripComments = (text) => text.replace(/^[ \t]*<!--[\s\S]*?-->[ \t]*\r?\n/gm, '').replace(/<!--[\s\S]*?-->/g, '');
const listDir = (kb, dir, filter = () => true) =>
  existsSync(join(kb, dir)) ? readdirSync(join(kb, dir)).filter((name) => !name.startsWith('.') && filter(name)).sort().map((name) => `${dir}/${name}`) : [];

// Everything the renderer needs to resolve images and links.
function makeContext(kb) {
  const anchors = new Set();
  const fileIds = new Map();
  const evidence = new Map();
  for (const dir of ['screens', 'components', 'flows', 'data-model/entities']) {
    for (const file of listDir(kb, dir, (name) => name.endsWith('.md'))) {
      const id = basename(file).match(/^([A-Z]+-\d{3})/)?.[1];
      if (id) {
        fileIds.set(file, id);
        anchors.add(id);
      }
    }
  }
  for (const file of listDir(kb, 'evidence')) {
    const id = basename(file).match(/^(EV-\d{3})/)?.[1];
    if (id) {
      evidence.set(id, file);
      anchors.add(id);
    }
  }
  const markdown = [...CATALOG_FILES, 'clone/barriers.md', ...listDir(kb, 'rules', (name) => name.endsWith('.md'))];
  for (const file of markdown) {
    for (const line of stripComments(read(kb, file)).split('\n')) {
      const id = line.match(/^#{1,6}\s+([A-Z]+-\d{3})\b/)?.[1] || (CATALOG_FILES.includes(file) && line.match(/^\|\s*([A-Z]+-\d{3})\s*\|/)?.[1]);
      if (id) anchors.add(id);
    }
  }
  return { kb, anchors, fileIds, evidence, emitted: new Set(), embedded: new Set() };
}

function dataUri(ctx, file) {
  const mime = MIME[extname(file).toLowerCase()];
  if (!mime || !existsSync(join(ctx.kb, file))) return null;
  ctx.embedded.add(file);
  return `data:${mime};base64,${readFileSync(join(ctx.kb, file)).toString('base64')}`;
}

// Turns a Markdown link target into an in-page anchor or an external URL.
function resolveHref(ctx, href, baseDir) {
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith('#')) return href;
  const target = relative(ctx.kb, resolve(ctx.kb, baseDir, href.split('#')[0])).split(sep).join('/');
  const id = ctx.fileIds.get(target) || basename(target).match(/^(EV-\d{3}|[A-Z]+-\d{3})/)?.[1];
  return id && ctx.anchors.has(id) ? `#${id}` : null;
}

function linkIds(ctx, escaped) {
  return escaped.replace(ID_PATTERN, (id) => (ctx.anchors.has(id) ? `<a href="#${id}">${id}</a>` : id));
}

const INLINE = /(`[^`]+`)|!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|(?<![\w*])\*([^*\s][^*]*?)\*(?![\w*])/g;

function renderInline(ctx, text, baseDir) {
  let html = '';
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    html += linkIds(ctx, escapeHtml(text.slice(last, match.index)));
    last = match.index + match[0].length;
    const [, code, alt, src, label, href, bold, italic] = match;
    if (code) html += `<code>${linkIds(ctx, escapeHtml(code.slice(1, -1)))}</code>`;
    else if (src !== undefined) {
      const file = relative(ctx.kb, resolve(ctx.kb, baseDir, src)).split(sep).join('/');
      const uri = dataUri(ctx, file);
      html += uri ? `<img src="${uri}" alt="${escapeHtml(alt)}" loading="lazy">` : `<span class="missing">[image not found: ${escapeHtml(src)}]</span>`;
    } else if (label !== undefined) {
      const target = resolveHref(ctx, href, baseDir);
      const inner = renderInline(ctx, label, baseDir);
      html += target ? `<a href="${escapeHtml(target)}">${inner}</a>` : inner;
    } else if (bold) html += `<strong>${renderInline(ctx, bold, baseDir)}</strong>`;
    else if (italic) html += `<em>${renderInline(ctx, italic, baseDir)}</em>`;
  }
  return html + linkIds(ctx, escapeHtml(text.slice(last)));
}

// Chips for barrier severity, market weight and coverage values.
function chipClass(value) {
  const v = value.toLowerCase();
  if (/blocks launch|required to sell/.test(v)) return 'red';
  if (/blocks feature|important|blocked/.test(v)) return 'amber';
  if (/lead time|adds cost|partial/.test(v)) return 'blue';
  if (/done/.test(v)) return 'green';
  return 'gray';
}

function renderCell(ctx, cell, baseDir) {
  const value = cell.trim();
  const coverage = COVERAGE.find((word) => value.toLowerCase() === word || value.toLowerCase().startsWith(`${word}:`) || value.toLowerCase().startsWith(`${word} `));
  if (coverage) return `<span class="chip ${chipClass(coverage)}">${escapeHtml(value)}</span>`;
  const keyword = value.match(CHIP_WORDS)?.[1];
  if (keyword) return `<span class="chip ${chipClass(keyword)}">${escapeHtml(keyword)}</span>${renderInline(ctx, value.slice(keyword.length), baseDir)}`;
  if (/^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i.test(value)) return `<span class="swatch" style="background:${escapeHtml(value)}"></span>${escapeHtml(value)}`;
  return renderInline(ctx, value, baseDir);
}

const splitRow = (line) =>
  line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, '|'));

function renderTable(ctx, lines, baseDir, file) {
  const [head, , ...rows] = lines;
  const heads = splitRow(head).map((cell) => `<th>${renderInline(ctx, cell.trim(), baseDir)}</th>`).join('');
  const body = rows
    .map((line) => {
      const cells = splitRow(line);
      const id = CATALOG_FILES.includes(file) && cells[0]?.trim().match(/^([A-Z]+-\d{3})$/)?.[1];
      const attr = id && !ctx.emitted.has(id) && ![...ctx.fileIds.values()].includes(id) ? ` id="${id}"` : '';
      if (attr) ctx.emitted.add(id);
      return `<tr${attr}>${cells.map((cell) => `<td>${renderCell(ctx, cell, baseDir)}</td>`).join('')}</tr>`;
    })
    .join('');
  return `<div class="table"><table><thead><tr>${heads}</tr></thead><tbody>${body}</tbody></table></div>`;
}

// "Severity: blocks feature (until approval)" shows the keyword as a chip and the rest as text.
function renderListItem(ctx, text, baseDir) {
  const field = text.match(/^(Severity|Market weight):\s*(.+)$/);
  const keyword = field?.[2].match(CHIP_WORDS)?.[1];
  if (!keyword) return renderInline(ctx, text, baseDir);
  const rest = field[2].slice(keyword.length);
  return `${field[1]}: <span class="chip ${chipClass(keyword)}">${escapeHtml(keyword)}</span>${renderInline(ctx, rest, baseDir)}`;
}

// Nested lists: an item indented deeper than the current level belongs to the previous item.
function renderList(ctx, items, start, indent, baseDir) {
  const tag = items[start].ordered ? 'ol' : 'ul';
  let html = `<${tag}>`;
  let i = start;
  while (i < items.length && items[i].indent >= indent) {
    if (items[i].indent > indent) {
      const [nested, next] = renderList(ctx, items, i, items[i].indent, baseDir);
      html = html.replace(/<\/li>$/, `${nested}</li>`);
      i = next;
      continue;
    }
    html += `<li>${renderListItem(ctx, items[i].text, baseDir)}</li>`;
    i += 1;
  }
  return [`${html}</${tag}>`, i];
}

// Renders the Markdown subset the knowledge base uses.
function renderMarkdown(ctx, markdown, file, headingShift = 0) {
  const baseDir = dirname(file);
  const lines = stripComments(markdown).split('\n');
  const out = [];
  let paragraph = [];
  const flush = () => {
    if (paragraph.length) out.push(`<p>${renderInline(ctx, paragraph.join(' '), baseDir)}</p>`);
    paragraph = [];
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const fence = line.match(/^```(\w*)/);
    if (fence) {
      flush();
      const code = [];
      for (i += 1; i < lines.length && !/^```/.test(lines[i]); i += 1) code.push(lines[i]);
      out.push(`<pre class="${fence[1] || 'text'}"><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flush();
      const level = Math.min(6, heading[1].length + headingShift);
      const id = heading[2].match(/^([A-Z]+-\d{3})\b/)?.[1];
      const attr = id && !ctx.emitted.has(id) ? ` id="${id}"` : '';
      if (attr) ctx.emitted.add(id);
      out.push(`<h${level}${attr}>${renderInline(ctx, heading[2], baseDir)}</h${level}>`);
      continue;
    }
    if (line.trim().startsWith('|') && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] || '')) {
      flush();
      const table = [];
      for (; i < lines.length && lines[i].trim().startsWith('|'); i += 1) table.push(lines[i]);
      i -= 1;
      out.push(renderTable(ctx, table, baseDir, file));
      continue;
    }
    const item = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
    if (item) {
      flush();
      const items = [];
      for (; i < lines.length; i += 1) {
        const next = lines[i].match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
        if (next) items.push({ indent: next[1].length, ordered: /\d/.test(next[2]), text: next[3] });
        else if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) items[items.length - 1].text += ` ${lines[i].trim()}`;
        else break;
      }
      i -= 1;
      out.push(renderList(ctx, items, 0, items[0].indent, baseDir)[0]);
      continue;
    }
    if (/^>\s?/.test(line)) {
      flush();
      const quote = [];
      for (; i < lines.length && /^>\s?/.test(lines[i]); i += 1) quote.push(lines[i].replace(/^>\s?/, ''));
      i -= 1;
      out.push(`<blockquote>${renderInline(ctx, quote.join(' '), baseDir)}</blockquote>`);
      continue;
    }
    if (/^-{3,}\s*$/.test(line)) {
      flush();
      out.push('<hr>');
      continue;
    }
    paragraph.push(line.trim());
  }
  flush();
  return out.join('\n');
}

// Collapsible section per file (screens, components, flows, entities, topics).
function renderFiles(ctx, files) {
  return files
    .map((file) => {
      const text = read(ctx.kb, file);
      const title = text.match(/^#\s+(.*)$/m)?.[1] ?? basename(file, '.md');
      const id = ctx.fileIds.get(file);
      const attr = id && !ctx.emitted.has(id) ? ` id="${id}"` : '';
      if (attr) ctx.emitted.add(id);
      const body = renderMarkdown(ctx, text.replace(/^#\s+.*$/m, ''), file, 1);
      return `<details${attr}><summary>${renderInline(ctx, title, dirname(file))}</summary><div class="file">${body}</div></details>`;
    })
    .join('\n');
}

function section(id, title, html) {
  return html.trim() ? `<section id="${id}"><h2>${escapeHtml(title)}</h2>${html}</section>` : '';
}

function markdownSection(ctx, file, headingShift = 1) {
  const text = read(ctx.kb, file);
  return text ? renderMarkdown(ctx, text.replace(/^#\s+.*$/m, ''), file, headingShift) : '';
}

// The part of STATUS.md under one "## Heading", rendered.
function statusPart(ctx, status, name) {
  const match = status.match(new RegExp(`^##\\s+${name}\\s*$([\\s\\S]*?)(?=^##\\s|$(?![\\s\\S]))`, 'm'));
  return match ? renderMarkdown(ctx, match[1], 'STATUS.md') : '';
}

function countCoverage(kb) {
  const counts = Object.fromEntries(COVERAGE.map((value) => [value, 0]));
  for (const line of stripComments(read(kb, 'inventory/coverage.md')).split('\n')) {
    if (!/^\|\s*F-\d{3}/.test(line)) continue;
    for (const cell of line.split('|').slice(2, -2)) {
      const value = COVERAGE.find((word) => cell.trim().toLowerCase().startsWith(word));
      if (value) counts[value] += 1;
    }
  }
  return counts;
}

function evidenceGallery(ctx) {
  const index = new Map();
  for (const line of read(ctx.kb, 'evidence/index.csv').split('\n').slice(1)) {
    const cells = line.split(',');
    if (cells[0]) index.set(cells[0].trim(), cells.slice(4, -1).join(',').replace(/^"|"$/g, '').trim());
  }
  const items = [...ctx.evidence.entries()].sort(([a], [b]) => a.localeCompare(b));
  return items
    .map(([id, file]) => {
      const caption = `<figcaption><strong>${id}</strong> ${escapeHtml(index.get(id) || basename(file))}</figcaption>`;
      const attr = ctx.emitted.has(id) ? '' : ` id="${id}"`;
      ctx.emitted.add(id);
      if (MIME[extname(file).toLowerCase()]) {
        if (ctx.embedded.has(file)) return `<figure${attr} class="small">${caption}<p class="note">Shown in the text above.</p></figure>`;
        return `<figure${attr}><img src="${dataUri(ctx, file)}" alt="${escapeHtml(index.get(id) || id)}" loading="lazy">${caption}</figure>`;
      }
      const size = statSync(join(ctx.kb, file)).size;
      return `<figure${attr} class="small">${caption}<p class="note"><code>${escapeHtml(file)}</code>, ${(size / 1024).toFixed(1)} KB, in the knowledge base folder.</p></figure>`;
    })
    .join('\n');
}

const CSS = `
:root{--bg:#ffffff;--fg:#17212b;--muted:#5b6875;--line:#dde3e9;--soft:#f4f7fa;--accent:#1a5276;--red:#b0413e;--amber:#a86a12;--blue:#1f6aa5;--green:#2e7d5b;--gray:#5b6875;
--red-bg:#f7e1e0;--amber-bg:#fbf0dc;--blue-bg:#e3eef8;--green-bg:#e3f2ea;--gray-bg:#eceff2;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#0f151b;--fg:#e4eaf0;--muted:#9aa9b7;--line:#2a3845;--soft:#16212b;--accent:#7fb3d9;--red:#e48a86;--amber:#e2b25a;--blue:#8cc0ea;--green:#6cc59a;--gray:#9aa9b7;
--red-bg:#3a1d1c;--amber-bg:#33280f;--blue-bg:#172a3a;--green-bg:#173327;--gray-bg:#222c35;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.layout{display:grid;grid-template-columns:240px minmax(0,1fr);max-width:1240px;margin:0 auto;gap:40px;padding:32px max(16px,env(safe-area-inset-right))}
nav{position:sticky;top:24px;align-self:start;font-size:14px}nav a{display:block;color:var(--muted);text-decoration:none;padding:3px 0}nav a:hover{color:var(--accent)}
main{min-width:0}header h1{font-size:32px;line-height:1.2;margin:0 0 6px}header p{color:var(--muted);margin:0}
h2{font-size:24px;margin:48px 0 14px;padding-top:12px;border-top:1px solid var(--line)}h3{font-size:19px;margin:28px 0 8px}h4,h5,h6{font-size:16px;margin:20px 0 6px}
a{color:var(--accent)}code{font:13.5px ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--soft);padding:1px 5px;border-radius:4px}
pre{background:var(--soft);padding:14px 16px;border-radius:8px;overflow-x:auto}pre code{background:none;padding:0}
.table{overflow-x:auto;margin:12px 0}table{border-collapse:collapse;width:100%;font-size:14.5px}th,td{text-align:left;vertical-align:top;padding:7px 10px;border-bottom:1px solid var(--line)}th{border-bottom:2px solid var(--fg)}
img{max-width:100%;height:auto;border:1px solid var(--line);border-radius:6px;margin:8px 0}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin:18px 0}.tiles div{background:var(--soft);border-radius:8px;padding:12px 14px}
.tiles strong{display:block;font-size:26px;font-variant-numeric:tabular-nums}.tiles span{color:var(--muted);font-size:13.5px}
.chip{display:inline-block;font-size:12.5px;font-weight:600;padding:1px 9px;border-radius:999px;white-space:nowrap}
.chip.red{color:var(--red);background:var(--red-bg)}.chip.amber{color:var(--amber);background:var(--amber-bg)}.chip.blue{color:var(--blue);background:var(--blue-bg)}.chip.green{color:var(--green);background:var(--green-bg)}.chip.gray{color:var(--gray);background:var(--gray-bg)}
.swatch{display:inline-block;width:14px;height:14px;border-radius:3px;border:1px solid var(--line);vertical-align:-2px;margin-right:6px}
details{border:1px solid var(--line);border-radius:8px;margin:8px 0;padding:0 14px}summary{cursor:pointer;padding:10px 0;font-weight:600}details[open] summary{border-bottom:1px solid var(--line);margin-bottom:8px}
.file{padding-bottom:10px}blockquote{margin:12px 0;padding:6px 14px;border-left:3px solid var(--line);color:var(--muted)}
.gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px}figure{margin:0}figcaption{font-size:13.5px;color:var(--muted)}figure.small{background:var(--soft);border-radius:8px;padding:10px 12px}
.note{color:var(--muted);font-size:13.5px;margin:4px 0}.missing{color:var(--red)}footer{color:var(--muted);font-size:13.5px;margin:56px 0 24px;border-top:1px solid var(--line);padding-top:14px}
@media (max-width:860px){.layout{grid-template-columns:1fr}nav{position:static;columns:2}}
`;

export function buildReport(kbDir) {
  const kb = resolve(kbDir);
  const ctx = makeContext(kb);
  const status = read(kb, 'STATUS.md');
  const product = status.match(/^# Status:\s*(.+)$/m)?.[1]?.trim() || basename(kb);
  const statusLine = status.match(/^Updated:.*$/m)?.[0] ?? '';
  const coverage = countCoverage(kb);
  const measured = COVERAGE.slice(0, 4).reduce((sum, value) => sum + coverage[value], 0);
  const count = (pattern, text) => (text.match(pattern) || []).length;
  const rulesText = listDir(kb, 'rules', (name) => name.endsWith('.md')).map((file) => read(kb, file)).join('\n');
  const numbers = [
    [count(/^\|\s*F-\d{3}/gm, stripComments(read(kb, 'inventory/features.md'))), 'features'],
    [listDir(kb, 'screens', (name) => /^S-\d{3}/.test(name)).length, 'screens'],
    [count(/^#{1,6}\s+R-\d{3}/gm, stripComments(rulesText)), 'business rules'],
    [count(/^#{1,6}\s+BR-\d{3}/gm, stripComments(read(kb, 'clone/barriers.md'))), 'production barriers'],
    [listDir(kb, 'data-model/entities', (name) => /^E-\d{3}/.test(name)).length, 'entities'],
    [ctx.evidence.size, 'evidence files'],
    [measured ? `${Math.round((coverage.done / measured) * 100)}%` : 'n/a', 'coverage done'],
  ];

  const sections = [
    ['summary', 'Summary', `${statusPart(ctx, status, 'Summary')}<div class="tiles">${numbers.map(([n, label]) => `<div><strong>${n}</strong><span>${label}</span></div>`).join('')}</div>${statusPart(ctx, status, 'Needs human') ? `<h3>Needs your decision</h3>${statusPart(ctx, status, 'Needs human')}` : ''}${statusPart(ctx, status, 'Blocked') ? `<h3>Blocked</h3>${statusPart(ctx, status, 'Blocked')}` : ''}`],
    ['barriers', 'Production barriers', markdownSection(ctx, 'clone/barriers.md')],
    ['plan', 'Build plan', [markdownSection(ctx, 'clone/prd.md'), markdownSection(ctx, 'clone/implications.md')].join('\n')],
    ['features', 'Features and coverage', [markdownSection(ctx, 'inventory/features.md'), `<h3>Screen catalog</h3>${markdownSection(ctx, 'inventory/screens.md')}`, `<h3>Coverage</h3>${markdownSection(ctx, 'inventory/coverage.md')}`].join('\n')],
    ['screens', 'Screens', renderFiles(ctx, listDir(kb, 'screens', (name) => name.endsWith('.md')))],
    ['components', 'Components', renderFiles(ctx, listDir(kb, 'components', (name) => name.endsWith('.md')))],
    ['rules', 'Business rules', listDir(kb, 'rules', (name) => name.endsWith('.md')).map((file) => markdownSection(ctx, file, 0).replace(/^/, `<h3>${escapeHtml(read(kb, file).match(/^#\s+(.*)$/m)?.[1] ?? basename(file, '.md'))}</h3>`)).join('\n')],
    ['parity', 'Parity tests', markdownSection(ctx, 'clone/parity.md')],
    ['flows', 'User flows', renderFiles(ctx, listDir(kb, 'flows', (name) => name.endsWith('.md')))],
    ['data-model', 'Data model', [renderFiles(ctx, listDir(kb, 'data-model/entities', (name) => name.endsWith('.md'))), markdownSection(ctx, 'data-model/permissions.md'), read(kb, 'data-model/types.ts').trim().length > 120 ? `<h3>TypeScript types</h3><pre class="ts"><code>${escapeHtml(read(kb, 'data-model/types.ts'))}</code></pre>` : '', read(kb, 'data-model/erd.mmd').split('\n').length > 4 ? `<h3>Entity relationships (Mermaid)</h3><pre class="mermaid"><code>${escapeHtml(read(kb, 'data-model/erd.mmd'))}</code></pre>` : ''].join('\n')],
    ['api', 'API', markdownSection(ctx, 'api/endpoints.md')],
    ['design', 'Design tokens', markdownSection(ctx, 'design/tokens.md')],
    ['topics', 'Topics', renderFiles(ctx, listDir(kb, 'topics', (name) => name.endsWith('.md')))],
    ['findings', 'Findings', markdownSection(ctx, 'findings.md')],
    ['questions', 'Open questions', markdownSection(ctx, 'questions.md')],
    ['charter', 'Charter', markdownSection(ctx, '00-charter.md')],
    ['glossary', 'Glossary', markdownSection(ctx, 'glossary.md')],
    ['sources', 'Sources', markdownSection(ctx, 'sources.md')],
  ].map(([id, title, html]) => [id, title, section(id, title, html)]);
  const gallery = section('evidence', 'Evidence', `<p class="note">Every claim in this report cites its evidence: <code>[obs EV-###]</code> seen in the product, <code>[net EV-###]</code> captured on the network, <code>[doc SRC-###]</code> public documentation, <code>[inf]</code> an inference with an open question.</p><div class="gallery">${evidenceGallery(ctx)}</div>`);
  const all = [...sections, ['evidence', 'Evidence', gallery]].filter(([, , html]) => html);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(product)}: reverse engineering report</title>
<style>${CSS}</style>
</head>
<body>
<div class="layout">
<nav aria-label="Sections">${all.map(([id, title]) => `<a href="#${id}">${escapeHtml(title)}</a>`).join('')}</nav>
<main>
<header><h1>${escapeHtml(product)}: reverse engineering report</h1><p>${escapeHtml(statusLine)}</p></header>
${all.map(([, , html]) => html).join('\n')}
<footer>Generated by RES (Reverse Engineering SaaS) from the knowledge base. The barrier analysis is research, not legal advice. Rebuild from behavior; do not copy the original product's code, assets or brand.</footer>
</main>
</div>
</body>
</html>
`;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log(USAGE);
    return;
  }
  const outIndex = args.indexOf('--out');
  const out = outIndex >= 0 ? args[outIndex + 1] : null;
  const dir = args.find((arg, index) => !arg.startsWith('--') && (outIndex < 0 || index !== outIndex + 1));
  if (!dir) {
    console.error(USAGE);
    process.exit(2);
  }
  const kb = resolve(dir);
  if (!existsSync(join(kb, 'STATUS.md'))) {
    console.error(`Not a knowledge base (no STATUS.md): ${kb}`);
    process.exit(2);
  }
  const html = buildReport(kb);
  const target = resolve(out || join(kb, 'REPORT.html'));
  writeFileSync(target, html);
  console.log(`Report: ${target} (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(1)} MB)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
