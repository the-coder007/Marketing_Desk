/* Vault v3. Shared by the page (inlined), the prep script and the tests.

   One secret is derived from the employee code AND the employee's PAN together
   (PBKDF2-SHA256, 1,000,000 rounds, global random salt + employee code as salt input).
   From that secret we split two values with domain separation:
     - a lookup tag (so the page can find the record without storing any employee code)
     - an AES-256-GCM key (decrypts the record, tag is bound in as authenticated data)
   The page therefore contains no employee codes, names, PANs or voucher codes.
   A wrong employee code and a wrong PAN fail in exactly the same way. */

function b64ToBytes(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function joinBytes() {
  let n = 0;
  for (let i = 0; i < arguments.length; i++) n += arguments[i].length;
  const out = new Uint8Array(n);
  let o = 0;
  for (let i = 0; i < arguments.length; i++) { out.set(arguments[i], o); o += arguments[i].length; }
  return out;
}

function toHex(bytes) {
  return Array.from(bytes).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
}

async function sha256Bytes(bytes) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

/* Employee codes such as YMC0000: case and spaces are ignored. */
function normCode(code) { return String(code).replace(/\s+/g, '').toUpperCase(); }
/* The password is the employee's PAN. Case and stray spaces or hyphens are ignored. */
function normPassword(password) { return String(password).replace(/[\s-]+/g, '').toUpperCase(); }

async function deriveSecrets(vault, empCode, password) {
  const te = new TextEncoder();
  const salt = joinBytes(b64ToBytes(vault.salt), te.encode('|' + normCode(empCode)));
  const base = await crypto.subtle.importKey('raw', te.encode(normPassword(password)), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: salt, iterations: vault.iter, hash: 'SHA-256' }, base, 256));
  const tagBytes = await sha256Bytes(joinBytes(new Uint8Array([1]), bits));
  const keyBytes = await sha256Bytes(joinBytes(new Uint8Array([2]), bits));
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { tag: toHex(tagBytes).slice(0, 32), key: key };
}

/* Resolves with the employee record. Rejects with the same error for a wrong employee code,
   a wrong PAN or a damaged record. */
async function unlock(vault, empCode, password) {
  const s = await deriveSecrets(vault, empCode, password);
  const entry = vault.e.find(function (x) { return x.t === s.tag; });
  if (!entry) throw new Error('invalid');
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64ToBytes(entry.i), additionalData: new TextEncoder().encode(entry.t) },
    s.key,
    b64ToBytes(entry.c)
  );
  const rec = JSON.parse(new TextDecoder().decode(plain));
  if (normCode(rec.empCode) !== normCode(empCode)) throw new Error('invalid');
  return rec;
}
