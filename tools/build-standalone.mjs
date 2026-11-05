#!/usr/bin/env node
// Builds ONE self-contained HTML file from the site/ folder: standalone/ymc-diwali-vouchers.html
// Run it again every time you rebuild the vault:   node tools/build-standalone.mjs
//
// The file works by double-clicking it, or hosted anywhere (including GitHub Pages as index.html).
// Its Content Security Policy is pinned to the exact hashes of its own code, so nothing else can run.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = path.join(root, 'site') + path.sep;
const read = (p) => readFileSync(site + p, 'utf8');
const once = (s, a, b) => { if (s.split(a).length !== 2) throw new Error('expected exactly one match for: ' + a.slice(0, 50)); return s.replace(a, () => b); };

const css = '\n' + read('assets/style.css') + '\n';
const logo = 'data:image/png;base64,' + readFileSync(site + 'assets/logo.png').toString('base64');
const app = once(read('assets/app.js'), "'assets/logo.png'", JSON.stringify(logo));
const js = '\n' + read('assets/vault-data.js') + '\n' + read('assets/vault.js') + '\n' + app + '\n';
if (/<\/script/i.test(js) || /<\/style/i.test(css)) throw new Error('closing tag found inside inline code');

const hash = (s) => "'sha256-" + createHash('sha256').update(s, 'utf8').digest('base64') + "'";
const csp = "default-src 'none'; script-src " + hash(js) + "; style-src " + hash(css) + " https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'";

const html = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
  '<title>YMC Diwali Vouchers</title>\n<meta name="robots" content="noindex, nofollow, noarchive">\n<meta name="referrer" content="no-referrer">\n<meta name="theme-color" content="#0A1330">\n' +
  '<meta http-equiv="Content-Security-Policy" content="' + csp + '">\n' +
  '<style>' + css + '</style>\n</head>\n<body>\n' +
  '<noscript><p class="noscript-msg">This portal needs JavaScript. Turn it on in your browser settings and reload the page.</p></noscript>\n' +
  '<div id="root"></div>\n<script>' + js + '</script>\n</body>\n</html>\n';

const out = path.join(root, 'standalone', 'ymc-diwali-vouchers.html');
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, html);
console.log('Wrote ' + out + ' (' + Math.round(html.length / 1024) + ' KB)');
