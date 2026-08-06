/* ============================================================
   common.js — 全站动效：滚动显现、数字滚动、hero 粒子
   ============================================================ */
(function () {
  "use strict";

  /* ---------- 滚动显现 ---------- */
  function initReveal() {
    var els = document.querySelectorAll(".reveal");
    if (!("IntersectionObserver" in window)) {
      els.forEach(function (el) { el.classList.add("in"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
    els.forEach(function (el) { io.observe(el); });
  }

  /* ---------- 数字滚动 ---------- */
  function animateCount(el) {
    var target = parseFloat(el.getAttribute("data-count") || "0");
    var decimals = parseInt(el.getAttribute("data-decimals") || "0", 10);
    var suffix = el.getAttribute("data-suffix") || "";
    var dur = 1400;
    var t0 = null;
    function frame(t) {
      if (!t0) t0 = t;
      var p = Math.min((t - t0) / dur, 1);
      var ease = 1 - Math.pow(1 - p, 3); // easeOutCubic
      var val = target * ease;
      el.textContent = val.toFixed(decimals) + suffix;
      if (p < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function initCounters() {
    var els = document.querySelectorAll("[data-count]");
    if (!("IntersectionObserver" in window)) {
      els.forEach(animateCount);
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          animateCount(entry.target);
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.5 });
    els.forEach(function (el) { io.observe(el); });
  }

  /* ---------- hero 背景粒子 ---------- */
  function initParticles() {
    var host = document.querySelector(".hero");
    if (!host) return;
    var colors = ["#38bdf8", "#a78bfa", "#f472b6", "#34d399"];
    for (var i = 0; i < 14; i++) {
      var p = document.createElement("span");
      p.className = "particle";
      var size = 3 + Math.random() * 5;
      p.style.width = size + "px";
      p.style.height = size + "px";
      p.style.left = (5 + Math.random() * 90) + "%";
      p.style.top = (10 + Math.random() * 80) + "%";
      p.style.background = colors[i % colors.length];
      p.style.animationDelay = (Math.random() * 6).toFixed(1) + "s";
      p.style.animationDuration = (5 + Math.random() * 6).toFixed(1) + "s";
      host.appendChild(p);
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    initReveal();
    initCounters();
    initParticles();
  });
})();
