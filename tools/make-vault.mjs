#!/usr/bin/env node
// Builds the encrypted voucher vault for the portal from a spreadsheet saved as CSV.
//
//   node tools/make-vault.mjs tools/employees.csv
//
// Options:
//   --rounds N   key-stretching rounds (default 2000000). More rounds make guessing slower for an
//                attacker and also make login slower on old phones.
//   --out FILE   where to write the vault (default site/assets/vault-data.js)
//
// CSV columns (header names are not case sensitive, order does not matter):
//   Amount, Validity, Gift Card Code, Employee Name, Employee Code, PAN
// Validity is a date written as YYYY-MM-DD. One row per gift card; an employee with two
// vouchers has two rows. Comma, semicolon and tab separated files all work.
//
// Needs Node 18 or newer. Nothing is installed and nothing is sent anywhere.

import { readFileSync, writeFileSync } from 'node:fs';
import { webcrypto, randomInt, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const here = path.dirname(fileURLToPath(import.meta.url));
const siteDir = path.resolve(here, '..', 'site', 'assets');

/* ---------- arguments ---------- */
const args = process.argv.slice(2);
let csvPath = null, rounds = 2000000, outPath = path.join(siteDir, 'vault-data.js');
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--rounds') rounds = Number(args[++i]);
  else if (args[i] === '--out') outPath = path.resolve(args[++i]);
  else if (!csvPath) csvPath = path.resolve(args[i]);
  else fail('Unexpected argument: ' + args[i]);
}
if (!csvPath) fail('Give the CSV file, for example: node tools/make-vault.mjs tools/employees.csv');
if (!Number.isInteger(rounds) || rounds < 100000 || rounds > 20000000) fail('--rounds must be a whole number between 100000 and 20000000.');

function fail(msg) { console.error('\nError: ' + msg + '\n'); process.exit(1); }

/* ---------- the same crypto code the page runs ---------- */
const vaultSrc = readFileSync(path.join(siteDir, 'vault.js'), 'utf8');
const V = new Function(vaultSrc + '\nreturn { bytesToB64, deriveSecrets, unlock, normCode };')();

/* ---------- read the CSV ---------- */
function parseDelimited(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0];
  const delim = first.includes('\t') ? '\t' : (first.includes(';') && !first.includes(',') ? ';' : ',');
  const rows = [];
  let row = [], cur = '', quoted = false;
  const endRow = () => { row.push(cur); cur = ''; if (row.some((x) => x.trim() !== '')) rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else quoted = false; }
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; endRow(); }
    else cur += c;
  }
  if (cur !== '' || row.length) endRow();
  return rows;
}

let text;
try { text = readFileSync(csvPath, 'utf8'); } catch { fail('Cannot read ' + csvPath); }
const table = parseDelimited(text);
if (table.length < 2) fail('The file needs a header row and at least one employee row.');

const HEAD = {
  amount: 'amount', validity: 'validity', expiry: 'validity', validtill: 'validity',
  giftcardcode: 'giftCode', giftcode: 'giftCode', vouchercode: 'giftCode', code: 'giftCode',
  employeename: 'name', name: 'name',
  employeecode: 'empCode', empcode: 'empCode', employeeid: 'empCode', empid: 'empCode',
  pan: 'pan', pannumber: 'pan', pancard: 'pan',
};
const colOf = {};
table[0].forEach((h, i) => { const k = HEAD[h.toLowerCase().replace(/[^a-z0-9]/g, '')]; if (k && !(k in colOf)) colOf[k] = i; });
for (const need of ['amount', 'giftCode', 'name', 'empCode', 'pan']) {
  if (!(need in colOf)) fail('Missing column for "' + need + '". Expected headers: Amount, Validity (optional), Gift Card Code, Employee Name, Employee Code, PAN.');
}

/* Names typed in capitals become Title Case. Initials and short consonant-only tokens (P, M, BS) stay in capitals. */
const niceName = (n) => (n !== n.toUpperCase() ? n : n.split(' ').map((w) => (w.length <= 1 || !/[AEIOUY]/.test(w) ? w : w[0] + w.slice(1).toLowerCase())).join(' '));

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const problems = [];
const people = new Map();
const seenGift = new Map();

table.slice(1).forEach((cells, idx) => {
  const line = idx + 2;
  const get = (k) => (cells[colOf[k]] || '').trim();
  const bad = (msg) => problems.push('Row ' + line + ': ' + msg);

  const amount = Number(get('amount').replace(/[₹,\s]/g, ''));
  const validity = get('validity');
  const giftCode = get('giftCode').replace(/\s+/g, '');
  const name = niceName(get('name').replace(/\s+/g, ' '));
  const empCode = get('empCode').replace(/\s+/g, '').toUpperCase();
  const pan = get('pan').replace(/[\s-]+/g, '').toUpperCase();

  if (!Number.isInteger(amount) || amount <= 0) bad('amount must be a whole number of rupees, found "' + get('amount') + '"');
  if (validity && (!/^\d{4}-\d{2}-\d{2}$/.test(validity) || Number.isNaN(Date.parse(validity + 'T00:00:00Z')))) bad('validity must be empty or look like 2027-11-03, found "' + validity + '"');
  if (!/^[A-Z0-9]{8,24}$/i.test(giftCode)) bad('gift card code looks wrong: "' + giftCode + '"');
  if (!name) bad('employee name is empty');
  if (!/^[A-Z0-9]{3,20}$/.test(empCode)) bad('employee code looks wrong: "' + empCode + '"');
  if (!PAN_RE.test(pan)) bad('PAN must look like ABCDE1234F, found "' + pan + '"');
  if (giftCode) {
    if (seenGift.has(giftCode)) bad('gift card code ' + giftCode + ' is already used on row ' + seenGift.get(giftCode));
    seenGift.set(giftCode, line);
  }
  if (problems.some((p) => p.startsWith('Row ' + line + ':'))) return;

  if (!people.has(empCode)) people.set(empCode, { name, empCode, pan, vouchers: [] });
  const p = people.get(empCode);
  if (p.pan !== pan) bad('employee code ' + empCode + ' appears with two different PANs');
  else if (p.name !== name) bad('employee code ' + empCode + ' appears with two different names ("' + p.name + '" and "' + name + '")');
  else p.vouchers.push(validity ? { amount, validity, code: giftCode } : { amount, code: giftCode });
});

if (problems.length) {
  console.error('\nFound ' + problems.length + ' problem(s) in ' + path.basename(csvPath) + '. Nothing was written.\n');
  problems.slice(0, 40).forEach((p) => console.error('  ' + p));
  if (problems.length > 40) console.error('  ...and ' + (problems.length - 40) + ' more');
  console.error('');
  process.exit(1);
}

/* ---------- encrypt ---------- */
const vault = { v: 3, iter: rounds, salt: V.bytesToB64(randomBytes(16)), e: [] };
const list = [...people.values()];
console.log('Encrypting ' + list.length + ' employee(s) with ' + rounds.toLocaleString('en-IN') + ' rounds each...');

for (const p of list) {
  const s = await V.deriveSecrets(vault, p.empCode, p.pan);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const payload = new TextEncoder().encode(JSON.stringify({ name: p.name, empCode: p.empCode, vouchers: p.vouchers }));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(s.tag) }, s.key, payload));
  vault.e.push({ t: s.tag, i: V.bytesToB64(iv), c: V.bytesToB64(ct) });
}
// Shuffle so the order in the file says nothing about who is who.
for (let i = vault.e.length - 1; i > 0; i--) {
  const j = randomInt(i + 1);
  [vault.e[i], vault.e[j]] = [vault.e[j], vault.e[i]];
}

/* ---------- prove every record opens, and only with its own credentials ---------- */
let verified = 0;
for (const p of list) {
  const rec = await V.unlock(vault, p.empCode, p.pan);
  const total = rec.vouchers.reduce((a, v) => a + v.amount, 0);
  if (rec.empCode !== p.empCode || total !== p.vouchers.reduce((a, v) => a + v.amount, 0)) fail('Self-check failed for ' + p.empCode);
  verified++;
}
if (list.length > 1) {
  let crossed = true;
  try { await V.unlock(vault, list[0].empCode, list[1].pan); } catch { crossed = false; }
  if (crossed) fail('Self-check failed: one employee\'s PAN opened another employee\'s record');
}

writeFileSync(outPath, 'window.YMC_VAULT=' + JSON.stringify(vault) + ';\n');

/* ---------- summary (no PANs printed) ---------- */
console.log('\nWrote ' + outPath + '\n');
console.log('| Employee code | Name | Vouchers | Total |');
console.log('|---|---|---|---|');
let grand = 0;
for (const p of list) {
  const t = p.vouchers.reduce((a, v) => a + v.amount, 0);
  grand += t;
  console.log('| ' + p.empCode + ' | ' + p.name + ' | ' + p.vouchers.length + ' | ₹' + t.toLocaleString('en-IN') + ' |');
}
console.log('\n' + verified + ' employee(s) verified, ' + seenGift.size + ' voucher(s), total ₹' + grand.toLocaleString('en-IN') + '.');
console.log('Next: upload the contents of the site folder to GitHub. Never upload the CSV file.\n');
