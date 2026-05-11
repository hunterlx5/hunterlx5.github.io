(function () {
  var STORAGE_KEY = "ar-theme";
  var THEMES = ["cream", "ink", "bone", "bone-alt"];

  function applyTheme(theme) {
    if (THEMES.indexOf(theme) === -1) theme = "cream";
    document.documentElement.setAttribute("data-theme", theme);
    document.querySelectorAll(".theme-switch button").forEach(function (btn) {
      btn.setAttribute("aria-pressed", btn.dataset.theme === theme ? "true" : "false");
    });
  }

  function initTheme() {
    var current = document.documentElement.getAttribute("data-theme") || "cream";
    applyTheme(current);
    // Event delegation so buttons inside the mobile menu (cloned) also work.
    document.addEventListener("click", function (e) {
      var btn = e.target.closest(".theme-switch button");
      if (!btn) return;
      var t = btn.dataset.theme;
      applyTheme(t);
      try { localStorage.setItem(STORAGE_KEY, t); } catch (err) {}
    });
  }

  function initMobileNav() {
    var nav = document.querySelector(".nav");
    if (!nav) return;
    var navRight = nav.querySelector(".nav-right");
    var navLinks = nav.querySelector(".nav-links");
    var themeSwitch = nav.querySelector(".theme-switch");
    if (!navRight || !navLinks) return;

    // Hamburger button (lives in the sticky header — stays visible above the menu)
    var toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "nav-toggle";
    toggle.setAttribute("aria-label", "Open menu");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-controls", "mobile-menu");
    toggle.innerHTML = '<span class="bar"></span><span class="bar"></span>';
    nav.insertBefore(toggle, navRight);

    // Overlay menu
    var menu = document.createElement("div");
    menu.className = "mobile-menu";
    menu.id = "mobile-menu";
    menu.setAttribute("aria-hidden", "true");

    var inner = document.createElement("div");
    inner.className = "mobile-menu-inner";

    var linksClone = navLinks.cloneNode(true);
    linksClone.className = "mobile-menu-links";
    inner.appendChild(linksClone);

    if (themeSwitch) {
      var footer = document.createElement("div");
      footer.className = "mobile-menu-footer";
      var label = document.createElement("span");
      label.textContent = "Theme";
      footer.appendChild(label);
      footer.appendChild(themeSwitch.cloneNode(true));
      inner.appendChild(footer);
    }

    menu.appendChild(inner);
    document.body.appendChild(menu);

    function setOpen(open) {
      menu.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
      menu.setAttribute("aria-hidden", open ? "false" : "true");
      document.body.classList.toggle("menu-open", open);
    }

    toggle.addEventListener("click", function () {
      setOpen(!menu.classList.contains("is-open"));
    });

    // Close on link click (so anchor jumps + page navigations dismiss it)
    menu.addEventListener("click", function (e) {
      if (e.target.closest("a")) setOpen(false);
    });

    // Close on Escape
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && menu.classList.contains("is-open")) setOpen(false);
    });

    // If viewport grows past mobile breakpoint while menu is open, close it
    var mql = window.matchMedia("(min-width: 769px)");
    var onChange = function (e) { if (e.matches) setOpen(false); };
    if (mql.addEventListener) mql.addEventListener("change", onChange);
    else if (mql.addListener) mql.addListener(onChange);
  }

  function init() {
    initTheme();
    initMobileNav();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
