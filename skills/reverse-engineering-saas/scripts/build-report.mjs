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
  let card = null;
  const flush = () => {
    if (paragraph.length) out.push(`<p>${renderInline(ctx, paragraph.join(' '), baseDir)}</p>`);
    paragraph = [];
  };
  // A rule or barrier section becomes a card, colored by its severity when it has one.
  const closeCard = () => {
    if (!card) return;
    flush();
    const body = out.splice(card.start).join('\n');
    const severity = body.match(/Severity: <span class="chip (\w+)"/)?.[1];
    out.push(`<article class="card${severity ? ` sev-${severity}` : ''}">${body}</article>`);
    card = null;
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
      const [, id, rest] = heading[2].match(/^([A-Z]+-\d{3})\b\s*(.*)$/) || [];
      if (card && level <= card.level) closeCard();
      const attr = id && !ctx.emitted.has(id) ? ` id="${id}"` : '';
      if (attr) ctx.emitted.add(id);
      if (id && /^(R|BR)-/.test(id)) card = { level, start: out.length };
      const title = id ? `<a class="id" href="#${id}">${id}</a> ${renderInline(ctx, rest, baseDir)}` : renderInline(ctx, heading[2], baseDir);
      out.push(`<h${level}${attr}>${title}</h${level}>`);
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
  closeCard();
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
      const [, titleId, titleRest] = title.match(/^([A-Z]+-\d{3})\b\s*(.*)$/) || [];
      const label = titleId ? `<span class="id">${titleId}</span> ${renderInline(ctx, titleRest, dirname(file))}` : renderInline(ctx, title, dirname(file));
      return `<details${attr}><summary>${label}</summary><div class="file">${body}</div></details>`;
    })
    .join('\n');
}

function section(id, number, title, lede, html) {
  const eyebrow = String(number).padStart(2, '0');
  return `<section id="${id}"><p class="eyebrow">${eyebrow}</p><h2>${escapeHtml(title)}</h2>${lede ? `<p class="lede">${escapeHtml(lede)}</p>` : ''}${html}</section>`;
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
:root{--bg:#f6f8fa;--surface:#ffffff;--fg:#14202b;--muted:#5c6a77;--line:#e1e6eb;--soft:#f1f4f7;--accent:#1f5f8b;--accent-soft:#e5eef6;
--hero:#0f1a24;--hero-fg:#eef3f7;--hero-muted:#9fb0bf;
--red:#b0413e;--amber:#9a650f;--blue:#1f6aa5;--green:#2e7d5b;--gray:#5c6a77;
--red-bg:#f8e3e2;--amber-bg:#fbf0dc;--blue-bg:#e3eef8;--green-bg:#e2f2e9;--gray-bg:#eceff2;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#0c1116;--surface:#131b23;--fg:#e4eaf0;--muted:#98a6b3;--line:#25313c;--soft:#18222c;--accent:#7fb3d9;--accent-soft:#182a39;
--hero:#121e2a;--hero-fg:#eef3f7;--hero-muted:#93a5b5;
--red:#e48a86;--amber:#e2b25a;--blue:#8cc0ea;--green:#6cc59a;--gray:#98a6b3;
--red-bg:#3a1d1c;--amber-bg:#33280f;--blue-bg:#172a3a;--green-bg:#173327;--gray-bg:#222c35;color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased}
.hero{background:var(--hero);color:var(--hero-fg);border-bottom:1px solid var(--line)}
.hero-inner{max-width:1240px;margin:0 auto;padding:52px max(16px,env(safe-area-inset-right)) 40px max(16px,env(safe-area-inset-left))}
.kicker{font:600 12.5px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--hero-muted);margin:0 0 16px}
.hero h1{font-size:clamp(34px,5vw,52px);line-height:1.05;letter-spacing:-.02em;margin:0 0 8px}
.subtitle{font-size:19px;color:var(--hero-muted);margin:0 0 22px;max-width:62ch}
.meta{display:flex;flex-wrap:wrap;gap:8px}.meta span{border:1px solid rgba(255,255,255,.2);border-radius:999px;padding:3px 12px;font-size:13.5px}
.layout{display:grid;grid-template-columns:220px minmax(0,1fr);gap:48px;max-width:1240px;margin:0 auto;padding:32px max(16px,env(safe-area-inset-right)) 0 max(16px,env(safe-area-inset-left))}
nav{position:sticky;top:20px;align-self:start;font-size:14px;max-height:calc(100vh - 40px);overflow:auto}
nav a{display:flex;gap:10px;color:var(--muted);text-decoration:none;padding:5px 8px;border-radius:6px}nav a:hover{background:var(--surface);color:var(--fg)}
nav a b{font:500 12px/1.9 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--accent);min-width:18px}
main{min-width:0;padding-bottom:40px}
.notice{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.notice>div{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:16px 18px}
.notice h3{margin:0 0 6px;font-size:15px}.notice p{margin:0;color:var(--muted);font-size:14.5px}
.notice .agent{border:1px dashed var(--accent)}.notice .agent h3{color:var(--accent)}
section{margin:60px 0 0;scroll-margin-top:16px}
.eyebrow{font:600 13px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--accent);margin:0 0 8px}
h2{font-size:28px;line-height:1.2;letter-spacing:-.01em;margin:0 0 6px}
.lede{color:var(--muted);font-size:17px;margin:0 0 22px;max-width:68ch}
h3{font-size:19px;line-height:1.3;margin:30px 0 10px}h4{font-size:16.5px;margin:18px 0 8px}h5,h6{font-size:15px;margin:14px 0 6px}
p,li{max-width:80ch}ul,ol{padding-left:22px}li{margin:3px 0}
a{color:var(--accent);text-underline-offset:2px}
code{font:13.5px ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--soft);padding:1px 5px;border-radius:4px;overflow-wrap:anywhere}
pre{background:var(--surface);border:1px solid var(--line);padding:14px 16px;border-radius:10px;overflow-x:auto}pre code{background:none;padding:0}
.id{display:inline-block;font:600 12.5px/1.65 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--accent);background:var(--accent-soft);border-radius:6px;padding:0 7px;text-decoration:none;vertical-align:2px;margin-right:4px}
.table{overflow-x:auto;margin:14px 0;background:var(--surface);border:1px solid var(--line);border-radius:10px}
table{border-collapse:collapse;width:100%;font-size:14.5px}
th{font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);text-align:left;padding:10px 12px;border-bottom:1px solid var(--line);background:var(--soft)}
td{text-align:left;vertical-align:top;padding:9px 12px;border-bottom:1px solid var(--line)}tr:last-child td{border-bottom:0}
img{max-width:100%;height:auto;border:1px solid var(--line);border-radius:8px;margin:10px 0;display:block}
.card{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:2px 20px 10px;margin:12px 0;box-shadow:0 1px 2px rgba(15,26,36,.04)}
.card>h3:first-child,.card>h4:first-child,.card>h5:first-child{margin-top:16px}
.card.sev-red{border-left:4px solid var(--red)}.card.sev-amber{border-left:4px solid var(--amber)}.card.sev-blue{border-left:4px solid var(--blue)}.card.sev-gray,.card.sev-green{border-left:4px solid var(--gray)}
.panel{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:4px 22px;margin:0 0 14px}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin:14px 0}
.tiles div{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
.tiles strong{display:block;font-size:30px;line-height:1.1;letter-spacing:-.02em;font-variant-numeric:tabular-nums;color:var(--accent)}.tiles span{color:var(--muted);font-size:13.5px}
.coverage{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:14px 18px;margin:0 0 14px}
.coverage h3{margin:0 0 10px;font-size:15px}.bar{display:flex;height:12px;border-radius:999px;overflow:hidden;background:var(--soft)}
.seg.green,.dot.green{background:var(--green)}.seg.blue,.dot.blue{background:var(--blue)}.seg.amber,.dot.amber{background:var(--amber)}.seg.gray,.dot.gray{background:var(--gray-bg)}
.legend{display:flex;flex-wrap:wrap;gap:16px;color:var(--muted);font-size:13.5px;margin:10px 0 0}.dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px;border:1px solid var(--line)}
.decide{background:var(--amber-bg);border:1px solid var(--line);border-left:4px solid var(--amber);border-radius:12px;padding:4px 22px;margin:14px 0}
.decide h3{margin-top:14px;font-size:16px}
.chip{display:inline-block;font-size:12.5px;font-weight:600;padding:1px 9px;border-radius:999px;white-space:nowrap}
.chip.red{color:var(--red);background:var(--red-bg)}.chip.amber{color:var(--amber);background:var(--amber-bg)}.chip.blue{color:var(--blue);background:var(--blue-bg)}.chip.green{color:var(--green);background:var(--green-bg)}.chip.gray{color:var(--gray);background:var(--gray-bg)}
.swatch{display:inline-block;width:14px;height:14px;border-radius:3px;border:1px solid var(--line);vertical-align:-2px;margin-right:6px}
details{background:var(--surface);border:1px solid var(--line);border-radius:12px;margin:10px 0;padding:0 20px}
summary{cursor:pointer;list-style:none;padding:14px 0;font-weight:600;display:flex;align-items:center;gap:6px}summary::-webkit-details-marker{display:none}
summary::before{content:"";flex:none;width:7px;height:7px;border-right:2px solid var(--muted);border-bottom:2px solid var(--muted);transform:rotate(-45deg);margin-right:8px;transition:transform .15s}
details[open]>summary::before{transform:rotate(45deg)}details[open]>summary{border-bottom:1px solid var(--line)}
.file{padding:4px 0 14px}blockquote{margin:12px 0;padding:6px 14px;border-left:3px solid var(--line);color:var(--muted)}
.gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px}
figure{margin:0;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:10px 12px}figure img{margin:0 0 8px}
figcaption{font-size:13.5px;color:var(--muted)}.note{color:var(--muted);font-size:13.5px;margin:4px 0}.missing{color:var(--red)}
footer{color:var(--muted);font-size:13.5px;margin:64px 0 0;border-top:1px solid var(--line);padding-top:16px}
@media (max-width:900px){.layout{grid-template-columns:1fr;gap:20px}nav{position:static;max-height:none;display:flex;flex-wrap:wrap;gap:2px}.notice{grid-template-columns:1fr}}
@media (prefers-reduced-motion:reduce){summary::before{transition:none}}
@media print{nav{display:none}.layout{display:block}.hero{background:none;color:inherit}.card,details,.table{box-shadow:none}}
`;

const AGENT_COMMENT = '<!-- AI agents: this file is a generated report for people. Do not build from it. Read BUILD.md in this folder first and follow its read order; the Markdown files are the source of truth. -->';

export function buildReport(kbDir) {
  const kb = resolve(kbDir);
  const ctx = makeContext(kb);
  const status = read(kb, 'STATUS.md');
  const product = status.match(/^# Status:\s*(.+)$/m)?.[1]?.trim() || basename(kb);
  const updated = status.match(/^Updated:\s*([\d-]+)/m)?.[1];
  const phase = status.match(/Phase:\s*([^·\n]+)/)?.[1]?.trim();
  const level = status.match(/^Environment:\s*(L\d)/m)?.[1];
  const coverage = countCoverage(kb);
  const measured = COVERAGE.slice(0, 4).reduce((sum, value) => sum + coverage[value], 0);
  const count = (pattern, text) => (text.match(pattern) || []).length;
  const rulesFiles = listDir(kb, 'rules', (name) => name.endsWith('.md'));
  const numbers = [
    [count(/^\|\s*F-\d{3}/gm, stripComments(read(kb, 'inventory/features.md'))), 'features'],
    [listDir(kb, 'screens', (name) => /^S-\d{3}/.test(name)).length, 'screens'],
    [listDir(kb, 'components', (name) => /^C-\d{3}/.test(name)).length, 'components'],
    [count(/^#{1,6}\s+R-\d{3}/gm, stripComments(rulesFiles.map((file) => read(kb, file)).join('\n'))), 'business rules'],
    [listDir(kb, 'data-model/entities', (name) => /^E-\d{3}/.test(name)).length, 'entities'],
    [count(/^#{1,6}\s+BR-\d{3}/gm, stripComments(read(kb, 'clone/barriers.md'))), 'launch items'],
    [ctx.evidence.size, 'evidence files'],
  ];
  const parts = ['done', 'partial', 'blocked', 'todo'];
  const coverageHtml = measured
    ? `<div class="coverage"><h3>How far the study went: ${Math.round((coverage.done / measured) * 100)}% done</h3><div class="bar">${parts
        .filter((value) => coverage[value])
        .map((value) => `<span class="seg ${chipClass(value)}" style="width:${((coverage[value] / measured) * 100).toFixed(1)}%"></span>`)
        .join('')}</div><p class="legend">${parts.map((value) => `<span><i class="dot ${chipClass(value)}"></i>${coverage[value]} ${value}</span>`).join('')}</p></div>`
    : '';
  const summary = statusPart(ctx, status, 'Summary');
  const decide = statusPart(ctx, status, 'Needs human');
  const blocked = statusPart(ctx, status, 'Blocked');
  const about = [
    ['00-charter.md', 'Charter'],
    ['glossary.md', 'Glossary'],
    ['sources.md', 'Sources'],
  ]
    .map(([file, title]) => (read(kb, file) ? `<h3>${title}</h3>${markdownSection(ctx, file, 2)}` : ''))
    .join('\n');

  // Order: understand the product, then how to build it, then what to prepare before launch.
  const sections = [
    ['summary', 'Overview', 'What was studied, how far the study went, and what needs your decision.',
      `${summary ? `<div class="panel">${summary}</div>` : ''}<div class="tiles">${numbers.map(([n, label]) => `<div><strong>${n}</strong><span>${label}</span></div>`).join('')}</div>${coverageHtml}${decide && !/^\s*<ul><li>None\.?<\/li><\/ul>\s*$/.test(decide) ? `<div class="decide"><h3>Needs your decision</h3>${decide}</div>` : ''}${blocked && !/^\s*<ul><li>None\.?<\/li><\/ul>\s*$/.test(blocked) ? `<h3>Blocked</h3>${blocked}` : ''}`],
    ['features', 'What the product does', 'Every feature found, its plan and priority, the screens it lives on, and how deeply each one was studied.',
      [markdownSection(ctx, 'inventory/features.md'), read(kb, 'inventory/screens.md') ? `<h3>Screen catalog</h3>${markdownSection(ctx, 'inventory/screens.md', 2)}` : '', `<h3>Coverage by feature</h3>${markdownSection(ctx, 'inventory/coverage.md', 2)}`].join('\n')],
    ['screens', 'Screens', 'Each screen: its layout, states, interactions, keyboard behavior and text. Open one to read it.',
      renderFiles(ctx, listDir(kb, 'screens', (name) => name.endsWith('.md')))],
    ['components', 'Components', 'The reusable pieces of the interface and their states.',
      renderFiles(ctx, listDir(kb, 'components', (name) => name.endsWith('.md')))],
    ['flows', 'User flows', 'Step by step journeys through the product.',
      renderFiles(ctx, listDir(kb, 'flows', (name) => name.endsWith('.md')))],
    ['rules', 'How it behaves', 'Business rules observed in the product, each with its evidence. They become the acceptance tests of the new product.',
      rulesFiles.map((file) => `<h3>${escapeHtml(read(kb, file).match(/^#\s+(.*)$/m)?.[1] ?? basename(file, '.md'))}</h3>${markdownSection(ctx, file, 1)}`).join('\n')],
    ['data-model', 'Data model', 'The entities behind the screens: fields, types, relations and who may do what.',
      [renderFiles(ctx, listDir(kb, 'data-model/entities', (name) => name.endsWith('.md'))), read(kb, 'data-model/permissions.md') ? `<h3>Permissions</h3>${markdownSection(ctx, 'data-model/permissions.md', 2)}` : '', read(kb, 'data-model/types.ts').trim().length > 120 ? `<h3>TypeScript types</h3><pre class="ts"><code>${escapeHtml(read(kb, 'data-model/types.ts'))}</code></pre>` : '', read(kb, 'data-model/erd.mmd').split('\n').length > 4 ? `<h3>Entity relationships (Mermaid)</h3><pre class="mermaid"><code>${escapeHtml(read(kb, 'data-model/erd.mmd'))}</code></pre>` : ''].join('\n')],
    ['api', 'API', 'What the web app asks its server for each action, with the shape of the data and no real values.',
      markdownSection(ctx, 'api/endpoints.md')],
    ['design', 'Design system', 'Colors, typography, spacing, radius, shadow and motion as the product uses them.',
      markdownSection(ctx, 'design/tokens.md')],
    ['plan', 'Build plan', 'What to build and in what order, the acceptance tests, and what to copy, avoid and improve.',
      [markdownSection(ctx, 'clone/prd.md'), read(kb, 'clone/parity.md') ? `<h3>Acceptance tests</h3>${markdownSection(ctx, 'clone/parity.md', 2)}` : '', markdownSection(ctx, 'clone/implications.md')].join('\n')],
    ['barriers', 'Before you launch', 'Approvals, licenses and certifications to start early, and what a new product cannot copy. Building can start now; these decide when you can sell.',
      markdownSection(ctx, 'clone/barriers.md')],
    ['topics', 'Cross-cutting topics', 'Behavior that spans many screens: search, notifications, permissions and more.',
      renderFiles(ctx, listDir(kb, 'topics', (name) => name.endsWith('.md')))],
    ['findings', 'Findings', 'Problems and strengths noticed in the product during the study.', markdownSection(ctx, 'findings.md')],
    ['questions', 'Open questions', 'What the study could not confirm, and how to answer it.', markdownSection(ctx, 'questions.md')],
    ['about', 'About this study', 'The goal, scope and terms of the study, the vocabulary of the product, and every public source used.', about],
  ];
  const evidence = evidenceGallery(ctx);
  sections.push(['evidence', 'Evidence', 'Every statement cites its evidence: [obs EV-###] seen in the product, [net EV-###] captured on the network, [doc SRC-###] public documentation, [inf] an inference with an open question.',
    evidence ? `<div class="gallery">${evidence}</div>` : '']);
  const present = sections.filter(([, , , html]) => html.replace(/<[^>]+>/g, '').trim());
  const rendered = present.map(([id, title, lede, html], index) => section(id, index + 1, title, lede, html));

  const meta = [updated && `Updated ${updated}`, level && `Environment ${level}`, phase && `Phase ${phase}`].filter(Boolean);
  return `<!doctype html>
${AGENT_COMMENT}
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Reverse engineering report of ${escapeHtml(product)}, generated by RES for people. Coding agents: read BUILD.md in this folder.">
<title>${escapeHtml(product)}: reverse engineering report</title>
<style>${CSS}</style>
</head>
<body>
<header class="hero"><div class="hero-inner">
<p class="kicker">Reverse engineering report · RES</p>
<h1>${escapeHtml(product)}</h1>
<p class="subtitle">How ${escapeHtml(product)} works, how to rebuild it, and what to prepare before launch.</p>
<div class="meta">${meta.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}</div>
</div></header>
<div class="layout">
<nav aria-label="Sections">${present.map(([id, title], index) => `<a href="#${id}"><b>${String(index + 1).padStart(2, '0')}</b>${escapeHtml(title)}</a>`).join('')}</nav>
<main>
<div class="notice">
<div><h3>Reading this as a person</h3><p>This page is the readable report of the study. Start with the overview, then read in order: what the product does, how it looks and behaves, how to build it, and what to prepare before launch.</p></div>
<div class="agent"><h3>If you are an AI agent</h3><p>Do not build from this page: it is generated for people. Open <code>BUILD.md</code> in this folder and follow its read order. The Markdown files next to it are the source of truth.</p></div>
</div>
${rendered.join('\n')}
<footer>Generated by RES (Reverse Engineering SaaS) from the knowledge base in this folder. The launch analysis is research, not legal advice. Rebuild from behavior; do not copy the original product's code, assets or brand.</footer>
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
