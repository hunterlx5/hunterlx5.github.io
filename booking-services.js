/**
 * Live, integrated booking for services.html.
 * Pulls the catalog from Square (via the Worker), groups it into the site's
 * four editorial categories, and runs the whole checkout INSIDE the corner
 * widget (cart → time → details → deposit) with a 20% deposit.
 * ?sandbox=1 → Square Sandbox (test cards, $0 charge, no real booking).
 */
(function () {
  "use strict";

  var WORKER = "https://lexsite-booking.alexandria-rose.workers.dev";
  // ?sandbox=1 → Square Sandbox: test cards, $0 charges. Uses sandbox app/location
  // for the card form and tells the Worker to charge in sandbox (no real booking).
  var SANDBOX = /[?&]sandbox=1/.test(location.search);
  var SQUARE_APP_ID = SANDBOX ? "sandbox-sq0idb-4Vk0YR9tvpmsZm0a4cX5nQ" : "sq0idp-j_QgKxaA0Q9Wnejvl3l48Q";
  var SQUARE_LOCATION_ID = SANDBOX ? "LCN47BYWKAVT1" : "L1Y3ZYDQVQJNZ";
  // The Web Payments SDK is environment-specific: a sandbox app ID only works
  // with the sandbox build, and vice-versa.
  var SQUARE_SDK = SANDBOX ? "https://sandbox.web.squarecdn.com/v1/square.js" : "https://web.squarecdn.com/v1/square.js";
  var TZ = "America/Los_Angeles";
  // Sandbox has no real availability, so fall back to synthetic days automatically.
  var DEMO = /[?&]demo=1/.test(location.search) || SANDBOX; // fake days, never calls Square

  // Synthetic availability for UI exploration only (10am–3:30pm PT across ~8 days).
  function demoSlots() {
    var out = [], base = new Date(); base.setUTCHours(0, 0, 0, 0);
    [1, 3, 4, 6, 8, 10, 11, 13].forEach(function (off) {
      var day = new Date(base.getTime() + off * 864e5);
      [17, 18, 19, 20, 21, 22].forEach(function (h) {
        [0, 30].forEach(function (m) {
          out.push({ start_at: new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h, m)).toISOString() });
        });
      });
    });
    return out;
  }

  // The catalog is grouped into these four editorial categories by matching on
  // the Square service name (the names carry no numeric prefix). Order matters:
  // categorize() returns the FIRST matching category, so more specific tests
  // (Extensions, Color) come before the Haircuts fallback.
  var CATEGORIES = [
    { key: "haircuts",   label: "Haircuts",           img: "cut · 4:5" },
    { key: "color",      label: "Color",              img: "color · application detail" },
    { key: "extensions", label: "Extensions",         img: "extensions · install" },
    { key: "styling",    label: "Styling &amp; Consults", img: "styling · consult" },
    { key: "more",       label: "More Services",      img: "à la carte" },
  ];
  function categorize(name) {
    if (/\bIBE\b|extension/i.test(name)) return "extensions";
    if (/highl|bleach|tone|root|gloss|glaze|balayage|colou?r/i.test(name)) return "color";
    if (/consult|blow.?dry\s*style|styling/i.test(name)) return "styling";
    if (/hair\s*cut|\bcut\b|clean\s*up|trim|bang|fringe/i.test(name)) return "haircuts";
    // Unrecognized names land in a generic bucket instead of being silently
    // mislabeled under Haircuts. The "more" card only renders if it has items.
    return "more";
  }

  // Static "not yet bookable online" cards, appended after the live catalog.
  var COMING_SOON_HTML =
    '<article class="service-card"><div class="service-image"><div class="ph" data-label="bridal · event"></div></div>' +
    '<div class="service-content"><p class="service-no">Coming soon</p>' +
    '<h2 class="service-title">Bridal &amp; <em>event</em></h2><p class="service-price">By inquiry</p></div></article>' +
    '<article class="service-card"><div class="service-image"><div class="ph" data-label="editorial · campaign"></div></div>' +
    '<div class="service-content"><p class="service-no">Coming soon</p>' +
    '<h2 class="service-title">Editorial &amp; <em>campaign</em></h2><p class="service-price">By inquiry</p></div></article>';

  var CART_KEY = "ar-cart-sf"; // persisted cart (list of service_variation_ids)

  var state = {
    services: [], cart: [],
    slots: [], byDate: {}, availKeys: [], selectedKey: null,
    viewY: null, viewM: null, // displayed calendar month
    slot: null,
    customer: null, payments: null, card: null,
  };

  function el(s, r) { return (r || document).querySelector(s); }
  function money(cents) { return "$" + (cents / 100).toFixed(2).replace(/\.00$/, ""); }
  // Clean a Square name for display: drop any numeric prefix and fix the
  // "Highlites" misspelling that lives in the Square catalog.
  function displayName(n) {
    return n.replace(/^\d+(\.\d+)?[a-z]?\s+/i, "")
            .replace(/Highlites/gi, "Highlights")
            .replace(/Highlite/gi, "Highlight")
            .trim() || n;
  }
  function fmtDur(min) { if (min < 60) return min + " min"; var h = Math.floor(min / 60), m = min % 60; return m === 0 ? h + " hr" : h + " hr " + m + " min"; }
  function ptDateKey(iso) {
    var parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso));
    var o = {}; parts.forEach(function (p) { o[p.type] = p.value; });
    return o.year + "-" + o.month + "-" + o.day;
  }
  function fmtDateLong(iso) { return new Date(iso).toLocaleDateString("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric" }); }
  function fmtTime(iso) { return new Date(iso).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }); }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function ptHour(iso) { return Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hour12: false }).format(new Date(iso))) % 24; }
  // Correct Pacific abbreviation for the given instant (PST vs PDT) — never hardcode.
  function tzAbbrev(iso) {
    try {
      var parts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "short" }).formatToParts(new Date(iso));
      var t = parts.find(function (p) { return p.type === "timeZoneName"; });
      return t ? t.value : "PT";
    } catch (e) { return "PT"; }
  }

  /* ---------- cart persistence ---------- */
  function saveCart() {
    try { localStorage.setItem(CART_KEY, JSON.stringify(state.cart.map(function (s) { return s.service_variation_id; }))); } catch (e) {}
  }
  function restoreCart() {
    try {
      var ids = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
      state.cart = ids.map(function (id) { return findSvc(id); }).filter(Boolean);
    } catch (e) { state.cart = []; }
  }

  /* ---------- catalog ---------- */

  function loadServices() {
    fetch(WORKER + "/api/services")
      // fetch only rejects on network failure; treat a non-2xx (e.g. worker 500)
      // as an error too, so a backend hiccup shows a message instead of an empty page.
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (d) { state.services = d.services || []; restoreCart(); renderCatalog(); })
      .catch(function () { el("#bk-catalog").innerHTML = '<p class="bk-loading" style="padding:2rem 0">Couldn’t load services. Please refresh or email alexandria@alexandriarose.org.</p>'; });
  }

  function renderCatalog() {
    var wrap = el("#bk-catalog");
    wrap.innerHTML = "";
    var num = 0;
    CATEGORIES.forEach(function (cat) {
      var items = state.services.filter(function (s) { return categorize(s.name) === cat.key; });
      if (!items.length) return;
      num++;
      var no = "No. " + (num < 10 ? "0" + num : num);
      var card = document.createElement("article");
      card.className = "service-card";
      var tiers = items.map(function (svc) {
        return '<li class="service-tier">' +
          '<span class="tier-name">' + escapeHtml(displayName(svc.name)) + "</span>" +
          '<span class="tier-duration">' + fmtDur(svc.duration_minutes) + "</span>" +
          '<span class="tier-price">' + money(svc.price_cents) + "</span>" +
          '<button type="button" class="tier-add" data-id="' + escapeHtml(svc.service_variation_id) + '" aria-label="Add ' + escapeHtml(displayName(svc.name)) + '">+</button>' +
          "</li>";
      }).join("");
      card.innerHTML =
        '<div class="service-image"><div class="ph" data-label="' + escapeHtml(cat.img) + '"></div></div>' +
        '<div class="service-content">' +
          '<p class="service-no">' + no + "</p>" +
          '<h2 class="service-title"><em>' + cat.label + "</em></h2>" +
          '<ul class="service-tiers">' + tiers + "</ul>" +
        "</div>";
      wrap.appendChild(card);
    });
    wrap.insertAdjacentHTML("beforeend", COMING_SOON_HTML);
    wrap.querySelectorAll(".tier-add").forEach(function (btn) { btn.addEventListener("click", function () { toggle(btn.dataset.id); }); });
    renderCart();
  }

  /* ---------- cart ---------- */

  function findSvc(id) { return state.services.find(function (s) { return s.service_variation_id === id; }); }
  function inCart(id) { return state.cart.some(function (s) { return s.service_variation_id === id; }); }
  function toggle(id) {
    if (inCart(id)) state.cart = state.cart.filter(function (s) { return s.service_variation_id !== id; });
    else { var svc = findSvc(id); if (svc) state.cart.push(svc); }
    saveCart();
    renderCart();
  }
  function cartTotals() {
    return state.cart.reduce(function (t, s) { t.dur += s.duration_minutes; t.price += s.price_cents; t.deposit += s.deposit_cents; return t; }, { dur: 0, price: 0, deposit: 0 });
  }
  function renderCart() {
    var n = state.cart.length;
    el(".booking-bar").classList.toggle("is-active", n > 0);
    // Emptied cart → reset to the expanded state for next time it appears.
    if (n === 0) unminimize();
    el(".booking-bar-list").innerHTML = state.cart.map(function (s) {
      return '<li class="booking-bar-item" data-id="' + escapeHtml(s.service_variation_id) + '">' +
        '<span class="name">' + escapeHtml(displayName(s.name)) + '<span class="meta">' + fmtDur(s.duration_minutes) + "</span></span>" +
        '<span class="price">' + money(s.price_cents) + "</span>" +
        '<button type="button" class="remove" aria-label="Remove">−</button></li>';
    }).join("");
    var t = cartTotals();
    el(".booking-bar-totals .time").textContent = n ? fmtDur(t.dur) : "—";
    el(".booking-bar-totals .price").textContent = n ? money(t.price) : "—";
    el("#bb-min-count").textContent = n + (n === 1 ? " service" : " services");
    el("#bb-min-total").textContent = n ? money(t.price) : "—";
    document.querySelectorAll(".tier-add").forEach(function (b) {
      var on = inCart(b.dataset.id);
      var tier = b.closest(".service-tier");
      if (tier) tier.classList.toggle("is-selected", on);
      b.textContent = on ? "−" : "+";
    });
  }

  /* ---------- minimize / expand the cart ---------- */

  function minimize() {
    el(".booking-bar").classList.add("is-min");
    el("#bb-cart").hidden = true;
    el("#bb-min").hidden = false;
  }
  function unminimize() {
    el(".booking-bar").classList.remove("is-min");
    el("#bb-min").hidden = true;
    if (el("#bb-checkout").hidden) el("#bb-cart").hidden = false;
  }

  /* ---------- expand / collapse the widget (checkout) ---------- */

  function expand() {
    el(".booking-bar").classList.add("is-checkout");
    el(".booking-bar").classList.remove("is-min");
    el("#bb-cart").hidden = true;
    el("#bb-min").hidden = true;
    el("#bb-checkout").hidden = false;
  }
  function collapse() {
    el(".booking-bar").classList.remove("is-checkout");
    el(".booking-bar").classList.remove("is-min");
    el("#bb-checkout").hidden = true;
    el("#bb-min").hidden = true;
    el("#bb-cart").hidden = false;
  }

  /* ---------- checkout steps ---------- */

  function setStep(n) {
    document.querySelectorAll(".bk-step").forEach(function (s) { s.classList.toggle("is-active", Number(s.dataset.step) === n); });
    document.querySelectorAll(".bk-progress li").forEach(function (li) {
      var step = Number(li.dataset.step);
      li.classList.toggle("is-done", step < n);
      li.classList.toggle("is-current", step === n);
    });
    // Fixed footer: show the matching step's action row (none on confirmation).
    document.querySelectorAll(".bk-foot").forEach(function (f) { f.classList.toggle("is-active", Number(f.dataset.foot) === n); });
    el("#bb-foot").hidden = (n >= 5);
    var body = el(".bb-checkout-body"); if (body) body.scrollTop = 0;
  }
  function showError(stepEl, msg) { var e = el(".bk-error", stepEl); if (e) { e.textContent = msg; e.hidden = !msg; } }

  // Accumulating summary (service(s) + optionally the chosen date/time).
  function summaryHTML(withWhen) {
    var t = cartTotals();
    var services = state.cart.map(function (s) { return escapeHtml(displayName(s.name)); }).join(", ");
    var html = '<div class="bk-recap-services">' + services + "</div>" +
      '<div class="bk-recap-meta">' + fmtDur(t.dur) + " · " + money(t.price) + "</div>";
    if (withWhen && state.slot) {
      html += '<div class="bk-recap-when"><b>' + escapeHtml(fmtDateLong(state.slot)) + "</b> at " + fmtTime(state.slot) + " PT</div>";
    }
    return html;
  }

  function startCheckout() {
    if (!state.cart.length) return;
    el("#bk-time-summary").innerHTML = summaryHTML(false);
    expand();
    setStep(2);
    loadAvailability();
  }

  function loadAvailability() {
    var cal = el("#bk-cal");
    cal.innerHTML = '<p class="bk-loading">Finding open times…</p>';
    el("#bk-daytimes").innerHTML = "";
    el("#bk-tz").hidden = true;
    showError(el('.bk-step[data-step="2"]'), "");
    if (DEMO) {
      state.slots = demoSlots();
      groupSlots();
      afterAvailability();
      return;
    }
    var start = new Date(Date.now() + 3600e3).toISOString();
    var end = new Date(Date.now() + 30 * 864e5).toISOString();
    fetch(WORKER + "/api/availability", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ service_variation_ids: state.cart.map(function (s) { return s.service_variation_id; }), start_at: start, end_at: end }),
    })
      // A non-2xx response carries {error,...}, not availabilities — treat it as a
      // retryable failure, not a definitive "no open times".
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (d) {
        state.slots = (d.availabilities || []).map(function (a) { return { start_at: a.start_at }; });
        groupSlots();
        afterAvailability();
      })
      .catch(function () { cal.innerHTML = ""; showError(el('.bk-step[data-step="2"]'), "Couldn’t load availability. Please try again."); });
  }

  function groupSlots() {
    state.byDate = {};
    state.slots.forEach(function (s) { var k = ptDateKey(s.start_at); (state.byDate[k] = state.byDate[k] || []).push(s); });
  }

  function afterAvailability() {
    state.availKeys = Object.keys(state.byDate).sort();
    if (!state.availKeys.length) {
      el("#bk-tz").hidden = true;
      el("#bk-cal").innerHTML = '<p class="bk-loading">No open times in the next 30 days for this combination. Please email alexandria@alexandriarose.org.</p>';
      return;
    }
    el("#bk-tz").hidden = false;
    el("#bk-tz").innerHTML = "Times are shown in <b>" + tzAbbrev(state.slots[0].start_at) + "</b>.";
    var k = state.availKeys[0];
    state.selectedKey = k;
    var p = k.split("-");
    state.viewY = Number(p[0]); state.viewM = Number(p[1]) - 1;
    renderCalendar();
    renderDayTimes(k);
  }

  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function monthRange() {
    var f = state.availKeys[0].split("-"), l = state.availKeys[state.availKeys.length - 1].split("-");
    return { min: Number(f[0]) * 12 + (Number(f[1]) - 1), max: Number(l[0]) * 12 + (Number(l[1]) - 1) };
  }
  function fmtDateFull(key) {
    return new Date(key + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "short", day: "numeric", year: "numeric" });
  }

  function renderCalendar() {
    var cal = el("#bk-cal");
    var y = state.viewY, m = state.viewM;
    var title = new Date(Date.UTC(y, m, 1)).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", year: "numeric" });
    var range = monthRange(), cur = y * 12 + m;
    var todayKey = ptDateKey(new Date().toISOString());
    var firstDow = new Date(Date.UTC(y, m, 1)).getUTCDay();
    var daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

    var html = '<div class="bk-cal-head">' +
      '<button type="button" class="bk-cal-nav" id="bk-cal-prev"' + (cur <= range.min ? " disabled" : "") + ' aria-label="Previous month">←</button>' +
      '<span class="bk-cal-title">' + title + "</span>" +
      '<button type="button" class="bk-cal-nav" id="bk-cal-next"' + (cur >= range.max ? " disabled" : "") + ' aria-label="Next month">→</button></div>';
    html += '<div class="bk-cal-grid">';
    ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].forEach(function (d) { html += '<span class="bk-cal-dow">' + d + "</span>"; });
    for (var i = 0; i < firstDow; i++) html += '<span class="bk-cal-day bk-cal-empty"></span>';
    for (var day = 1; day <= daysInMonth; day++) {
      var key = y + "-" + pad2(m + 1) + "-" + pad2(day);
      var avail = !!state.byDate[key];
      var cls = "bk-cal-day" + (avail ? " is-avail" : "") + (key === todayKey ? " is-today" : "") + (key === state.selectedKey ? " is-selected" : "");
      html += '<button type="button" class="' + cls + '" data-date="' + key + '"' + (avail ? "" : " disabled") + ">" + day + "</button>";
    }
    html += "</div>";
    cal.innerHTML = html;

    if (DEMO) {
      var note = document.createElement("p");
      note.className = "bk-note";
      note.style.margin = "0 0 0.75rem";
      note.textContent = "Demo mode — sample times for layout only, not real availability.";
      cal.insertBefore(note, cal.firstChild);
    }
    var prev = el("#bk-cal-prev"), next = el("#bk-cal-next");
    if (prev) prev.addEventListener("click", function () { navMonth(-1); });
    if (next) next.addEventListener("click", function () { navMonth(1); });
    cal.querySelectorAll(".bk-cal-day.is-avail").forEach(function (b) {
      b.addEventListener("click", function () { selectDay(b.dataset.date); });
    });
  }

  function navMonth(delta) {
    var cur = state.viewY * 12 + state.viewM + delta;
    state.viewY = Math.floor(cur / 12); state.viewM = ((cur % 12) + 12) % 12;
    renderCalendar();
  }

  function selectDay(key) {
    state.selectedKey = key;
    renderCalendar();
    renderDayTimes(key);
    // Reveal the time slots (they render below the calendar, often off-screen).
    var times = el("#bk-daytimes");
    if (times && times.scrollIntoView) times.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderDayTimes(key) {
    var wrap = el("#bk-daytimes");
    var slots = (state.byDate[key] || []).slice().sort(function (a, b) { return a.start_at < b.start_at ? -1 : 1; });
    var groups = { Morning: [], Afternoon: [], Evening: [] };
    slots.forEach(function (s) {
      var h = ptHour(s.start_at);
      if (h < 12) groups.Morning.push(s);
      else if (h < 17) groups.Afternoon.push(s);
      else groups.Evening.push(s);
    });
    var html = '<p class="bk-daytime-date">' + fmtDateFull(key) + "</p>";
    ["Morning", "Afternoon", "Evening"].forEach(function (part) {
      html += '<div class="bk-daypart"><h4>' + part + "</h4>";
      if (!groups[part].length) html += '<p class="bk-none">No availability</p>';
      else html += '<div class="bk-times">' + groups[part].map(function (s) {
        return '<button type="button" class="bk-time" data-iso="' + s.start_at + '">' + fmtTime(s.start_at) + "</button>";
      }).join("") + "</div>";
      html += "</div>";
    });
    wrap.innerHTML = html;
    // New day → clear any prior time selection and disable "Continue".
    state.slot = null;
    el("#bk-time-next").disabled = true;
    wrap.querySelectorAll(".bk-time").forEach(function (b) {
      b.addEventListener("click", function () { selectTime(b); });
    });
  }

  // Select a time (highlight it) without advancing; enable "Continue".
  function selectTime(btn) {
    state.slot = btn.dataset.iso;
    el("#bk-daytimes").querySelectorAll(".bk-time").forEach(function (b) { b.classList.toggle("is-selected", b === btn); });
    el("#bk-time-next").disabled = false;
  }

  function goToDetails() {
    if (!state.slot) return;
    el("#bk-details-summary").innerHTML = summaryHTML(true);
    setStep(3);
  }

  function setFieldError(form, name, msg) {
    var input = form[name];
    var errEl = form.querySelector('.bk-field-err[data-err="' + name + '"]');
    if (input) input.classList.toggle("is-invalid", !!msg);
    if (errEl) errEl.textContent = msg ? "— " + msg : "";
  }
  function clearFieldErrors(form) {
    ["first", "email", "phone"].forEach(function (n) { setFieldError(form, n, ""); });
  }

  // Validate the details form; on success set state.customer and advance.
  // Called by the footer "Continue" button and by Enter-to-submit.
  function submitDetails() {
    var form = el("#bk-details-form");
    clearFieldErrors(form);

    var fd = new FormData(form);
    var first = String(fd.get("first") || "").trim();
    var email = String(fd.get("email") || "").trim();
    var phone = String(fd.get("phone") || "").trim().replace(/[^\d+]/g, "");
    if (/^\d{10}$/.test(phone)) phone = "+1" + phone;

    var bad = null;
    if (!first) { setFieldError(form, "first", "required"); bad = bad || "first"; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setFieldError(form, "email", email ? "invalid email" : "required"); bad = bad || "email"; }
    if (!/^\+?\d{10,15}$/.test(phone)) { setFieldError(form, "phone", phone ? "invalid number" : "required"); bad = bad || "phone"; }
    if (bad) { if (form[bad]) form[bad].focus(); return; }

    state.customer = {
      given_name: first,
      family_name: String(fd.get("last") || "").trim(),
      email: email,
      phone: phone,
      note: String(fd.get("note") || "").trim(),
    };
    goToPayment();
  }

  function initDetails() {
    var form = el("#bk-details-form");
    // Clear a field's error as soon as the user edits it.
    form.addEventListener("input", function (e) {
      if (e.target.name) setFieldError(form, e.target.name, "");
    });
    form.addEventListener("submit", function (e) { e.preventDefault(); submitDetails(); });
  }

  function goToPayment() {
    var t = cartTotals();
    el("#bk-pay-summary").innerHTML = summaryHTML(true);
    el("#bk-sum-list").innerHTML = state.cart.map(function (s) { return "<dt>" + escapeHtml(displayName(s.name)) + "</dt><dd>" + money(s.price_cents) + "</dd>"; }).join("");
    el("#bk-sum-price").textContent = money(t.price);
    el("#bk-sum-balance").textContent = money(t.price - t.deposit);
    el("#bk-sum-deposit").textContent = money(t.deposit);
    // Drive the Pay button label from a stored string (no child <span> to
    // clobber) so re-entering this step never dereferences a removed node.
    state.payLabel = "Pay " + money(t.deposit) + " & book";
    el("#bk-pay-btn").textContent = state.payLabel;
    setStep(4);
    initCard();
  }

  // Load the (environment-correct) Web Payments SDK on demand, once.
  function loadSquareSdk() {
    if (window.Square) return Promise.resolve();
    if (state.sdkPromise) return state.sdkPromise;
    state.sdkPromise = new Promise(function (resolve, reject) {
      var sc = document.createElement("script");
      sc.src = SQUARE_SDK;
      sc.onload = resolve;
      sc.onerror = function () { reject(new Error("Square SDK failed to load")); };
      document.head.appendChild(sc);
    });
    return state.sdkPromise;
  }

  function initCard() {
    if (state.card) return;
    loadSquareSdk().then(function () {
      state.payments = window.Square.payments(SQUARE_APP_ID, SQUARE_LOCATION_ID);
      return state.payments.card().then(function (card) { state.card = card; return card.attach("#bk-card"); });
    }).catch(function () {
      showError(el('.bk-step[data-step="4"]'), "Couldn’t start the payment form. Please refresh.");
    });
  }

  // Map the worker's error codes to honest, customer-facing messages. Because the
  // worker now authorizes-then-captures (and voids the hold if the booking fails),
  // every failure below means the card was NOT charged — so we say so plainly.
  var PAY_MESSAGES = {
    deposit_declined: "Your card was declined. Please check the details or try another card — you have not been charged.",
    slot_unavailable: "Sorry — that time was just taken. Please go back and choose another time. Your card was not charged.",
    capture_failed: "We couldn’t process the deposit, so your card was not charged. Please try again.",
  };

  function initPay() {
    var btn = el("#bk-pay-btn");
    var errStep = el('.bk-step[data-step="4"]');
    btn.addEventListener("click", function () {
      if (!state.card) return;
      showError(errStep, "");
      btn.disabled = true; btn.textContent = "Processing…";
      state.card.tokenize().then(function (res) {
        if (res.status !== "OK") throw new Error((res.errors && res.errors[0] && res.errors[0].message) || "Card was declined.");
        return fetch(WORKER + "/api/book", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            env: SANDBOX ? "sandbox" : undefined,
            service_variation_ids: state.cart.map(function (s) { return s.service_variation_id; }),
            start_at: state.slot,
            source_id: res.token,
            note: state.customer.note,
            customer: { given_name: state.customer.given_name, family_name: state.customer.family_name, email: state.customer.email, phone: state.customer.phone },
          }),
        });
      }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (out) {
          if (!out.ok || !out.d.ok) {
            var code = out.d && out.d.error;
            throw new Error(PAY_MESSAGES[code] || "Something went wrong, so your card was not charged. Please try again.");
          }
          el("#bk-conf-services").textContent = state.cart.map(function (s) { return displayName(s.name); }).join(" + ");
          el("#bk-conf-when").textContent = fmtDateLong(state.slot) + " at " + fmtTime(state.slot) + " PT";
          el("#bk-conf-email").textContent = state.customer.email;
          setStep(5);
          // Booking is done — clear the persisted cart so it doesn't survive a
          // page refresh or come back on the next visit.
          state.cart = [];
          saveCart();
        }).catch(function (err) {
          showError(errStep, err.message || "Something went wrong. Your card was not charged. Please try again.");
          btn.disabled = false; btn.textContent = state.payLabel || "Pay deposit & book";
        });
    });
  }

  /* ---------- init ---------- */

  function init() {
    loadServices();
    el(".booking-bar").addEventListener("click", function (e) {
      var rm = e.target.closest(".remove");
      if (rm) { var item = rm.closest(".booking-bar-item"); if (item) toggle(item.dataset.id); }
    });
    el("#bk-book-btn").addEventListener("click", startCheckout);
    el("#bb-minimize").addEventListener("click", minimize);
    el("#bb-min").addEventListener("click", unminimize);
    el("#bk-edit-services").addEventListener("click", collapse);
    el("#bk-time-next").addEventListener("click", goToDetails);
    el("#bk-details-next").addEventListener("click", submitDetails);
    document.querySelectorAll("[data-back]").forEach(function (b) { b.addEventListener("click", function () { setStep(Number(b.dataset.back)); }); });
    var done = el("#bk-done-btn");
    if (done) done.addEventListener("click", function () { state.cart = []; saveCart(); renderCart(); collapse(); setStep(2); });
    initDetails();
    initPay();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
