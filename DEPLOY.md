# Deployment plan — alexandriarose.com (or chosen domain)

Static site in this folder → GitHub Pages → custom domain.

---

## 1. Create the GitHub account (interactive — they do this)

Go to https://github.com/signup. Suggested username: `alexandriarose` (or whatever's available).
- Use a long-term personal email
- Turn on 2FA immediately after signup
- Pick the free plan

## 2. Create the repo + push files

**Decision:** user page (`<username>.github.io`) vs project page.
- **User page** (recommended for a custom domain): repo must be named exactly `<username>.github.io`. Site serves at root, no path.
- **Project page:** any repo name, site serves at `<username>.github.io/<repo>/`.

Once the account exists, from `~/Software/lexSite/`:

```bash
# auth as them in this shell (opens browser to OAuth)
gh auth login

# init local repo if not already
git init -b main
git add .
git commit -m "Initial site"

# create the GitHub repo and push (replace <username>)
gh repo create <username>/<username>.github.io --public --source=. --push
```

## 3. Enable GitHub Pages

In the new repo on github.com:
- **Settings → Pages**
- Source: **Deploy from a branch**
- Branch: `main`, folder: `/ (root)`
- Save

Within ~1 minute the site is live at `https://<username>.github.io/`. The `.nojekyll` file in the repo tells Pages to serve as-is (no Jekyll processing).

## 4. Domain — buy + point DNS

If they don't own a domain yet, **Cloudflare Registrar** is the recommended registrar (at-cost pricing, no upsells, free DNS, free WHOIS privacy). Alternatives: Namecheap, Porkbun, Google → Squarespace Domains.

Once they own `<domain.com>`, set these DNS records at the registrar:

**Apex domain (`domain.com`)** — GitHub Pages IPs (these are stable; verify at https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site#configuring-an-apex-domain):

```
A    @    185.199.108.153
A    @    185.199.109.153
A    @    185.199.110.153
A    @    185.199.111.153
AAAA @    2606:50c0:8000::153
AAAA @    2606:50c0:8001::153
AAAA @    2606:50c0:8002::153
AAAA @    2606:50c0:8003::153
```

**`www` subdomain:**
```
CNAME www <username>.github.io.
```

DNS propagation: usually 5–60 min, sometimes longer.

## 5. Connect the domain in GitHub Pages

- **Repo → Settings → Pages → Custom domain** → enter `domain.com` → Save
- GitHub writes a `CNAME` file into the repo (auto-commit)
- Wait for "DNS check successful" — can take a few minutes
- Tick **Enforce HTTPS** once it becomes available (cert issuance is automatic, takes up to ~24h after DNS propagates)

## Post-launch checklist

- [ ] Visit `https://domain.com/` — loads home
- [ ] Visit `https://www.domain.com/` — redirects to apex (or vice versa, GH handles this)
- [ ] `https://domain.com/about` — renders
- [ ] `https://domain.com/portfolio` — renders
- [ ] HTTPS padlock is green
- [ ] Replace placeholder content:
  - [ ] `hello@alexandriarose.com` everywhere
  - [ ] `@alexandriarose` Instagram handle
  - [ ] Lower East Side / studio address
  - [ ] Swap `<div class="ph" data-label="...">` blocks for `<img src="..." alt="...">`
  - [ ] Real training entries (currently placeholder: Vidal Sassoon, B&b)
  - [ ] Real press section (currently placeholder: Document, The Cut, Vogue) or remove
  - [ ] Real testimonials or remove that section

## Wiring up Square Appointments

The booking flow is scaffolded but pointed at a placeholder URL. To go live, two things need to happen:

### 1. Replace the placeholder booking URL

The string `https://book.squareup.com/PLACEHOLDER-MERCHANT-ID` appears in:

- `booking.js` (constant `SQUARE_BOOKING_URL` near the top — single source of truth for the cart's "Book these services" button)
- `index.html`, `about.html`, `portfolio.html`, `services.html`, `new-clients.html`, `faq.html` (the "Book online →" button in each page's CTA section)

Once Alexandria's Square Appointments account exists and online booking is enabled, find/replace across the repo:

```bash
# from ~/Software/lexSite/
grep -rl PLACEHOLDER-MERCHANT-ID . | xargs sed -i '' 's|https://book.squareup.com/PLACEHOLDER-MERCHANT-ID|<REAL-SQUARE-URL>|g'
```

### 2. Wire each tier to its Square service ID

Each `+` button on the services page has a `data-square-id="[square-id]"` placeholder. Once we know the real Square service IDs (one per tier they offer), swap each placeholder for the real ID. The 8 tiers that need IDs:

- `haircut-basic` (Haircut · 1 hour · $150)
- `haircut-avant` (Avant-garde · 1.5 hours · $175)
- `haircut-curly-long` (Curly cut / Long to short · 2 hours · $225)
- `color-basic` (Basic color · 2 hours · $350)
- `color-advanced` (Advanced color · 3–4 hours · $525–700)
- `addon-gloss` (Gloss / toner · 25 min · $175)
- `addon-hot-tool` (Hot tool styling · 30 min · $35)
- `addon-conditioning` (Deep conditioning / shine · 15 min · $40)

### 3. Make pre-selection actually work

Once we know Square's URL format for pre-selecting multiple services (it varies by Square product version), update the `bookHref()` function in `booking.js`. The selected items' Square IDs are already collected in `state.items[].squareId` — we just need to know how Square wants them in the URL.

Test by selecting a few services in the cart and clicking "Book these services →" — the Square page should open with the right services already chosen.

---

## Updating the site after launch

```bash
# from ~/Software/lexSite/
git add .
git commit -m "<what changed>"
git push
```

Pages rebuilds and redeploys within ~30 seconds.
