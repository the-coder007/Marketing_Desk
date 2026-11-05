# YMC Diwali Voucher Portal

A static website. No React, no build step, no server. Everything runs in the employee's browser.

```
ymc-diwali-portal/
  standalone/
    ymc-diwali-vouchers.html  <- ONE file with everything inside. Double-click it to test on your computer.
  site/                  <- the same site as separate files. Upload the CONTENTS of this folder to GitHub.
    index.html
    assets/
      app.js  style.css  vault.js  logo.png
      vault-data.js      <- the encrypted vouchers (safe to publish, see "Security")
    .nojekyll
  tools/                 <- stays on your computer. Never upload.
    make-vault.mjs       <- builds vault-data.js from your spreadsheet
    build-standalone.mjs <- rebuilds the one-file version after the vault changes
    employees.sample.csv <- two fake employees showing the column layout
  .gitignore
```

This package already holds the real vault: 139 employees, 140 vouchers, 5,42,800 rupees in total.
Employees sign in with their employee code (for example YMC999) and their PAN as the password.
No expiry date was supplied, so none is shown. To show one, add a `Validity` column (YYYY-MM-DD)
to your CSV and rebuild.

**Test on your own computer:** double-click `standalone/ymc-diwali-vouchers.html` and sign in as any
employee. Use Chrome, Edge, Safari or Firefox.

## 1. Put it on GitHub Pages (about 5 minutes, no commands)

1. Sign in at github.com and click **New repository**. Give it a name such as `ymc-diwali`.
   Choose **Public**. (GitHub Pages is free only for public repositories.)
2. On the new repository page click **uploading an existing file**.
3. Open the `site` folder on your computer. Select everything inside it (the `assets` folder and
   `index.html`) and drag it into the browser window. Check that `index.html` is at the top level
   of the repository, not inside a `site` folder.
4. Click **Commit changes**.
5. Go to **Settings, then Pages**. Under **Build and deployment** choose **Deploy from a branch**,
   branch **main**, folder **/ (root)**, and click **Save**.
6. Wait one to two minutes. The address appears at the top of that page:
   `https://YOUR-USERNAME.github.io/ymc-diwali/`

If the page shows a 404, wait a little longer and refresh. File names are case sensitive.
The `.nojekyll` file is optional. If your computer hides it during upload, nothing breaks.

## 2. Load the real employees and vouchers

1. Install Node.js 18 or newer from nodejs.org (once).
2. Copy `tools/employees.sample.csv` to `tools/employees.csv` and fill in one row per gift card.
   You can paste from Excel and save as CSV. Columns:
   `Amount, Validity, Gift Card Code, Employee Name, Employee Code, PAN`
   Validity is optional. When given it is written like `2027-11-03`. An employee with two
   vouchers has two rows. Names typed in capitals are shown in Title Case.
3. Open a terminal in this folder and run:
   `node tools/make-vault.mjs tools/employees.csv`
   then `node tools/build-standalone.mjs`
4. The first tool checks every row (bad PANs, dates, duplicate gift cards), encrypts the data, proves
   each employee's record opens with their own details, and rewrites `site/assets/vault-data.js`.
   The second rebuilds the one-file version.
5. In GitHub, upload `site/assets/vault-data.js` again over the old one. The site updates in a minute.

Never upload `employees.csv`. It holds PANs and plain voucher codes. The `.gitignore` file stops
it being uploaded if you use Git, but the web uploader does not read `.gitignore`.

The one-file version can also be hosted: upload it to GitHub as `index.html` instead of the `site` folder.

## 3. Security, in plain terms

What protects the vouchers:
- Each employee's vouchers are encrypted (AES-256) with a key made from **employee code and PAN
  together**, stretched with 2,000,000 rounds of PBKDF2. A wrong code and a wrong PAN fail
  identically, so nobody learns which one was right.
- The published files contain no employee codes, PANs, names or voucher codes in readable form.
  Tampering with the encrypted data makes it stop opening.
- The page has a strict Content Security Policy, loads no scripts from other sites, makes no network
  calls, refuses to run inside another site's frame, and tells search engines not to index it.
- After sign-in: codes stay masked until Reveal, hide again after 20 seconds, the page signs out after
  2 minutes idle or 45 seconds in the background, and a watermark with the employee code is drawn
  across the screen so a shared screenshot can be traced.
- Five wrong tries lock the form for 30 seconds, then 60, 120 and so on up to 15 minutes.

What it cannot do, because GitHub Pages is a static host:
- The repository is **public**, so anyone can download the encrypted file and try guesses on their
  own computer, where the lockout does not apply. The only protection against that is the strength of
  the password. A PAN is easy to narrow down: the first five letters follow a pattern, and the
  employee code is usually sequential. Treat the 2,000,000 rounds as a delay, not a guarantee.
  Higher voucher values deserve a stronger second factor or a private host.
- Safer ways to host the same files: a site behind your company login (for example Cloudflare Access),
  GitHub Pages from a private repository on a paid GitHub plan, or your IT team's intranet. Upload the same `site` folder there.
- Send the link and instruct staff to use their own device. Do not post the link in a group chat that
  includes people who are not employees.

Raising the rounds: `node tools/make-vault.mjs tools/employees.csv --rounds 3000000` makes guessing
slower for an attacker but also makes login slower on old phones (in my test, about half a second
per million rounds on a laptop; an older phone can take several times longer).

## 4. Fonts and the logo

The page asks Google Fonts for its fonts after it has drawn. If Google Fonts is blocked on a
company network, the page still works and uses Georgia and system fonts instead. The logo is
`site/assets/logo.png`; replace the file to change it (keep the same name).
