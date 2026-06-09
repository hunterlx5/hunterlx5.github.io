/* Inline photo uploader for the placeholder tiles.
 *
 * How it works:
 *  - Every `.ph` placeholder is given a stable slot id (page + position).
 *  - `images.json` in the repo maps slot id -> committed image path.
 *  - On load, any filled slot is swapped from a placeholder into a real <img>.
 *  - "Edit mode" (visit any page with #edit) lets the owner tap a tile to
 *    pick a photo. The photo is resized in the browser, then committed straight
 *    into the GitHub repo via the Contents API using a personal access token
 *    the owner pastes once (stored locally on their device). GitHub Pages
 *    redeploys within ~30s and the photo is live for everyone.
 *
 * The token never leaves this device except as an Authorization header to
 * api.github.com. To revoke access, delete the token on GitHub and click
 * "Sign out" in the edit bar.
 */
(function () {
  "use strict";

  var REPO = "hunterlx5/hunterlx5.github.io";
  var BRANCH = "main";
  var MANIFEST = "images.json";
  var API = "https://api.github.com";
  var MAX_DIM = 2000; // longest edge, px
  var JPEG_QUALITY = 0.85;
  var TOKEN_KEY = "gh_upload_token";

  // ---- slot ids -----------------------------------------------------------
  function pageKey() {
    var p = location.pathname.toLowerCase();
    if (p.indexOf("portfolio") !== -1) return "portfolio";
    if (p.indexOf("services") !== -1) return "services";
    if (p.indexOf("about") !== -1) return "about";
    if (p.indexOf("faq") !== -1) return "faq";
    if (p.indexOf("new-clients") !== -1) return "new-clients";
    return "home";
  }

  var placeholders = Array.prototype.slice.call(document.querySelectorAll(".ph"));
  if (!placeholders.length) return;
  var page = pageKey();
  placeholders.forEach(function (el, i) {
    el.dataset.slot = page + "-" + i;
  });

  var manifest = {};

  // ---- rendering filled slots --------------------------------------------
  function fillImage(el, src, isBlob) {
    var img = el.querySelector("img.ph-img");
    if (!img) {
      img = document.createElement("img");
      img.className = "ph-img";
      el.appendChild(img);
    }
    img.src = isBlob ? src : "/" + src + "?t=" + Date.now();
    img.alt = el.dataset.label || "";
    el.classList.add("has-image");
    refreshDeleteBtn(el);
  }

  function clearImage(el) {
    var img = el.querySelector("img.ph-img");
    if (img) img.remove();
    el.classList.remove("has-image");
    refreshDeleteBtn(el);
  }

  // A small "Delete" control shown over any filled tile while in edit mode.
  function refreshDeleteBtn(el) {
    var inEdit = document.body.classList.contains("edit-mode");
    var existing = el.querySelector(".ph-delete");
    if (inEdit && el.classList.contains("has-image")) {
      if (!existing) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "ph-delete";
        btn.textContent = "Delete";
        btn.setAttribute("aria-label", "Delete this photo");
        btn.onclick = function (e) {
          e.preventDefault();
          e.stopPropagation();
          handleDelete(el).catch(function (err) {
            setStatus("Error: " + err.message, false);
            console.error(err);
          });
        };
        el.appendChild(btn);
      }
    } else if (existing) {
      existing.remove();
    }
  }

  function removeAllDeleteBtns() {
    placeholders.forEach(function (el) {
      var b = el.querySelector(".ph-delete");
      if (b) b.remove();
    });
  }

  function loadManifest() {
    return fetch("/" + MANIFEST + "?t=" + Date.now(), { cache: "no-store" })
      .then(function (res) { return res.ok ? res.json() : {}; })
      .catch(function () { return {}; })
      .then(function (obj) {
        manifest = obj || {};
        placeholders.forEach(function (el) {
          var path = manifest[el.dataset.slot];
          if (path) fillImage(el, path, false);
        });
      });
  }

  // ---- image processing ---------------------------------------------------
  function resizeImage(file) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var w = img.width, h = img.height;
        var longest = Math.max(w, h);
        if (longest > MAX_DIM) {
          var s = MAX_DIM / longest;
          w = Math.round(w * s);
          h = Math.round(h * s);
        }
        var c = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        c.toBlob(function (b) {
          b ? resolve(b) : reject(new Error("Could not encode image"));
        }, "image/jpeg", JPEG_QUALITY);
      };
      img.onerror = function () { reject(new Error("Could not read image")); };
      img.src = URL.createObjectURL(file);
    });
  }

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result).split(",")[1]); };
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  // ---- GitHub API ---------------------------------------------------------
  function token() { return localStorage.getItem(TOKEN_KEY) || ""; }

  function gh(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign(
      {
        Authorization: "Bearer " + token(),
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28"
      },
      opts.headers || {}
    );
    return fetch(API + path, opts);
  }

  function getFileMeta(repoPath) {
    return gh(
      "/repos/" + REPO + "/contents/" + repoPath + "?ref=" + BRANCH + "&t=" + Date.now(),
      { cache: "no-store" }
    ).then(function (res) {
      if (res.ok) return res.json();
      return null;
    });
  }

  function putFile(repoPath, base64, message, sha) {
    var body = { message: message, content: base64, branch: BRANCH };
    if (sha) body.sha = sha;
    return gh("/repos/" + REPO + "/contents/" + repoPath, {
      method: "PUT",
      body: JSON.stringify(body)
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          throw new Error("GitHub " + res.status + ": " + t);
        });
      }
      return res.json();
    });
  }

  function decodeB64Json(content) {
    try {
      return JSON.parse(decodeURIComponent(escape(atob(content.replace(/\n/g, "")))));
    } catch (e) {
      return {};
    }
  }

  function updateManifest(slot, repoPath) {
    return getFileMeta(MANIFEST).then(function (meta) {
      var obj = meta && meta.content ? decodeB64Json(meta.content) : {};
      obj[slot] = repoPath;
      var json = JSON.stringify(obj, null, 2);
      var b64 = btoa(unescape(encodeURIComponent(json)));
      return putFile(MANIFEST, b64, "Map " + slot + " -> " + repoPath, meta && meta.sha)
        .then(function () { manifest = obj; });
    });
  }

  function deleteFile(repoPath, sha, message) {
    return gh("/repos/" + REPO + "/contents/" + repoPath, {
      method: "DELETE",
      body: JSON.stringify({ message: message, sha: sha, branch: BRANCH })
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          throw new Error("GitHub " + res.status + ": " + t);
        });
      }
      return res.json();
    });
  }

  function removeFromManifest(slot) {
    return getFileMeta(MANIFEST).then(function (meta) {
      var obj = meta && meta.content ? decodeB64Json(meta.content) : {};
      if (!(slot in obj)) { manifest = obj; return; }
      delete obj[slot];
      var json = JSON.stringify(obj, null, 2);
      var b64 = btoa(unescape(encodeURIComponent(json)));
      return putFile(MANIFEST, b64, "Unmap " + slot, meta && meta.sha)
        .then(function () { manifest = obj; });
    });
  }

  function handleFile(el, file) {
    var slot = el.dataset.slot;
    var repoPath = "images/" + slot + ".jpg";
    var previewUrl;
    setStatus("Processing image…", true);
    return resizeImage(file)
      .then(function (blob) {
        previewUrl = URL.createObjectURL(blob);
        return blobToBase64(blob);
      })
      .then(function (b64) {
        setStatus("Uploading to GitHub…", true);
        return getFileMeta(repoPath).then(function (meta) {
          return putFile(repoPath, b64, "Upload photo for " + slot, meta && meta.sha);
        });
      })
      .then(function () {
        setStatus("Saving mapping…", true);
        return updateManifest(slot, repoPath);
      })
      .then(function () {
        fillImage(el, previewUrl, true);
        setStatus("Saved ✓  Live on the site in ~30s.", false);
      });
  }

  function handleDelete(el) {
    var slot = el.dataset.slot;
    var repoPath = manifest[slot] || ("images/" + slot + ".jpg");
    if (!window.confirm("Delete this photo? The tile will return to a placeholder.")) {
      return Promise.resolve();
    }
    setStatus("Deleting photo…", true);
    return getFileMeta(repoPath)
      .then(function (meta) {
        // If the file is already gone, skip straight to clearing the mapping.
        if (meta && meta.sha) {
          return deleteFile(repoPath, meta.sha, "Delete photo for " + slot);
        }
      })
      .then(function () {
        setStatus("Updating mapping…", true);
        return removeFromManifest(slot);
      })
      .then(function () {
        clearImage(el);
        setStatus("Deleted ✓  Live on the site in ~30s.", false);
      });
  }

  // ---- edit bar UI --------------------------------------------------------
  var bar, statusEl, fileInput;

  function buildFileInput() {
    fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.style.display = "none";
    document.body.appendChild(fileInput);
  }

  function setStatus(msg, busy) {
    if (statusEl) {
      statusEl.textContent = msg;
      statusEl.classList.toggle("busy", !!busy);
    }
  }

  function ensureBar() {
    if (bar) return;
    bar = document.createElement("div");
    bar.id = "upload-bar";
    document.body.appendChild(bar);
  }

  function showTokenPrompt(message) {
    ensureBar();
    bar.innerHTML = "";
    var label = document.createElement("span");
    label.className = "status";
    label.textContent = message || "Paste your GitHub token to edit photos:";
    var input = document.createElement("input");
    input.type = "password";
    input.placeholder = "github_pat_…";
    input.autocomplete = "off";
    var save = document.createElement("button");
    save.textContent = "Unlock";
    var cancel = document.createElement("button");
    cancel.className = "ghost";
    cancel.textContent = "Cancel";

    save.onclick = function () {
      var t = input.value.trim();
      if (!t) return;
      localStorage.setItem(TOKEN_KEY, t);
      verifyToken().then(function (ok) {
        if (ok) activate();
        else {
          localStorage.removeItem(TOKEN_KEY);
          showTokenPrompt("That token can't write to the repo. Try another:");
        }
      });
    };
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") save.click();
    });
    cancel.onclick = exitEditMode;

    bar.appendChild(label);
    bar.appendChild(input);
    bar.appendChild(save);
    bar.appendChild(cancel);
    input.focus();
  }

  function showEditBar() {
    ensureBar();
    bar.innerHTML = "";
    statusEl = document.createElement("span");
    statusEl.className = "status";
    statusEl.textContent = "Editing — tap a tile to replace it, or Delete to remove a photo.";
    var signout = document.createElement("button");
    signout.className = "ghost";
    signout.textContent = "Sign out";
    signout.onclick = function () {
      localStorage.removeItem(TOKEN_KEY);
      exitEditMode();
    };
    var done = document.createElement("button");
    done.textContent = "Done";
    done.onclick = exitEditMode;
    bar.appendChild(statusEl);
    bar.appendChild(signout);
    bar.appendChild(done);
  }

  function verifyToken() {
    return gh("/repos/" + REPO).then(function (res) {
      if (!res.ok) return false;
      return res.json().then(function (j) {
        return !!(j.permissions && j.permissions.push);
      });
    }).catch(function () { return false; });
  }

  // ---- edit mode lifecycle ------------------------------------------------
  function onPhClick(e) {
    if (!document.body.classList.contains("edit-mode")) return;
    // Clicks on the delete control are handled separately.
    if (e.target.closest && e.target.closest(".ph-delete")) return;
    e.preventDefault();
    e.stopPropagation();
    var el = e.currentTarget;
    fileInput.onchange = function () {
      var f = fileInput.files[0];
      fileInput.value = "";
      if (!f) return;
      handleFile(el, f).catch(function (err) {
        setStatus("Error: " + err.message, false);
        console.error(err);
      });
    };
    fileInput.click();
  }

  function activate() {
    document.body.classList.add("edit-mode");
    showEditBar();
    placeholders.forEach(refreshDeleteBtn);
  }

  function exitEditMode() {
    document.body.classList.remove("edit-mode");
    removeAllDeleteBtns();
    if (bar) { bar.remove(); bar = null; statusEl = null; }
    if (location.hash === "#edit") {
      history.replaceState(null, "", location.pathname + location.search);
    }
  }

  function enterEditMode() {
    buildFileInputIfNeeded();
    if (!token()) { showTokenPrompt(); return; }
    verifyToken().then(function (ok) {
      if (ok) activate();
      else { localStorage.removeItem(TOKEN_KEY); showTokenPrompt("Saved token is invalid. Paste a new one:"); }
    });
  }

  function buildFileInputIfNeeded() {
    if (!fileInput) buildFileInput();
  }

  function maybeEdit() {
    var wants = location.hash === "#edit" ||
      new URLSearchParams(location.search).get("edit") === "1";
    if (wants) enterEditMode();
  }

  // ---- boot ---------------------------------------------------------------
  placeholders.forEach(function (el) {
    el.addEventListener("click", onPhClick, true);
  });
  loadManifest();
  maybeEdit();
  window.addEventListener("hashchange", maybeEdit);
})();
