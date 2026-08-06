/* ============================================================
   chart.js — 自写 SVG 图表渲染器（零依赖）
   支持：bar(分组/堆叠) / hbar / line(面积) / radar / heatmap
        / donut / tagcloud，全部带入场动画 + hover tooltip
   用法：Chart.bar(el, opts) 等；opts 见各函数
   ============================================================ */
(function (global) {
  "use strict";

  var PALETTE = ["#38bdf8", "#a78bfa", "#f472b6", "#34d399", "#fbbf24", "#f87171", "#22d3ee"];
  var NS = "http://www.w3.org/2000/svg";

  /* ---------- 工具 ---------- */
  function E(tag, attrs, children) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    (children || []).forEach(function (c) {
      n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return n;
  }

  function fmt(v, dec) {
    if (v == null) return "";
    var d = dec == null ? (Math.abs(v) >= 100 ? 0 : 1) : dec;
    var s = Number(v).toLocaleString("zh-CN", { maximumFractionDigits: d, minimumFractionDigits: 0 });
    return s;
  }

  function niceMax(v) {
    if (v <= 0) return 1;
    var pow = Math.pow(10, Math.floor(Math.log10(v)));
    var n = v / pow;
    var nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
    return nice * pow;
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function mixColor(c1, c2, t) {
    function hx(c) { return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]; }
    var a = hx(c1), b = hx(c2);
    return "rgb(" + Math.round(a[0] + (b[0] - a[0]) * t) + "," + Math.round(a[1] + (b[1] - a[1]) * t) + "," + Math.round(a[2] + (b[2] - a[2]) * t) + ")";
  }

  /* ---------- tooltip ---------- */
  var tipEl = null;
  function getTip() {
    if (!tipEl) {
      tipEl = document.createElement("div");
      tipEl.className = "chart-tip";
      document.body.appendChild(tipEl);
    }
    return tipEl;
  }
  function tipShow(html, x, y) {
    var t = getTip();
    t.innerHTML = html;
    t.style.opacity = "1";
    var pad = 14;
    var w = t.offsetWidth, h = t.offsetHeight;
    var vw = window.innerWidth, vh = window.innerHeight;
    var tx = x + pad, ty = y - h - 10;
    if (tx + w > vw - 8) tx = x - w - pad;
    if (ty < 8) ty = y + pad + 6;
    if (ty + h > vh - 8) ty = vh - h - 8;
    t.style.left = tx + "px";
    t.style.top = ty + "px";
  }
  function tipHide() { if (tipEl) tipEl.style.opacity = "0"; }

  function bindTip(root, svg) {
    svg.addEventListener("mousemove", function (e) {
      var hit = e.target.closest("[data-tip]");
      if (hit) {
        var box = svg.getBoundingClientRect();
        var r = svg.viewBox.baseVal;
        var px = box.width / r.width;
        tipShow(hit.getAttribute("data-tip"), e.clientX, e.clientY);
        hit.setAttribute("stroke", "rgba(255,255,255,0.75)");
        if (hit.__prevStroke != null && hit !== hit.__prevEl) {
          hit.__prevEl.setAttribute("stroke", hit.__prevStroke);
          hit.__prevEl.setAttribute("stroke-width", hit.__prevW || "0");
        }
        if (hit !== hit.__prevEl) {
          hit.__prevStroke = hit.getAttribute("stroke");
          hit.__prevW = hit.getAttribute("stroke-width");
          hit.__prevEl = hit;
        }
      } else {
        tipHide();
        if (svg.__prevEl) {
          svg.__prevEl.setAttribute("stroke", svg.__prevEl.__prevStroke);
          svg.__prevEl.setAttribute("stroke-width", svg.__prevEl.__prevW || "0");
          svg.__prevEl = null;
        }
      }
    });
    svg.addEventListener("mouseleave", tipHide);
  }

  /* ---------- 公共骨架 ---------- */
  function base(opts) {
    var W = opts.width || 720;
    var H = opts.height || 300;
    var svg = E("svg", { viewBox: "0 0 " + W + " " + H, role: "img" });
    return { svg: svg, W: W, H: H };
  }

  function legend(svg, series, W, H) {
    if (series.length < 2) return;
    var lg = E("g", { transform: "translate(0," + (H - 20) + ")" });
    var x = W / 2 - 20;
    series.forEach(function (s) {
      var item = E("g", { transform: "translate(" + x + ",0)" });
      item.appendChild(E("rect", { x: 0, y: -8, width: 14, height: 14, rx: 3, fill: s.color }));
      item.appendChild(E("text", { x: 20, y: 3, "font-size": 12, fill: "#93a0b8" }, [s.name]));
      x += 34 + s.name.length * 13 + 24;
      lg.appendChild(item);
    });
    svg.appendChild(lg);
  }

  /* ============================================================
     柱状图（分组 / 堆叠）
     opts: labels[], series[{name, values, color?}], stacked?,
           unit?, format?, height?, colorScale? (heat 用)
   ============================================================ */
  function bar(el, opts) {
    var labels = opts.labels || [];
    var series = opts.series || [];
    var stacked = !!opts.stacked;
    var H = opts.height || 300;
    var W = 720;
    var PL = 44, PR = 14, PT = 14, PB = 46;
    var iw = W - PL - PR, ih = H - PT - PB;

    var b = base({ width: W, height: H });
    var svg = b.svg;

    var barsLayer = E("g", {});
    svg.appendChild(barsLayer);
    var legendLayer = E("g", {});
    svg.appendChild(legendLayer);

    function render() {
      while (barsLayer.firstChild) barsLayer.removeChild(barsLayer.firstChild);
      while (legendLayer.firstChild) legendLayer.removeChild(legendLayer.firstChild);

      var maxV = 0;
      series.forEach(function (s) {
        s.values.forEach(function (v, i) {
          var acc = stacked ? series.reduce(function (a, ss) { return a + (ss.values[i] || 0); }, 0) : v;
          if (acc > maxV) maxV = acc;
        });
      });
      maxV = niceMax(maxV);

      series.forEach(function (s, si) { s.color = s.color || PALETTE[si % PALETTE.length]; });

      /* 网格 + Y 刻度（clean 模式：去掉，高级感） */
      if (!opts.clean) {
        for (var gi = 0; gi <= 4; gi++) {
          var gy = PT + ih - (ih * gi / 4);
          var gv = maxV * gi / 4;
          barsLayer.appendChild(E("line", { x1: PL, y1: gy, x2: W - PR, y2: gy, stroke: "rgba(255,255,255,0.07)", "stroke-width": 1 }));
          barsLayer.appendChild(E("text", { x: PL - 8, y: gy + 4, "text-anchor": "end", "font-size": 11, fill: "#5d6b85" }, [fmt(gv, 1)]));
        }
      }

      var n = labels.length;
      var groupW = iw / n;
      var barW = stacked ? groupW * 0.52 : groupW * 0.52 / Math.max(1, series.length);

      /* 平均参照线（非堆叠图） */
      if (!stacked && opts.baseline) {
        var bl = opts.baseline.value;
        var by = PT + ih - (bl / maxV) * ih;
        barsLayer.appendChild(E("line", {
          x1: PL, y1: by, x2: W - PR, y2: by,
          stroke: "#fbbf24", "stroke-width": 1.6, "stroke-dasharray": "7 5", opacity: 0.85
        }));
        barsLayer.appendChild(E("text", {
          x: W - PR, y: by - 6, "text-anchor": "end", "font-size": 11.5,
          fill: "#fbbf24", "font-family": "var(--font-mono)"
        }, [opts.baseline.label]));
      }

      labels.forEach(function (lb, i) {
        var cx = PL + groupW * i + groupW / 2;
        barsLayer.appendChild(E("text", { x: cx, y: H - PB + 16, "text-anchor": "middle", "font-size": 12, fill: "#93a0b8" }, [String(lb)]));

        if (stacked) {
          var acc = 0;
          series.forEach(function (s) {
            var v = s.values[i] || 0;
            var hh = v / maxV * ih;
            var y = PT + ih - acc - hh;
            var rect = E("rect", {
              x: cx - barW / 2, y: y, width: barW, height: hh, rx: 2,
              fill: s.color, opacity: 0.88,
              "data-tip": "<span class='tip-k'>" + s.name + "</span>：" + fmt(v) + (opts.unit || "") + "<br>" + lb
            });
            rect.appendChild(E("animate", { attributeName: "height", from: 0, to: hh, dur: "0.7s", begin: (0.1 + i * 0.05) + "s", fill: "freeze" }));
            rect.appendChild(E("animate", { attributeName: "y", from: PT + ih, to: y, dur: "0.7s", begin: (0.1 + i * 0.05) + "s", fill: "freeze" }));
            barsLayer.appendChild(rect);
            acc += hh;
          });
        } else {
          series.forEach(function (s, si) {
            var v = s.values[i] || 0;
            var hh = v / maxV * ih;
            var x = cx - (barW * series.length) / 2 + barW * si;
            var y = PT + ih - hh;
            var rect = E("rect", {
              x: x, y: y, width: barW - 3, height: hh, rx: 2,
              fill: s.color, opacity: 0.88,
              "data-tip": "<span class='tip-k'>" + s.name + "</span>：" + fmt(v) + (opts.unit || "") + "<br>" + lb
            });
            rect.appendChild(E("animate", { attributeName: "height", from: 0, to: hh, dur: "0.7s", begin: (0.1 + i * 0.06 + si * 0.04) + "s", fill: "freeze" }));
            rect.appendChild(E("animate", { attributeName: "y", from: PT + ih, to: y, dur: "0.7s", begin: (0.1 + i * 0.06 + si * 0.04) + "s", fill: "freeze" }));
            barsLayer.appendChild(rect);
          });
        }
      });

      /* 图例（动态） */
      if (series.length >= 2) {
        var lx = W / 2 - 20;
        series.forEach(function (s) {
          var item = E("g", { transform: "translate(" + lx + "," + (H - 20) + ")" });
          item.appendChild(E("rect", { x: 0, y: -8, width: 14, height: 14, rx: 3, fill: s.color }));
          item.appendChild(E("text", { x: 20, y: 3, "font-size": 12, fill: "#93a0b8" }, [s.name]));
          lx += 34 + s.name.length * 13 + 24;
          legendLayer.appendChild(item);
        });
      }
    }

    render();
    bindTip(el, svg);
    el.appendChild(svg);

    return {
      update: function (newLabels, newSeries) {
        if (newLabels) labels = newLabels;
        if (newSeries) series = newSeries;
        render();
      }
    };
  }

  /* ============================================================
     横向条形图
     opts: labels[], values[], colors?[], unit?, format?
   ============================================================ */
  function hbar(el, opts) {
    var labels = opts.labels || [];
    var values = opts.values || [];
    var H = opts.height || Math.max(180, labels.length * 44 + 30);
    var W = 720;
    var PL = 150, PR = 80, PT = 12, PB = 10;
    var iw = W - PL - PR, ih = H - PT - PB;
    var maxV = niceMax(Math.max.apply(null, values));

    var b = base({ width: W, height: H });
    var svg = b.svg;

    labels.forEach(function (lb, i) {
      var y = PT + ih * (i + 0.5) / labels.length;
      var rowH = clamp(ih / labels.length * 0.5, 12, 26);
      var v = values[i];
      var bw = v / maxV * iw;
      var color = (opts.colors && opts.colors[i]) || PALETTE[i % PALETTE.length];
      svg.appendChild(E("text", { x: PL - 12, y: y + 4, "text-anchor": "end", "font-size": 12.5, fill: "#93a0b8" }, [String(lb)]));
      if (!opts.clean) {
        svg.appendChild(E("line", { x1: PL, y1: y, x2: W - PR, y2: y, stroke: "rgba(255,255,255,0.05)" }));
      }
      var rect = E("rect", {
        x: PL, y: y - rowH / 2, width: bw, height: rowH, rx: rowH / 2,
        fill: color, opacity: 0.9,
        "data-tip": "<span class='tip-k'>" + lb + "</span>：" + fmt(v) + (opts.unit || "")
      });
      rect.appendChild(E("animate", { attributeName: "width", from: 0, to: bw, dur: "0.7s", begin: (0.1 + i * 0.07) + "s", fill: "freeze" }));
      svg.appendChild(rect);
      svg.appendChild(E("text", {
        x: PL + bw + 8, y: y + 4, "font-size": 12, fill: "#e8edf7", "font-family": "var(--font-mono)"
      }, [(opts.format || fmt)(v) + (opts.unit || "")]));
    });

    bindTip(el, svg);
    el.appendChild(svg);
  }

  /* ============================================================
     折线 / 面积图
     opts: labels[], series[{name, values, color?}], area?,
           unit?, format?
   ============================================================ */
  function line(el, opts) {
    var labels = opts.labels || [];
    var series = opts.series || [];
    var H = opts.height || 300;
    var W = 720;
    var PL = 44, PR = 14, PT = 16, PB = 40;
    var iw = W - PL - PR, ih = H - PT - PB;
    var maxV = 0;
    series.forEach(function (s) { s.values.forEach(function (v) { if (v > maxV) maxV = v; }); });
    maxV = niceMax(maxV);
    series.forEach(function (s, si) { s.color = s.color || PALETTE[si % PALETTE.length]; });

    var b = base({ width: W, height: H });
    var svg = b.svg;

    if (!opts.clean) {
      for (var gi = 0; gi <= 4; gi++) {
        var gy = PT + ih - (ih * gi / 4);
        svg.appendChild(E("line", { x1: PL, y1: gy, x2: W - PR, y2: gy, stroke: "rgba(255,255,255,0.07)" }));
        svg.appendChild(E("text", { x: PL - 8, y: gy + 4, "text-anchor": "end", "font-size": 11, fill: "#5d6b85" }, [fmt(maxV * gi / 4, 1)]));
      }
    }

    var n = labels.length;
    var step = n > 1 ? iw / (n - 1) : iw;
    function X(i) { return PL + step * i; }
    function Y(v) { return PT + ih - (v / maxV) * ih; }

    labels.forEach(function (lb, i) {
      var lx = X(i);
      if (i === 0 || i === n - 1 || n <= 8) {
        svg.appendChild(E("text", { x: lx, y: H - PB + 16, "text-anchor": "middle", "font-size": 11.5, fill: "#93a0b8" }, [String(lb)]));
      }
    });

    series.forEach(function (s, si) {
      var pts = s.values.map(function (v, i) { return X(i) + "," + Y(v); }).join(" ");
      var areaPts = (PL + "," + (PT + ih)) + " " + pts + " " + (X(n - 1) + "," + (PT + ih));

      if (opts.area !== false) {
        var area = E("polygon", { points: areaPts, fill: s.color, opacity: 0.12 });
        area.appendChild(E("animate", { attributeName: "opacity", from: 0, to: 0.12, dur: "1.2s", begin: (0.4 + si * 0.15) + "s", fill: "freeze" }));
        svg.appendChild(area);
      }

      var path = E("path", {
        d: "M" + pts.replace(/ /g, "L"),
        fill: "none", stroke: s.color, "stroke-width": 2.5, "stroke-linecap": "round", "stroke-linejoin": "round",
        "stroke-dasharray": 4000, "stroke-dashoffset": 4000
      });
      path.appendChild(E("animate", { attributeName: "stroke-dashoffset", from: 4000, to: 0, dur: "1.4s", begin: (0.15 + si * 0.15) + "s", fill: "freeze" }));
      svg.appendChild(path);

      s.values.forEach(function (v, i) {
        var c = E("circle", {
          cx: X(i), cy: Y(v), r: 3.5, fill: s.color,
          "data-tip": "<span class='tip-k'>" + s.name + "</span>：" + fmt(v) + (opts.unit || "") + "<br>" + labels[i]
        });
        c.appendChild(E("animate", { attributeName: "opacity", from: 0, to: 1, dur: "0.3s", begin: (0.5 + i * 0.03 + si * 0.15) + "s", fill: "freeze" }));
        svg.appendChild(c);
      });
    });

    legend(svg, series, W, H);
    bindTip(el, svg);
    el.appendChild(svg);
  }

  /* ============================================================
     雷达图
     opts: labels[], series[{name, values, color?}], max?
   ============================================================ */
  function radar(el, opts) {
    var labels = opts.labels || [];
    var series = opts.series || [];
    var W = 620, H = 440;
    var cx = W / 2, cy = H / 2 - 10;
    var R = Math.min(W, H) / 2 - 66;
    var maxV = opts.max || 1;
    series.forEach(function (s) { s.values.forEach(function (v) { if (v > maxV) maxV = v; }); });
    maxV = niceMax(maxV);
    series.forEach(function (s, si) { s.color = s.color || PALETTE[si % PALETTE.length]; });

    var b = base({ width: W, height: H });
    var svg = b.svg;

    function P(i, r) {
      var ang = -Math.PI / 2 + (2 * Math.PI * i) / labels.length;
      return [cx + r * Math.cos(ang), cy + r * Math.sin(ang)];
    }

    /* 网格环 */
    for (var ring = 1; ring <= 4; ring++) {
      var rr = R * ring / 4;
      var pts = labels.map(function (_, i) { return P(i, rr).join(","); }).join(" ");
      svg.appendChild(E("polygon", { points: pts, fill: "none", stroke: "rgba(255,255,255,0.08)", "stroke-width": 1 }));
    }
    /* 轴线 + 标签 */
    labels.forEach(function (lb, i) {
      var p = P(i, R);
      svg.appendChild(E("line", { x1: cx, y1: cy, x2: p[0], y2: p[1], stroke: "rgba(255,255,255,0.07)" }));
      var lp = P(i, R + 24);
      svg.appendChild(E("text", { x: lp[0], y: lp[1] + 4, "text-anchor": "middle", "font-size": 12, fill: "#93a0b8" }, [String(lb)]));
    });

    /* 数据多边形 */
    series.forEach(function (s, si) {
      var pts = s.values.map(function (v, i) { return P(i, v / maxV * R).join(","); }).join(" ");
      var poly = E("polygon", { points: pts, fill: s.color, opacity: 0.18, stroke: s.color, "stroke-width": 2, "stroke-linejoin": "round" });
      poly.appendChild(E("animate", { attributeName: "opacity", from: 0, to: 0.18, dur: "0.8s", begin: (0.2 + si * 0.2) + "s", fill: "freeze" }));
      svg.appendChild(poly);

      s.values.forEach(function (v, i) {
        var p = P(i, v / maxV * R);
        var c = E("circle", {
          cx: p[0], cy: p[1], r: 3.5, fill: s.color,
          "data-tip": "<span class='tip-k'>" + s.name + "</span>：" + fmt(v, 1) + "<br>" + labels[i]
        });
        c.appendChild(E("animate", { attributeName: "opacity", from: 0, to: 1, dur: "0.3s", begin: (0.6 + si * 0.2) + "s", fill: "freeze" }));
        svg.appendChild(c);
      });
    });

    legend(svg, series, W, H);
    bindTip(el, svg);
    el.appendChild(svg);
  }

  /* ============================================================
     热力图（矩阵）
     opts: rows[], cols[], values[][], colors?[c1,c2], unit?
   ============================================================ */
  function heatmap(el, opts) {
    var rows = opts.rows || [], cols = opts.cols || [], values = opts.values || [];
    var c1 = (opts.colors && opts.colors[0]) || "#0c1a33";
    var c2 = (opts.colors && opts.colors[1]) || "#38bdf8";
    var cellH = 30, cellW = 62, rowLab = 110, colLab = 30, pad = 8;
    var W = rowLab + cellW * cols.length + pad * 2 + 20;
    var H = colLab + cellH * rows.length + pad * 2 + 20;
    var maxV = 0;
    values.forEach(function (r) { r.forEach(function (v) { if (v > maxV) maxV = v; }); });
    if (maxV === 0) maxV = 1;
    /* rowScale：每行按行内最大值归一化（跨量纲指标对比用） */
    var rowMaxes = values.map(function (r) {
      return Math.max.apply(null, r.map(function (v) { return v || 0; }));
    });

    var b = base({ width: W, height: H });
    var svg = b.svg;

    cols.forEach(function (c, i) {
      svg.appendChild(E("text", {
        x: rowLab + cellW * i + cellW / 2, y: colLab - 8,
        "text-anchor": "middle", "font-size": 12, fill: "#93a0b8"
      }, [String(c)]));
    });

    rows.forEach(function (r, ri) {
      svg.appendChild(E("text", {
        x: rowLab - 8, y: colLab + cellH * ri + cellH / 2 + 4,
        "text-anchor": "end", "font-size": 12, fill: "#93a0b8"
      }, [String(r)]));
      cols.forEach(function (c, ci) {
        var v = values[ri][ci] || 0;
        var rmx = opts.rowScale ? rowMaxes[ri] : maxV;
        var t = rmx > 0 ? v / rmx : 0;
        var rect = E("rect", {
          x: rowLab + cellW * ci + 1, y: colLab + cellH * ri + 1,
          width: cellW - 2, height: cellH - 2, rx: 4,
          fill: v === 0 ? "rgba(255,255,255,0.03)" : mixColor(c1, c2, t),
          stroke: "rgba(255,255,255,0.06)",
          "data-tip": "<span class='tip-k'>" + r + " × " + c + "</span>：" + fmt(v) + (opts.unit || "")
        });
        rect.appendChild(E("animate", { attributeName: "opacity", from: 0, to: 1, dur: "0.4s", begin: (0.15 + (ri * cols.length + ci) * 0.02) + "s", fill: "freeze" }));
        svg.appendChild(rect);
        if (v > 0) {
          svg.appendChild(E("text", {
            x: rowLab + cellW * ci + cellW / 2, y: colLab + cellH * ri + cellH / 2 + 4,
            "text-anchor": "middle", "font-size": 11.5, fill: t > 0.55 ? "#06121f" : "#cfe6f7"
          }, [fmt(v)]));
        }
      });
    });

    bindTip(el, svg);
    el.appendChild(svg);
  }

  /* ============================================================
     环形图
     opts: labels[], values[], colors?[], centerText?, format?
   ============================================================ */
  function donut(el, opts) {
    var labels = opts.labels || [], values = opts.values || [];
    var W = 420, H = 320, cx = W / 2 - 60, cy = H / 2 - 10, R = 96, sw = 34;
    var total = values.reduce(function (a, v) { return a + v; }, 0);
    var colors = opts.colors || PALETTE;
    var C = 2 * Math.PI * R;

    var b = base({ width: W, height: H });
    var svg = b.svg;

    var acc = 0;
    values.forEach(function (v, i) {
      var frac = total > 0 ? v / total : 0;
      var len = frac * C;
      var offset = -acc * C;
      acc += frac;
      var c = colors[i % colors.length];
      var seg = E("circle", {
        cx: cx, cy: cy, r: R, fill: "none", stroke: c, "stroke-width": sw,
        "stroke-dasharray": len + " " + (C - len),
        "stroke-dashoffset": offset, "stroke-linecap": "butt", opacity: 0.92,
        transform: "rotate(-90 " + cx + " " + cy + ")",
        "data-tip": "<span class='tip-k'>" + labels[i] + "</span>：" + fmt(v) + "（" + (frac * 100).toFixed(1) + "%）"
      });
      seg.appendChild(E("animate", { attributeName: "stroke-dashoffset", from: -acc * C, to: offset, dur: "0.9s", begin: (0.15 + i * 0.08) + "s", fill: "freeze" }));
      svg.appendChild(seg);
    });

    if (opts.centerText) {
      svg.appendChild(E("text", { x: cx, y: cy - 6, "text-anchor": "middle", "font-size": 24, "font-weight": 800, fill: "#e8edf7", "font-family": "var(--font-mono)" }, [opts.centerText]));
      svg.appendChild(E("text", { x: cx, y: cy + 16, "text-anchor": "middle", "font-size": 11, fill: "#93a0b8" }, [opts.centerLabel || ""]));
    }

    /* 图例（右侧） */
    var lx = W - 120, ly = cy - (labels.length * 24) / 2;
    labels.forEach(function (lb, i) {
      var y = ly + i * 24;
      svg.appendChild(E("rect", { x: lx, y: y - 9, width: 12, height: 12, rx: 3, fill: colors[i % colors.length] }));
      svg.appendChild(E("text", { x: lx + 18, y: y + 1, "font-size": 12.5, fill: "#93a0b8" }, [lb]));
      svg.appendChild(E("text", {
        x: lx + 18, y: y + 16, "font-size": 11, fill: "#5d6b85", "font-family": "var(--font-mono)"
      }, [fmt(values[i]) + " · " + (total > 0 ? (values[i] / total * 100).toFixed(1) : "0") + "%"]));
    });

    bindTip(el, svg);
    el.appendChild(svg);
  }

  /* ============================================================
     CSS 词云（容器渲染 div）
     opts: words[{text, weight, color?}], maxSize?, minSize?
   ============================================================ */
  function tagcloud(el, opts) {
    var words = opts.words || [];
    var maxSize = opts.maxSize || 30, minSize = opts.minSize || 12;
    var maxW = 1;
    words.forEach(function (w) { if (w.weight > maxW) maxW = w.weight; });
    var box = document.createElement("div");
    box.className = "tagcloud";
    words.forEach(function (w, i) {
      var s = minSize + (w.weight / maxW) * (maxSize - minSize);
      var sp = document.createElement("span");
      sp.textContent = w.text;
      sp.style.fontSize = s.toFixed(1) + "px";
      sp.style.opacity = "0";
      sp.style.transition = "opacity 0.5s";
      sp.style.color = w.color || PALETTE[i % PALETTE.length];
      box.appendChild(sp);
      setTimeout(function () { sp.style.opacity = "1"; }, 200 + i * 40);
    });
    el.appendChild(box);
  }

  /* ============================================================
     对比雷达图（交互版 · 平方变换）
     opts: labels[], base[]（市场平均渗透率 0-1）, brands[{name,values,color?,note?}],
           active[], width?, height?
     数值 = (渗透率×100)²，满分 10000——90 vs 93 这类高分区的小差距
     平方后拉开（8100 vs 8649），低分区保持紧凑。基准多边形 = 市场平均²。
     返回 { update(names) } 支持动态切换。
   ============================================================ */
  function radarCompare(el, opts) {
    var labels = opts.labels || [];
    var baseVals = opts.base || [];
    var brands = opts.brands || [];
    var W = opts.width || 680, H = opts.height || 520;
    var cx = W / 2, cy = H / 2 - 12;
    var R = Math.min(W, H) / 2 - 92;
    var n = labels.length;
    var byName = {};
    brands.forEach(function (b) { byName[b.name] = b; });

    function sq(v) { return v * 100 * v * 100; } /* 渗透率 → 平方分（0-10000） */

    function P(i, sqv) {
      var ang = -Math.PI / 2 + (2 * Math.PI * i) / n;
      return [cx + R * (sqv / 10000) * Math.cos(ang), cy + R * (sqv / 10000) * Math.sin(ang)];
    }

    var b = base({ width: W, height: H });
    var svg = b.svg;

    /* 基准环（市场平均²，虚线，无标注） */
    var basePts = labels.map(function (_, i) { return P(i, sq(baseVals[i])).join(","); }).join(" ");
    svg.appendChild(E("polygon", {
      points: basePts, fill: "none", stroke: "rgba(255,255,255,0.4)",
      "stroke-width": 1.6, "stroke-dasharray": "6 4"
    }));

    /* 轴线 + 领域标签 */
    labels.forEach(function (lb, i) {
      svg.appendChild(E("line", { x1: cx, y1: cy, x2: P(i, 0)[0], y2: P(i, 0)[1], stroke: "rgba(255,255,255,0.05)" }));
      var lp = P(i, 10000);
      var tx = lp[0] >= cx ? lp[0] + 6 : lp[0] - 6;
      svg.appendChild(E("text", { x: tx, y: lp[1] + 4, "text-anchor": lp[0] >= cx ? "start" : "end", "font-size": 13, fill: "#e8edf7", "font-weight": 600 }, [String(lb)]));
    });

    var dynLayer = E("g", {});
    svg.appendChild(dynLayer);

    function renderPolygon(name) {
      var br = byName[name];
      if (!br) return;
      var color = br.color || PALETTE[Object.keys(byName).indexOf(name) % PALETTE.length];
      var pts = br.values.map(function (v, i) { return P(i, sq(v)).join(","); }).join(" ");
      var g = E("g", { "data-brand": name });
      var poly = E("polygon", {
        points: pts, fill: color, opacity: 0.14, stroke: color, "stroke-width": 2.6, "stroke-linejoin": "round"
      });
      poly.appendChild(E("animate", { attributeName: "opacity", from: 0, to: 0.14, dur: "0.6s", begin: "0.1s", fill: "freeze" }));
      g.appendChild(poly);
      br.values.forEach(function (v, i) {
        var p = P(i, sq(v));
        var c = E("circle", {
          cx: p[0], cy: p[1], r: 3.4, fill: color, stroke: "rgba(7,11,20,0.95)", "stroke-width": 1.2,
          "data-tip": "<span class='tip-k'>" + name + "</span> · " + labels[i] + "<br>渗透 " + (v * 100).toFixed(1) + "% vs 平均 " + (baseVals[i] * 100).toFixed(1) + "%（平方分 " + Math.round(sq(v)) + " / " + Math.round(sq(baseVals[i])) + "）"
        });
        c.appendChild(E("animate", { attributeName: "opacity", from: 0, to: 1, dur: "0.3s", begin: "0.35s", fill: "freeze" }));
        g.appendChild(c);
      });
      dynLayer.appendChild(g);
    }

    function renderAll(names) {
      while (dynLayer.firstChild) dynLayer.removeChild(dynLayer.firstChild);
      names.forEach(function (nm) { renderPolygon(nm); });
      renderLegend(names);
    }

    /* 底部图例（色块 + 品牌名，超宽自动换行） */
    var legendLayer = E("g", {});
    svg.appendChild(legendLayer);
    function renderLegend(names) {
      while (legendLayer.firstChild) legendLayer.removeChild(legendLayer.firstChild);
      var y = H - 14;
      var x = 10;
      names.forEach(function (nm) {
        var br = byName[nm];
        if (!br) return;
        var color = br.color || PALETTE[Object.keys(byName).indexOf(nm) % PALETTE.length];
        var label = nm;
        var w = 30 + label.length * 13;
        if (x + w > W - 10) { x = 10; y -= 20; }
        legendLayer.appendChild(E("rect", { x: x, y: y - 9, width: 13, height: 13, rx: 3, fill: color }));
        legendLayer.appendChild(E("text", { x: x + 18, y: y + 1, "font-size": 13, fill: "#e2eaf8", "font-weight": 600 }, [label]));
        x += w;
      });
    }

    renderAll(opts.active || []);
    bindTip(el, svg);
    el.appendChild(svg);

    return {
      update: function (names) { renderAll(names); },
      brands: brands.map(function (b) { return b.name; })
    };
  }

  /* ---------- 导出 ---------- */
  global.Chart = { bar: bar, hbar: hbar, line: line, radar: radar, radarCompare: radarCompare, heatmap: heatmap, donut: donut, tagcloud: tagcloud };
})(window);
