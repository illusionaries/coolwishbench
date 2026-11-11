#!/usr/bin/env node
/* Inline every CSS/JS asset into one portable HTML file: dist/starfall.html */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let html = read('index.html');

html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, function (_, href) {
  return '<style>\n' + read(href) + '\n</style>';
});

html = html.replace(/<script src="([^"]+)"><\/script>/g, function (_, src) {
  const code = read(src);
  if (code.includes('</script')) throw new Error('inline </script> found in ' + src);
  return '<script>\n' + code + '\n</script>';
});

const banner =
  '<!--\n  STARFALL · 星坠 — 单文件发行版\n' +
  '  生成于 ' + new Date().toISOString() + '\n' +
  '  零依赖 · 零构建 · 双击即可运行\n-->\n';

html = html.replace('<!doctype html>', '<!doctype html>\n' + banner);

const outDir = path.join(ROOT, 'dist');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'starfall.html');
fs.writeFileSync(out, html);
const kb = (fs.statSync(out).size / 1024).toFixed(1);
console.log('built dist/starfall.html (' + kb + ' KB)');
