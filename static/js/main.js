/* DeformX project page — light interactivity. No dependencies. */
(function () {
  "use strict";

  /* ---- Scrollspy: highlight the active nav link ------------------------ */
  var links = Array.prototype.slice.call(document.querySelectorAll(".nav-links .navlink"));
  var sections = links
    .map(function (a) {
      var id = a.getAttribute("href");
      return id && id.charAt(0) === "#" ? document.querySelector(id) : null;
    })
    .filter(Boolean);

  if ("IntersectionObserver" in window && sections.length) {
    var byId = {};
    links.forEach(function (a) { byId[a.getAttribute("href").slice(1)] = a; });

    var spy = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            links.forEach(function (l) { l.classList.remove("active"); });
            var active = byId[e.target.id];
            if (active) active.classList.add("active");
          }
        });
      },
      { rootMargin: "-45% 0px -50% 0px", threshold: 0 }
    );
    sections.forEach(function (s) { spy.observe(s); });
  }

  /* ---- Copy BibTeX ----------------------------------------------------- */
  var copyBtn = document.getElementById("copyBib");
  if (copyBtn) {
    copyBtn.addEventListener("click", function () {
      var pre = document.getElementById("bibContent");
      var text = pre ? pre.innerText : "";
      var label = document.getElementById("copyTxt");
      var done = function () {
        if (label) {
          label.textContent = "Copied!";
          setTimeout(function () { label.textContent = "Copy"; }, 1800);
        }
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(fallback);
      } else {
        fallback();
      }
      function fallback() {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand("copy"); done(); } catch (e) { /* noop */ }
        document.body.removeChild(ta);
      }
    });
  }

  /* ---- Lightbox for figures ------------------------------------------- */
  var lb = document.getElementById("lightbox");
  var lbImg = document.getElementById("lbImg");
  var lbClose = document.getElementById("lbClose");
  var lbReturnFocus = null; // element to restore focus to on close

  function openLightbox(src, alt, trigger) {
    if (!lb || !lbImg) return;
    lbImg.src = src;
    lbImg.alt = alt || "";
    lb.classList.add("open");
    document.body.style.overflow = "hidden";
    lbReturnFocus = trigger || document.activeElement;
    if (lbClose) lbClose.focus();
  }
  function closeLightbox() {
    if (!lb || !lb.classList.contains("open")) return;
    lb.classList.remove("open");
    document.body.style.overflow = "";
    setTimeout(function () { if (lbImg) lbImg.src = ""; }, 200);
    if (lbReturnFocus && lbReturnFocus.focus) lbReturnFocus.focus();
    lbReturnFocus = null;
  }

  // Make every zoomable figure focusable and operable by mouse + keyboard.
  document.querySelectorAll("[data-zoom] img").forEach(function (img) {
    img.setAttribute("tabindex", "0");
    img.setAttribute("role", "button");
    if (!img.getAttribute("aria-label")) {
      img.setAttribute("aria-label", "Enlarge figure" + (img.alt ? ": " + img.alt : ""));
    }
    function open() { openLightbox(img.currentSrc || img.src, img.alt, img); }
    img.addEventListener("click", open);
    img.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
    });
  });

  if (lb) lb.addEventListener("click", closeLightbox);
  if (lbClose) lbClose.addEventListener("click", closeLightbox);
  document.addEventListener("keydown", function (e) {
    if (!lb || !lb.classList.contains("open")) return;
    if (e.key === "Escape") {
      closeLightbox();
    } else if (e.key === "Tab") {
      // Only the close button is focusable inside the dialog — trap focus there.
      e.preventDefault();
      if (lbClose) lbClose.focus();
    }
  });

  /* ---- Friendly nudge for unfilled placeholder links ------------------ */
  document.querySelectorAll('a[data-link]').forEach(function (a) {
    a.addEventListener("click", function (e) {
      var href = a.getAttribute("href");
      if (href === "#" || href === "" || href === null) {
        e.preventDefault();
        console.info(
          "[DeformX] Link '" + a.getAttribute("data-link") +
          "' is a placeholder. Set its href in index.html when the URL is available."
        );
      }
    });
  });
})();
