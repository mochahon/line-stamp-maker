/* Image processing core: background removal, trimming, sheet splitting.
 * Everything runs locally on canvas pixel data. The original illustration is
 * never redrawn — pixels are only removed (alpha) or cropped, never repainted. */
(function (global) {
  'use strict';

  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  function imageToCanvas(img) {
    var c = makeCanvas(img.naturalWidth || img.width, img.naturalHeight || img.height);
    c.getContext('2d').drawImage(img, 0, 0);
    return c;
  }

  function cloneCanvas(src) {
    var c = makeCanvas(src.width, src.height);
    c.getContext('2d').drawImage(src, 0, 0);
    return c;
  }

  function loadImage(blob) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () {
        var c = imageToCanvas(img);
        URL.revokeObjectURL(url);
        resolve(c);
      };
      img.onerror = function (e) {
        URL.revokeObjectURL(url);
        reject(e);
      };
      img.src = url;
    });
  }

  /** Median color of the four corners (samples 6x6 patches). */
  function sampleBackgroundColor(canvas) {
    var ctx = canvas.getContext('2d');
    var w = canvas.width, h = canvas.height;
    var pts = [[0, 0], [w - 6, 0], [0, h - 6], [w - 6, h - 6]];
    var rs = 0, gs = 0, bs = 0, n = 0;
    pts.forEach(function (p) {
      var d = ctx.getImageData(Math.max(0, p[0]), Math.max(0, p[1]),
        Math.min(6, w), Math.min(6, h)).data;
      for (var i = 0; i < d.length; i += 4) {
        if (d[i + 3] > 10) { rs += d[i]; gs += d[i + 1]; bs += d[i + 2]; n++; }
      }
    });
    if (!n) return { r: 255, g: 255, b: 255 };
    return { r: rs / n, g: gs / n, b: bs / n };
  }

  function colorDist(r, g, b, bg) {
    var dr = r - bg.r, dg = g - bg.g, db = b - bg.b;
    return Math.sqrt(dr * dr + dg * dg + db * db);
  }

  /**
   * Remove background connected to the image borders.
   * tolerance: 0..100 (mapped to a color-distance threshold).
   * Only border-connected pixels similar to the sampled background color are
   * made transparent, so same-colored areas inside the character survive.
   */
  function removeBackground(canvas, tolerance) {
    var w = canvas.width, h = canvas.height;
    var ctx = canvas.getContext('2d');
    var img = ctx.getImageData(0, 0, w, h);
    var d = img.data;
    var bg = sampleBackgroundColor(canvas);
    var threshold = 12 + (tolerance / 100) * 140;
    var visited = new Uint8Array(w * h);
    var stack = [];
    function tryPush(x, y) {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      var idx = y * w + x;
      if (visited[idx]) return;
      visited[idx] = 1;
      var o = idx * 4;
      if (d[o + 3] < 10 || colorDist(d[o], d[o + 1], d[o + 2], bg) <= threshold) stack.push(idx);
    }
    var x, y;
    for (x = 0; x < w; x++) { tryPush(x, 0); tryPush(x, h - 1); }
    for (y = 0; y < h; y++) { tryPush(0, y); tryPush(w - 1, y); }
    while (stack.length) {
      var cur = stack.pop();
      var o = cur * 4;
      d[o + 3] = 0;
      var cx = cur % w, cy = (cur / w) | 0;
      tryPush(cx + 1, cy); tryPush(cx - 1, cy); tryPush(cx, cy + 1); tryPush(cx, cy - 1);
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  /** Bounding box of pixels with alpha >= threshold. Returns null if empty. */
  function contentBounds(canvas, threshold) {
    var w = canvas.width, h = canvas.height;
    var d = canvas.getContext('2d').getImageData(0, 0, w, h).data;
    var minX = w, minY = h, maxX = -1, maxY = -1;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        if (d[(y * w + x) * 4 + 3] >= threshold) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null;
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  }

  function cropCanvas(canvas, rect) {
    var c = makeCanvas(rect.w, rect.h);
    c.getContext('2d').drawImage(canvas, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
    return c;
  }

  /** Remove transparent margins. Returns a new canvas (or the same if empty). */
  function trimCanvas(canvas, threshold) {
    var b = contentBounds(canvas, threshold == null ? 8 : threshold);
    if (!b) return canvas;
    if (b.x === 0 && b.y === 0 && b.w === canvas.width && b.h === canvas.height) return canvas;
    return cropCanvas(canvas, b);
  }

  /**
   * Detect split lines on one axis by looking for "gutter" bands: rows/columns
   * where almost every pixel matches the background (or is transparent).
   * Returns an array of fractions (0..1) for the inner lines, or null.
   */
  function detectLines(canvas, axis, expected) {
    var w = canvas.width, h = canvas.height;
    var d = canvas.getContext('2d').getImageData(0, 0, w, h).data;
    var bg = sampleBackgroundColor(canvas);
    var len = axis === 'x' ? w : h;
    var cross = axis === 'x' ? h : w;
    var profile = new Float32Array(len);
    var i, j;
    for (i = 0; i < len; i++) {
      var bgCount = 0;
      // sample every 2nd pixel across for speed
      for (j = 0; j < cross; j += 2) {
        var px = axis === 'x' ? i : j;
        var py = axis === 'x' ? j : i;
        var o = (py * w + px) * 4;
        if (d[o + 3] < 10 || colorDist(d[o], d[o + 1], d[o + 2], bg) < 24) bgCount++;
      }
      profile[i] = bgCount / Math.ceil(cross / 2);
    }
    // content bands: stretches where profile < 0.985
    var bands = [];
    var start = -1;
    for (i = 0; i < len; i++) {
      if (profile[i] < 0.985 && start < 0) start = i;
      if ((profile[i] >= 0.985 || i === len - 1) && start >= 0) {
        bands.push([start, i]);
        start = -1;
      }
    }
    // merge bands separated by tiny gaps (< 0.8% of length)
    var merged = [];
    bands.forEach(function (b) {
      var last = merged[merged.length - 1];
      if (last && b[0] - last[1] < len * 0.008) last[1] = b[1];
      else merged.push([b[0], b[1]]);
    });
    // drop sliver bands (< 2% of length)
    merged = merged.filter(function (b) { return b[1] - b[0] > len * 0.02; });
    if (expected && merged.length !== expected) return null;
    if (merged.length < 2) return null;
    var lines = [];
    for (i = 0; i < merged.length - 1; i++) {
      lines.push((merged[i][1] + merged[i + 1][0]) / 2 / len);
    }
    return lines;
  }

  /** Split a canvas by line fractions. linesX/linesY: arrays of 0..1. */
  function splitCanvas(canvas, linesX, linesY) {
    var xs = [0].concat(linesX, [1]);
    var ys = [0].concat(linesY, [1]);
    var cells = [];
    for (var r = 0; r < ys.length - 1; r++) {
      for (var c = 0; c < xs.length - 1; c++) {
        var x0 = Math.round(xs[c] * canvas.width);
        var x1 = Math.round(xs[c + 1] * canvas.width);
        var y0 = Math.round(ys[r] * canvas.height);
        var y1 = Math.round(ys[r + 1] * canvas.height);
        if (x1 - x0 < 4 || y1 - y0 < 4) continue;
        cells.push(cropCanvas(canvas, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }));
      }
    }
    return cells;
  }

  function evenCeil(n) { n = Math.max(2, Math.round(n)); return n % 2 ? n + 1 : n; }

  /**
   * Output size for a stamp: fit content (cw x ch) inside (maxW x maxH)
   * leaving `pad` px of margin on the long sides, dimensions even (LINE rule).
   */
  function stampSize(cw, ch, maxW, maxH, pad) {
    var availW = maxW - pad * 2, availH = maxH - pad * 2;
    var scale = Math.min(availW / cw, availH / ch);
    var w = Math.min(maxW, evenCeil(cw * scale + pad * 2));
    var h = Math.min(maxH, evenCeil(ch * scale + pad * 2));
    return { w: w, h: h, scale: scale };
  }

  global.StampEditor = {
    makeCanvas: makeCanvas,
    loadImage: loadImage,
    cloneCanvas: cloneCanvas,
    sampleBackgroundColor: sampleBackgroundColor,
    removeBackground: removeBackground,
    contentBounds: contentBounds,
    cropCanvas: cropCanvas,
    trimCanvas: trimCanvas,
    detectLines: detectLines,
    splitCanvas: splitCanvas,
    stampSize: stampSize
  };
})(window);
