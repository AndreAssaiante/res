#!/usr/bin/env node
// Packs a knowledge base into a zip the user can hand to any coding agent.
// Adds BUILD.md (the build brief) to the KB if it is missing. Leaves out
// sandbox/ and log/ (account details) unless --full. No dependencies.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const USAGE = 'Usage: node pack-kb.mjs <kb-dir> [--out <file.zip>] [--full] [--force] [--help]';
const ALWAYS_SKIP = new Set(['.git', 'node_modules', '_templates', '.DS_Store', '.gitkeep']);
const PRIVATE_DIRS = ['sandbox', 'log'];

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// MS-DOS date and time fields used by the zip format.
function dosDateTime(date) {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

// Builds a zip archive (no zip64: under 65,535 entries and 4 GB).
function buildZip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  const stamp = dosDateTime(new Date());
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const deflated = deflateRawSync(data);
    const compress = deflated.length < data.length;
    const body = compress ? deflated : data;
    const method = compress ? 8 : 0;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    parts.push(local, nameBytes, body);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(method, 10);
    header.writeUInt16LE(stamp.time, 12);
    header.writeUInt16LE(stamp.date, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(body.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(nameBytes.length, 28);
    header.writeUInt32LE(offset, 42);
    central.push(header, nameBytes);

    offset += 30 + nameBytes.length + body.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  if (entries.length > 0xffff || offset > 0xffffffff) throw new Error('Knowledge base too large for a zip without zip64.');
  return Buffer.concat([...parts, ...central, end]);
}

function walk(dir, root, skipDirs) {
  const files = [];
  for (const entry of readdirSync(dir).sort()) {
    if (ALWAYS_SKIP.has(entry)) continue;
    const full = join(dir, entry);
    const rel = relative(root, full);
    if (statSync(full).isDirectory()) {
      if (!skipDirs.includes(rel)) files.push(...walk(full, root, skipDirs));
    } else {
      files.push(rel);
    }
  }
  return files;
}

function parseArgs(argv) {
  const options = { full: false, force: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out') options.out = argv[(i += 1)];
    else if (arg === '--full') options.full = true;
    else if (arg === '--force') options.force = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (!arg.startsWith('--') && !options.dir) options.dir = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`${error.message}\n${USAGE}`);
    process.exit(2);
  }
  if (options.help) {
    console.log(USAGE);
    return;
  }
  if (!options.dir) {
    console.error(USAGE);
    process.exit(2);
  }
  const kb = resolve(options.dir);
  if (!existsSync(join(kb, 'STATUS.md'))) {
    console.error(`Not a knowledge base (no STATUS.md): ${kb}`);
    process.exit(2);
  }
  const scripts = dirname(fileURLToPath(import.meta.url));

  const check = spawnSync(process.execPath, [join(scripts, 'check-kb.mjs'), kb], { encoding: 'utf8' });
  if (check.status !== 0 && !options.force) {
    console.error(`${check.stdout}${check.stderr}\ncheck-kb reports errors. Fix them, or pass --force to pack anyway.`);
    process.exit(1);
  }

  const product = readFileSync(join(kb, 'STATUS.md'), 'utf8').match(/^# Status:\s*(.+)$/m)?.[1]?.trim() || basename(kb);
  const date = new Date().toLocaleDateString('en-CA');
  const brief = join(kb, 'BUILD.md');
  if (!existsSync(brief)) {
    const template = readFileSync(join(scripts, '..', 'templates', 'handoff', 'BUILD.md'), 'utf8');
    writeFileSync(brief, template.replaceAll('{{PRODUCT}}', product).replaceAll('{{DATE}}', date));
  }

  const skipped = options.full ? [] : PRIVATE_DIRS.filter((dir) => existsSync(join(kb, dir)));
  const files = walk(kb, kb, skipped);
  const folder = basename(kb);
  const zip = buildZip(files.map((file) => ({ name: `${folder}/${file.split('\\').join('/')}`, data: readFileSync(join(kb, file)) })));
  const out = resolve(options.out || join(dirname(kb), `${folder}-handoff-${date}.zip`));
  writeFileSync(out, zip);

  console.log(`Handoff: ${out}`);
  console.log(`${files.length} files, ${(zip.length / 1024).toFixed(0)} KB.${skipped.length ? ` Left out: ${skipped.map((dir) => `${dir}/`).join(', ')} (use --full to include).` : ''}`);
  if (check.status !== 0) console.log('Packed with --force: check-kb reported errors.');
  console.log('Send this file to the user. Any coding agent can start from BUILD.md inside it.');
}

main();
