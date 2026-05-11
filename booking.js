(function () {
  var STORAGE_KEY = "ar-booking";
  var EMAIL = "hello@alexandriarose.com";

  // ─────────────────────────────────────────────────────────────
  // SQUARE APPOINTMENTS
  // Currently pointing at a temporary booking URL so the flow works
  // end-to-end. The temporary URL won't accept service pre-selection
  // — users land on the booking page and pick services there.
  //
  // When Alexandria's own Square Appointments account is ready,
  // swap SQUARE_BOOKING_URL back to their URL (format will be like
  // https://book.squareup.com/appointments/<id>/location/<id>) and
  // wire per-service deep-linking in bookHref() once we know
  // Square's URL format for pre-selecting services. Selected items'
  // Square IDs are collected as state.items[].squareId from the
  // data-square-id attributes on each .tier-add button.
  // ─────────────────────────────────────────────────────────────
  // Original placeholder — restore when Alexandria's account is live:
  // var SQUARE_BOOKING_URL = "https://book.squareup.com/PLACEHOLDER-MERCHANT-ID";
  var SQUARE_BOOKING_URL = "https://book.squareup.com/appointments/zo3bj4b3x8dtio/location/AQ8QAAS9N67HR/services";

  var state = { items: [] };

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.items)); } catch (e) {}
  }

  function load() {
    try {
      var data = localStorage.getItem(STORAGE_KEY);
      state.items = data ? (JSON.parse(data) || []) : [];
    } catch (e) {
      state.items = [];
    }
  }

  function fmtTime(min) {
    if (min < 60) return min + " min";
    var h = Math.floor(min / 60);
    var m = min % 60;
    if (m === 0) return h + (h === 1 ? " hour" : " hours");
    return h + "h " + m + "m";
  }

  function fmtPrice(p) { return "$" + p; }

  function fmtRange(lo, hi, fmt) {
    return lo === hi ? fmt(lo) : fmt(lo) + " – " + fmt(hi);
  }

  function totals() {
    var t = { dMin: 0, dMax: 0, pMin: 0, pMax: 0 };
    state.items.forEach(function (it) {
      t.dMin += it.dMin; t.dMax += it.dMax;
      t.pMin += it.pMin; t.pMax += it.pMax;
    });
    return t;
  }

  function bookHref() {
    // TODO(square): once we know Square's URL format for pre-selecting
    // multiple services, build the deep-link here using each item's
    // squareId. For now, the button just opens the base booking page
    // and the user re-selects services on Square's side.
    //
    // Selected items' Square IDs are available as:
    //   state.items.map(function (i) { return i.squareId; })
    return SQUARE_BOOKING_URL;
  }

  // Kept as a fallback if we ever want a "or email instead" link in
  // the booking bar. Not currently wired into the UI.
  function emailHref() {
    if (!state.items.length) return "mailto:" + EMAIL;
    var t = totals();
    var lines = state.items.map(function (i) {
      return "• " + i.name +
        " — " + fmtRange(i.dMin, i.dMax, fmtTime) +
        " — " + fmtRange(i.pMin, i.pMax, fmtPrice);
    });
    var body = [
      "Hello Alexandria,",
      "",
      "I'd like to book the following:",
      "",
      lines.join("\n"),
      "",
      "Estimated total: " + fmtRange(t.dMin, t.dMax, fmtTime) +
        "  /  " + fmtRange(t.pMin, t.pMax, fmtPrice),
      "",
      "Best,"
    ].join("\n");
    var subject = "Booking request — " + state.items.map(function (i) { return i.name; }).join(", ");
    return "mailto:" + EMAIL +
      "?subject=" + encodeURIComponent(subject) +
      "&body=" + encodeURIComponent(body);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function renderList() {
    var listEl = document.querySelector(".booking-bar-list");
    if (!listEl) return;
    listEl.innerHTML = state.items.map(function (it) {
      var dur = fmtRange(it.dMin, it.dMax, fmtTime);
      var price = fmtRange(it.pMin, it.pMax, fmtPrice);
      return '<li class="booking-bar-item" data-id="' + escapeHtml(it.id) + '">' +
        '<span class="name">' + escapeHtml(it.name) +
          '<span class="meta">' + escapeHtml(dur) + '</span>' +
        '</span>' +
        '<span class="price">' + escapeHtml(price) + '</span>' +
        '<button type="button" class="remove" aria-label="Remove ' + escapeHtml(it.name) + '">−</button>' +
      '</li>';
    }).join("");
  }

  function render() {
    var bar = document.querySelector(".booking-bar");
    if (!bar) return;
    var n = state.items.length;
    bar.classList.toggle("is-active", n > 0);

    var countEl = bar.querySelector(".count");
    if (countEl) countEl.textContent = n + (n === 1 ? " service" : " services");

    renderList();

    var t = totals();
    var timeEl = bar.querySelector(".totals .time");
    var priceEl = bar.querySelector(".totals .price");
    if (timeEl) timeEl.textContent = n ? fmtRange(t.dMin, t.dMax, fmtTime) : "—";
    if (priceEl) priceEl.textContent = n ? fmtRange(t.pMin, t.pMax, fmtPrice) : "—";

    var btn = bar.querySelector(".book-btn");
    if (btn) btn.setAttribute("href", bookHref());

    document.querySelectorAll(".tier-add").forEach(function (b) {
      var id = b.dataset.id;
      var on = state.items.some(function (it) { return it.id === id; });
      var tier = b.closest(".service-tier");
      if (tier) tier.classList.toggle("is-selected", on);
      b.textContent = on ? "−" : "+";
      b.setAttribute("aria-label", (on ? "Remove " : "Add ") + b.dataset.name);
    });
  }

  function toggle(btn) {
    var id = btn.dataset.id;
    var idx = -1;
    for (var i = 0; i < state.items.length; i++) {
      if (state.items[i].id === id) { idx = i; break; }
    }
    if (idx >= 0) {
      state.items.splice(idx, 1);
    } else {
      state.items.push({
        id: id,
        name: btn.dataset.name,
        squareId: btn.dataset.squareId || null,
        dMin: parseInt(btn.dataset.durMin, 10),
        dMax: parseInt(btn.dataset.durMax, 10),
        pMin: parseInt(btn.dataset.priceMin, 10),
        pMax: parseInt(btn.dataset.priceMax, 10)
      });
    }
    save();
    render();
  }

  function removeById(id) {
    state.items = state.items.filter(function (it) { return it.id !== id; });
    save();
    render();
  }

  function init() {
    load();

    document.querySelectorAll(".tier-add").forEach(function (btn) {
      btn.addEventListener("click", function () { toggle(btn); });
    });

    var bar = document.querySelector(".booking-bar");
    if (bar) {
      bar.addEventListener("click", function (e) {
        var rm = e.target.closest(".remove");
        if (rm) {
          var item = rm.closest(".booking-bar-item");
          if (item) removeById(item.dataset.id);
        }
      });
    }

    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
