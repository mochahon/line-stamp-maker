/* LINE Stamp Maker — main application logic.
 * All processing is local. Project data lives in IndexedDB on this device. */
(function () {
  'use strict';
  var E = window.StampEditor;
  var MAX_W = 370, MAX_H = 320;
  var PHRASES = ['ありがとう', 'おつかれさま', 'おはよう', 'おやすみ', '了解！', 'いいね！',
    'ごめんね', '大好き', 'がんばれ', 'おめでとう', 'よろしくね', 'バイバイ', 'すごい！',
    '笑', '泣', '怒', '眠い…', 'お腹すいた', '行ってきます', 'おかえり', '助かる〜', '神！', 'www'];

  var state = {
    setSize: 24,
    stamps: [],
    selected: null,
    mainSource: 0,
    reorder: false,
    bulkMode: false,
    bulkSel: {}
  };
  var brushMode = null; // 'erase' | 'restore' | null
  var activeTextId = null;
  var uid = 1;

  function $(id) { return document.getElementById(id); }
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () { t.hidden = true; }, 2600);
  }

  /* ---------------- stamp model ---------------- */
  function newStamp(origCanvas, imgCanvas) {
    return {
      orig: origCanvas,
      img: imgCanvas,
      scale: 1, rot: 0, pad: 10, dx: 0, dy: 0,
      texts: [],
      undoStack: [], redoStack: []
    };
  }
  function cur() {
    return state.selected == null ? null : state.stamps[state.selected];
  }
  function pushUndo(st) {
    st.undoStack.push(E.cloneCanvas(st.img));
    if (st.undoStack.length > 15) st.undoStack.shift();
    st.redoStack.length = 0;
    syncUndoBtns();
  }
  function syncUndoBtns() {
    var st = cur();
    $('undoBtn').disabled = !st || !st.undoStack.length;
    $('redoBtn').disabled = !st || !st.redoStack.length;
  }

  /* ---------------- composition ---------------- */
  function fitScale(st) {
    var pad = st.pad;
    var s0 = Math.min((MAX_W - pad * 2) / st.img.width, (MAX_H - pad * 2) / st.img.height);
    return s0 * st.scale;
  }
  function compose(st, forExport) {
    var s = fitScale(st);
    var w = Math.min(MAX_W, Math.max(2, Math.round(st.img.width * s + st.pad * 2)));
    var h = Math.min(MAX_H, Math.max(2, Math.round(st.img.height * s + st.pad * 2)));
    if (w % 2) w -= 1;
    if (h % 2) h -= 1;
    var c = E.makeCanvas(w, h);
    var ctx = c.getContext('2d');
    ctx.save();
    ctx.translate(w / 2 + st.dx, h / 2 + st.dy);
    ctx.rotate(st.rot * Math.PI / 180);
    ctx.drawImage(st.img, -st.img.width * s / 2, -st.img.height * s / 2, st.img.width * s, st.img.height * s);
    ctx.restore();
    var sf = w / MAX_W;
    st.texts.forEach(function (t) { drawText(ctx, t, w, h, sf); });
    return c;
  }
  function drawText(ctx, t, W, H, sf) {
    ctx.save();
    ctx.translate(t.x * W, t.y * H);
    ctx.rotate(t.rot * Math.PI / 180);
    var size = t.size * sf;
    ctx.font = '700 ' + size + 'px ' + t.font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    if (t.shadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = 4 * sf;
      ctx.shadowOffsetY = 2 * sf;
    }
    var lines = String(t.text).split('\n');
    if (t.vertical) {
      var chars = String(t.text).replace(/\n/g, '').split('');
      chars.forEach(function (ch, i) {
        var y = (i - (chars.length - 1) / 2) * size * 1.08;
        strokeFill(ctx, ch, 0, y, t, sf);
      });
    } else {
      lines.forEach(function (line, i) {
        var y = (i - (lines.length - 1) / 2) * size * 1.15;
        strokeFill(ctx, line, 0, y, t, sf);
      });
    }
    ctx.restore();
  }
  function strokeFill(ctx, str, x, y, t, sf) {
    if (t.strokeWidth > 0) {
      var keepShadow = ctx.shadowColor;
      ctx.shadowColor = 'transparent';
      ctx.lineWidth = t.strokeWidth * sf * 2;
      ctx.strokeStyle = t.strokeColor;
      ctx.strokeText(str, x, y);
      ctx.shadowColor = keepShadow;
    }
    ctx.fillStyle = t.color;
    ctx.fillText(str, x, y);
  }

  /* ---------------- persistence ---------------- */
  var saveTimer = null;
  function scheduleSave() {
    $('saveState').textContent = '保存中…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveProject, 700);
  }
  function canvasToBlob(c) {
    return new Promise(function (res) { c.toBlob(res, 'image/png'); });
  }
  function serialize() {
    var jobs = state.stamps.map(function (st) {
      if (!st) return Promise.resolve(null);
      return Promise.all([canvasToBlob(st.orig), canvasToBlob(st.img)]).then(function (b) {
        return {
          orig: b[0], img: b[1], scale: st.scale, rot: st.rot, pad: st.pad,
          dx: st.dx, dy: st.dy, texts: st.texts
        };
      });
    });
    return Promise.all(jobs).then(function (stamps) {
      return { v: 1, setSize: state.setSize, mainSource: state.mainSource, stamps: stamps };
    });
  }
  function saveProject() {
    serialize().then(function (data) {
      return StampDB.set('project', data);
    }).then(function () {
      $('saveState').textContent = '自動保存しました（' + new Date().toLocaleTimeString('ja-JP') + '）';
    }).catch(function () {
      $('saveState').textContent = '保存に失敗しました。バックアップの書き出しをおすすめします';
    });
  }
  function restoreProject(data) {
    if (!data || !data.stamps) return Promise.resolve();
    state.setSize = data.setSize || 24;
    state.mainSource = data.mainSource || 0;
    var jobs = data.stamps.map(function (s) {
      if (!s) return Promise.resolve(null);
      return Promise.all([E.loadImage(s.orig), E.loadImage(s.img)]).then(function (cs) {
        var st = newStamp(cs[0], cs[1]);
        st.scale = s.scale; st.rot = s.rot; st.pad = s.pad;
        st.dx = s.dx; st.dy = s.dy; st.texts = s.texts || [];
        st.texts.forEach(function (t) { if (t.id >= uid) uid = t.id + 1; });
        return st;
      });
    });
    return Promise.all(jobs).then(function (stamps) {
      state.stamps = stamps;
      while (state.stamps.length < state.setSize) state.stamps.push(null);
      state.stamps.length = state.setSize;
    });
  }

  /* ---------------- views ---------------- */
  function showView(id) {
    ['viewSet', 'viewEdit', 'viewExport'].forEach(function (v) { $(v).hidden = v !== id; });
    document.querySelectorAll('.tabbar .tab').forEach(function (b) {
      b.classList.toggle('active', b.dataset.view === id);
    });
    if (id === 'viewExport') refreshExport();
    if (id === 'viewSet') renderGrid();
    window.scrollTo(0, 0);
  }

  /* ---------------- set grid ---------------- */
  function renderGrid() {
    var grid = $('stampGrid');
    grid.innerHTML = '';
    var filled = 0;
    state.stamps.forEach(function (st, i) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'slot' + (st ? ' filled' : '') + (state.selected === i ? ' selected' : '') +
        (state.bulkSel[i] ? ' bulk-sel' : '');
      btn.dataset.index = i;
      var num = document.createElement('span');
      num.className = 'num';
      num.textContent = String(i + 1).padStart(2, '0');
      btn.appendChild(num);
      if (state.bulkMode && state.bulkSel[i]) {
        var badge = document.createElement('span');
        badge.className = 'check-badge';
        badge.textContent = '✓';
        btn.appendChild(badge);
      }
      if (st) {
        filled++;
        var img = document.createElement('img');
        img.alt = 'スタンプ' + (i + 1);
        img.src = compose(st).toDataURL('image/png');
        btn.appendChild(img);
      } else {
        var plus = document.createElement('span');
        plus.className = 'empty-label';
        plus.textContent = '＋';
        btn.appendChild(plus);
      }
      btn.addEventListener('click', function () {
        if (state.reorder) return;
        if (state.bulkMode) {
          if (!state.stamps[i]) return;
          if (state.bulkSel[i]) delete state.bulkSel[i];
          else state.bulkSel[i] = true;
          syncBulkBar();
          renderGrid();
          return;
        }
        if (st) openEditor(i);
        else { state.selected = i; $('fileInput').click(); }
      });
      grid.appendChild(btn);
    });
    $('setProgress').textContent = filled + ' / ' + state.setSize + ' 個 作成済み';
    $('tabEdit').disabled = state.selected == null || !state.stamps[state.selected];
  }

  /* reorder by drag */
  var dragFrom = null;
  document.addEventListener('pointerdown', function (e) {
    if (!state.reorder) return;
    var slot = e.target.closest('.slot');
    if (slot) { dragFrom = Number(slot.dataset.index); slot.classList.add('dragging'); }
  });
  document.addEventListener('pointerup', function (e) {
    if (!state.reorder || dragFrom == null) return;
    var slot = e.target.closest('.slot');
    document.querySelectorAll('.slot.dragging').forEach(function (s) { s.classList.remove('dragging'); });
    if (slot) {
      var to = Number(slot.dataset.index);
      if (to !== dragFrom) {
        var tmp = state.stamps[dragFrom];
        state.stamps[dragFrom] = state.stamps[to];
        state.stamps[to] = tmp;
        scheduleSave();
      }
    }
    dragFrom = null;
    renderGrid();
  });

  /* ---------------- editor ---------------- */
  var stage = $('stage');
  var sctx = stage.getContext('2d');
  function renderStage() {
    var st = cur();
    if (!st) return;
    var c = compose(st);
    if (stage.width !== c.width || stage.height !== c.height) {
      stage.width = c.width; stage.height = c.height;
    }
    sctx.clearRect(0, 0, stage.width, stage.height);
    sctx.drawImage(c, 0, 0);
    // selection outline for active text
    if (activeTextId != null) {
      var t = st.texts.find(function (x) { return x.id === activeTextId; });
      if (t) {
        var b = textBox(t, stage.width, stage.height);
        sctx.save();
        sctx.strokeStyle = '#f2789f';
        sctx.setLineDash([6, 4]);
        sctx.lineWidth = 2;
        sctx.strokeRect(b.x, b.y, b.w, b.h);
        sctx.restore();
      }
    }
  }
  function textBox(t, W, H) {
    var sf = W / MAX_W;
    var size = t.size * sf;
    var w, h;
    if (t.vertical) {
      w = size * 1.3;
      h = size * 1.08 * String(t.text).replace(/\n/g, '').length;
    } else {
      var lines = String(t.text).split('\n');
      var maxLen = Math.max.apply(null, lines.map(function (l) { return l.length; }));
      w = size * maxLen * 1.02 + t.strokeWidth * sf * 2;
      h = size * 1.15 * lines.length;
    }
    return { x: t.x * W - w / 2, y: t.y * H - h / 2, w: w, h: h };
  }
  function openEditor(i) {
    state.selected = i;
    activeTextId = null;
    brushMode = null;
    $('eraserBtn').classList.remove('active');
    $('restoreBtn').classList.remove('active');
    var st = cur();
    $('editTitle').textContent = 'スタンプ ' + String(i + 1).padStart(2, '0') + ' の編集';
    $('imgScale').value = Math.round(st.scale * 100);
    $('scaleOut').textContent = Math.round(st.scale * 100) + '%';
    $('imgRot').value = st.rot;
    $('rotOut').textContent = st.rot + '°';
    $('imgPad').value = st.pad;
    $('padOut').textContent = st.pad + 'px';
    renderTextList();
    syncUndoBtns();
    showView('viewEdit');
    renderStage();
  }

  /* stage pointer interaction: drag image/text, pinch zoom, brush */
  var pointers = new Map();
  var dragTarget = null; // {type:'img'|'text', id, startX, startY, origX, origY}
  var pinchStart = null;
  var painting = false;

  function stagePos(e) {
    var r = stage.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * stage.width / r.width,
      y: (e.clientY - r.top) * stage.height / r.height
    };
  }
  function sourcePos(p, st) {
    // output coords -> source image coords (undo translate/rotate/scale)
    var s = fitScale(st);
    var cx = stage.width / 2 + st.dx, cy = stage.height / 2 + st.dy;
    var dx = p.x - cx, dy = p.y - cy;
    var rad = -st.rot * Math.PI / 180;
    var rx = dx * Math.cos(rad) - dy * Math.sin(rad);
    var ry = dx * Math.sin(rad) + dy * Math.cos(rad);
    return { x: rx / s + st.img.width / 2, y: ry / s + st.img.height / 2, s: s };
  }
  function paintAt(p, st) {
    var sp = sourcePos(p, st);
    var radius = Number($('brushSize').value) / 2 / sp.s;
    var ctx = st.img.getContext('2d');
    ctx.save();
    if (brushMode === 'erase') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, radius, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, radius, 0, Math.PI * 2);
      ctx.clip();
      ctx.clearRect(sp.x - radius, sp.y - radius, radius * 2, radius * 2);
      ctx.drawImage(st.orig, 0, 0);
    }
    ctx.restore();
  }
  stage.addEventListener('pointerdown', function (e) {
    var st = cur();
    if (!st) return;
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, e);
    var p = stagePos(e);
    if (pointers.size === 2) {
      var pts = Array.from(pointers.values());
      pinchStart = {
        dist: Math.hypot(pts[0].clientX - pts[1].clientX, pts[0].clientY - pts[1].clientY),
        scale: st.scale
      };
      dragTarget = null;
      return;
    }
    if (brushMode) {
      pushUndo(st);
      painting = true;
      paintAt(p, st);
      renderStage();
      return;
    }
    // text hit test (topmost last)
    for (var i = st.texts.length - 1; i >= 0; i--) {
      var t = st.texts[i];
      var b = textBox(t, stage.width, stage.height);
      if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) {
        selectText(t.id);
        dragTarget = { type: 'text', id: t.id, sx: p.x, sy: p.y, ox: t.x, oy: t.y };
        return;
      }
    }
    dragTarget = { type: 'img', sx: p.x, sy: p.y, ox: st.dx, oy: st.dy };
  });
  stage.addEventListener('pointermove', function (e) {
    var st = cur();
    if (!st || !pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, e);
    var p = stagePos(e);
    if (pinchStart && pointers.size === 2) {
      var pts = Array.from(pointers.values());
      var dist = Math.hypot(pts[0].clientX - pts[1].clientX, pts[0].clientY - pts[1].clientY);
      st.scale = Math.min(3, Math.max(0.2, pinchStart.scale * dist / pinchStart.dist));
      $('imgScale').value = Math.round(st.scale * 100);
      $('scaleOut').textContent = Math.round(st.scale * 100) + '%';
      renderStage();
      return;
    }
    if (painting && brushMode) {
      paintAt(p, st);
      renderStage();
      return;
    }
    if (!dragTarget) return;
    if (dragTarget.type === 'img') {
      st.dx = dragTarget.ox + (p.x - dragTarget.sx);
      st.dy = dragTarget.oy + (p.y - dragTarget.sy);
    } else {
      var t = st.texts.find(function (x) { return x.id === dragTarget.id; });
      if (t) {
        t.x = Math.min(1, Math.max(0, dragTarget.ox + (p.x - dragTarget.sx) / stage.width));
        t.y = Math.min(1, Math.max(0, dragTarget.oy + (p.y - dragTarget.sy) / stage.height));
      }
    }
    renderStage();
  });
  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = null;
    if (painting) { painting = false; scheduleSave(); }
    if (dragTarget) { dragTarget = null; scheduleSave(); }
  }
  stage.addEventListener('pointerup', endPointer);
  stage.addEventListener('pointercancel', endPointer);
  stage.addEventListener('wheel', function (e) {
    var st = cur();
    if (!st) return;
    e.preventDefault();
    st.scale = Math.min(3, Math.max(0.2, st.scale * (e.deltaY < 0 ? 1.06 : 0.94)));
    $('imgScale').value = Math.round(st.scale * 100);
    $('scaleOut').textContent = Math.round(st.scale * 100) + '%';
    renderStage();
    scheduleSave();
  }, { passive: false });

  /* ---------------- text editing ---------------- */
  function renderTextList() {
    var st = cur();
    var list = $('textList');
    list.innerHTML = '';
    if (!st) { $('textEditor').hidden = true; return; }
    st.texts.forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'text-item' + (t.id === activeTextId ? ' active' : '');
      b.innerHTML = '<span class="t-label"></span><span>✏️</span>';
      b.querySelector('.t-label').textContent = t.text || '（文字なし）';
      b.addEventListener('click', function () { selectText(t.id); });
      list.appendChild(b);
    });
    if (activeTextId == null) $('textEditor').hidden = true;
  }
  function selectText(id) {
    activeTextId = id;
    var st = cur();
    var t = st && st.texts.find(function (x) { return x.id === id; });
    if (!t) { $('textEditor').hidden = true; return; }
    $('textEditor').hidden = false;
    $('tText').value = t.text;
    $('tFont').value = t.font;
    $('tSize').value = t.size;
    $('tColor').value = t.color;
    $('tStrokeColor').value = t.strokeColor;
    $('tStroke').value = t.strokeWidth;
    $('tShadow').checked = t.shadow;
    $('tVertical').checked = t.vertical;
    $('tRot').value = t.rot;
    renderTextList();
    renderStage();
  }
  function activeText() {
    var st = cur();
    return st ? st.texts.find(function (x) { return x.id === activeTextId; }) : null;
  }
  function addText(str) {
    var st = cur();
    if (!st) return;
    var t = {
      id: uid++, text: str || 'ありがとう',
      font: "'M PLUS Rounded 1c',sans-serif", size: 44,
      color: '#333333', strokeColor: '#ffffff', strokeWidth: 6,
      shadow: true, vertical: false, rot: 0, x: 0.5, y: 0.82
    };
    st.texts.push(t);
    selectText(t.id);
    scheduleSave();
  }
  function bindTextEditor() {
    function upd(fn) {
      return function () {
        var t = activeText();
        if (!t) return;
        fn(t);
        renderTextList();
        renderStage();
        scheduleSave();
      };
    }
    $('tText').addEventListener('input', upd(function (t) { t.text = $('tText').value; }));
    $('tFont').addEventListener('change', upd(function (t) { t.font = $('tFont').value; }));
    $('tSize').addEventListener('input', upd(function (t) { t.size = Number($('tSize').value) || 44; }));
    $('tColor').addEventListener('input', upd(function (t) { t.color = $('tColor').value; }));
    $('tStrokeColor').addEventListener('input', upd(function (t) { t.strokeColor = $('tStrokeColor').value; }));
    $('tStroke').addEventListener('input', upd(function (t) { t.strokeWidth = Number($('tStroke').value); }));
    $('tShadow').addEventListener('change', upd(function (t) { t.shadow = $('tShadow').checked; }));
    $('tVertical').addEventListener('change', upd(function (t) { t.vertical = $('tVertical').checked; }));
    $('tRot').addEventListener('input', upd(function (t) { t.rot = Number($('tRot').value); }));
    $('delTextBtn').addEventListener('click', function () {
      var st = cur();
      if (!st) return;
      st.texts = st.texts.filter(function (x) { return x.id !== activeTextId; });
      activeTextId = null;
      $('textEditor').hidden = true;
      renderTextList();
      renderStage();
      scheduleSave();
    });
    $('addTextBtn').addEventListener('click', function () { addText(); });
    var sel = $('phraseSel');
    PHRASES.forEach(function (p) {
      var o = document.createElement('option');
      o.value = p; o.textContent = p;
      sel.appendChild(o);
    });
    sel.addEventListener('change', function () {
      if (sel.value) { addText(sel.value); sel.value = ''; }
    });
  }

  /* ---------------- image tools ---------------- */
  function bindImageTools() {
    $('bgRemoveBtn').addEventListener('click', function () {
      var st = cur();
      if (!st) return;
      pushUndo(st);
      E.removeBackground(st.img, Number($('bgTolerance').value));
      renderStage();
      scheduleSave();
      toast('背景を透過しました');
    });
    $('eraserBtn').addEventListener('click', function () {
      brushMode = brushMode === 'erase' ? null : 'erase';
      $('eraserBtn').classList.toggle('active', brushMode === 'erase');
      $('restoreBtn').classList.remove('active');
    });
    $('restoreBtn').addEventListener('click', function () {
      brushMode = brushMode === 'restore' ? null : 'restore';
      $('restoreBtn').classList.toggle('active', brushMode === 'restore');
      $('eraserBtn').classList.remove('active');
    });
    $('trimBtn').addEventListener('click', function () {
      var st = cur();
      if (!st) return;
      pushUndo(st);
      var b = E.contentBounds(st.img, 8);
      if (b) {
        // crop the original with the same rect so the restore brush stays aligned
        var ob = { x: Math.min(b.x, st.orig.width - 1), y: Math.min(b.y, st.orig.height - 1),
                   w: Math.min(b.w, st.orig.width), h: Math.min(b.h, st.orig.height) };
        st.orig = E.cropCanvas(st.orig, ob);
        st.img = E.cropCanvas(st.img, b);
      }
      st.dx = 0; st.dy = 0;
      renderStage();
      scheduleSave();
      toast('余白をカットしました');
    });
    $('centerBtn').addEventListener('click', function () {
      var st = cur();
      if (!st) return;
      st.dx = 0; st.dy = 0;
      renderStage();
      scheduleSave();
    });
    $('resetImgBtn').addEventListener('click', function () {
      var st = cur();
      if (!st) return;
      if (!confirm('画像を読み込んだ直後の状態に戻しますか？（文字は残ります）')) return;
      pushUndo(st);
      st.img = E.cloneCanvas(st.orig);
      st.scale = 1; st.rot = 0; st.dx = 0; st.dy = 0;
      $('imgScale').value = 100; $('scaleOut').textContent = '100%';
      $('imgRot').value = 0; $('rotOut').textContent = '0°';
      renderStage();
      scheduleSave();
    });
    $('deleteStampBtn').addEventListener('click', function () {
      var st = cur();
      if (!st) return;
      if (!confirm('このスタンプを削除しますか？（枠が空に戻ります）')) return;
      state.stamps[state.selected] = null;
      activeTextId = null;
      scheduleSave();
      showView('viewSet');
      toast('スタンプを削除しました');
    });
    $('imgScale').addEventListener('input', function () {
      var st = cur();
      if (!st) return;
      st.scale = Number($('imgScale').value) / 100;
      $('scaleOut').textContent = $('imgScale').value + '%';
      renderStage();
      scheduleSave();
    });
    $('imgRot').addEventListener('input', function () {
      var st = cur();
      if (!st) return;
      st.rot = Number($('imgRot').value);
      $('rotOut').textContent = $('imgRot').value + '°';
      renderStage();
      scheduleSave();
    });
    $('imgPad').addEventListener('input', function () {
      var st = cur();
      if (!st) return;
      st.pad = Number($('imgPad').value);
      $('padOut').textContent = $('imgPad').value + 'px';
      renderStage();
      scheduleSave();
    });
    $('undoBtn').addEventListener('click', function () {
      var st = cur();
      if (!st || !st.undoStack.length) return;
      st.redoStack.push(E.cloneCanvas(st.img));
      st.img = st.undoStack.pop();
      syncUndoBtns();
      renderStage();
      scheduleSave();
    });
    $('redoBtn').addEventListener('click', function () {
      var st = cur();
      if (!st || !st.redoStack.length) return;
      st.undoStack.push(E.cloneCanvas(st.img));
      st.img = st.redoStack.pop();
      syncUndoBtns();
      renderStage();
      scheduleSave();
    });
  }

  /* ---------------- adding images ---------------- */
  function addStampsFromCanvases(canvases) {
    var placed = 0, firstPlaced = null;
    for (var i = 0; i < state.stamps.length && placed < canvases.length; i++) {
      if (!state.stamps[i]) {
        var src = canvases[placed];
        state.stamps[i] = newStamp(E.cloneCanvas(src), E.cloneCanvas(src));
        if (firstPlaced == null) firstPlaced = i;
        placed++;
      }
    }
    // if a specific empty slot was selected, it is filled first by the loop order;
    // remaining canvases are dropped when the set is full
    renderGrid();
    scheduleSave();
    if (placed < canvases.length) toast(placed + '個を追加しました（空き枠が足りず ' + (canvases.length - placed) + '個は入りませんでした）');
    else toast(placed + '個のスタンプを追加しました');
    return firstPlaced;
  }
  function handleFiles(files, targetSlot) {
    var jobs = Array.prototype.map.call(files, function (f) { return E.loadImage(f).catch(function () { return null; }); });
    Promise.all(jobs).then(function (canvases) {
      canvases = canvases.filter(Boolean);
      if (!canvases.length) { toast('画像を読み込めませんでした'); return; }
      if (targetSlot != null && canvases.length === 1 && !state.stamps[targetSlot]) {
        state.stamps[targetSlot] = newStamp(E.cloneCanvas(canvases[0]), E.cloneCanvas(canvases[0]));
        renderGrid();
        scheduleSave();
        openEditor(targetSlot);
        return;
      }
      addStampsFromCanvases(canvases);
    });
  }

  /* ---------------- split sheet ---------------- */
  var sheet = null; // {canvas, linesX:[], linesY:[]}
  function openSplit(canvas) {
    sheet = { canvas: canvas, linesX: [], linesY: [] };
    setEvenLines();
    $('splitModal').hidden = false;
    drawSplit();
  }
  function setEvenLines() {
    var rows = Number($('splitRows').value) || 1;
    var cols = Number($('splitCols').value) || 1;
    sheet.linesY = [];
    sheet.linesX = [];
    for (var i = 1; i < rows; i++) sheet.linesY.push(i / rows);
    for (var j = 1; j < cols; j++) sheet.linesX.push(j / cols);
  }
  function drawSplit() {
    if (!sheet) return;
    var c = $('splitCanvas');
    var maxW = Math.min(window.innerWidth - 60, 620);
    var scale = Math.min(maxW / sheet.canvas.width, 380 / sheet.canvas.height, 1);
    c.width = Math.round(sheet.canvas.width * scale);
    c.height = Math.round(sheet.canvas.height * scale);
    var ctx = c.getContext('2d');
    ctx.drawImage(sheet.canvas, 0, 0, c.width, c.height);
    ctx.strokeStyle = '#f2789f';
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 5]);
    sheet.linesX.forEach(function (f) {
      ctx.beginPath(); ctx.moveTo(f * c.width, 0); ctx.lineTo(f * c.width, c.height); ctx.stroke();
    });
    sheet.linesY.forEach(function (f) {
      ctx.beginPath(); ctx.moveTo(0, f * c.height); ctx.lineTo(c.width, f * c.height); ctx.stroke();
    });
  }
  var splitDrag = null;
  function bindSplit() {
    var c = $('splitCanvas');
    function pos(e) {
      var r = c.getBoundingClientRect();
      return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
    }
    c.addEventListener('pointerdown', function (e) {
      if (!sheet) return;
      var p = pos(e);
      var best = null;
      sheet.linesX.forEach(function (f, i) { if (Math.abs(f - p.x) < 0.03) best = { axis: 'x', i: i }; });
      sheet.linesY.forEach(function (f, i) { if (Math.abs(f - p.y) < 0.03) best = { axis: 'y', i: i }; });
      if (best) { splitDrag = best; c.setPointerCapture(e.pointerId); }
    });
    c.addEventListener('pointermove', function (e) {
      if (!splitDrag || !sheet) return;
      var p = pos(e);
      if (splitDrag.axis === 'x') sheet.linesX[splitDrag.i] = Math.min(0.98, Math.max(0.02, p.x));
      else sheet.linesY[splitDrag.i] = Math.min(0.98, Math.max(0.02, p.y));
      drawSplit();
    });
    ['pointerup', 'pointercancel'].forEach(function (ev) {
      c.addEventListener(ev, function () { splitDrag = null; });
    });
    $('splitRows').addEventListener('change', function () { setEvenLines(); drawSplit(); });
    $('splitCols').addEventListener('change', function () { setEvenLines(); drawSplit(); });
    $('splitEvenBtn').addEventListener('click', function () { setEvenLines(); drawSplit(); });
    $('splitAutoBtn').addEventListener('click', function () {
      if (!sheet) return;
      var rows = Number($('splitRows').value) || 1;
      var cols = Number($('splitCols').value) || 1;
      var ly = E.detectLines(sheet.canvas, 'y', rows);
      var lx = E.detectLines(sheet.canvas, 'x', cols);
      if (lx) sheet.linesX = lx;
      if (ly) sheet.linesY = ly;
      drawSplit();
      toast(lx || ly ? '分割線を検出しました。ずれている場合はドラッグで調整してください' : '自動検出できませんでした。行・列の数を確認してください');
    });
    $('splitCloseBtn').addEventListener('click', function () { $('splitModal').hidden = true; });
    $('splitApplyBtn').addEventListener('click', function () {
      if (!sheet) return;
      var cells = E.splitCanvas(sheet.canvas, sheet.linesX, sheet.linesY);
      var doBg = $('splitBgChk').checked;
      var doTrim = $('splitTrimChk').checked;
      cells = cells.map(function (cell) {
        var c2 = E.cloneCanvas(cell);
        if (doBg) E.removeBackground(c2, 32);
        if (doTrim) c2 = E.trimCanvas(c2);
        return c2;
      }).filter(function (c2) { return E.contentBounds(c2, 8) != null; });
      $('splitModal').hidden = true;
      if (!cells.length) { toast('分割できる内容が見つかりませんでした'); return; }
      addStampsFromCanvases(cells);
    });
  }

  /* ---------------- preview ---------------- */
  function renderPreview() {
    var body = $('chatBody');
    body.innerHTML = '';
    state.stamps.forEach(function (st) {
      if (!st) return;
      var img = document.createElement('img');
      img.src = compose(st).toDataURL('image/png');
      img.alt = '';
      body.appendChild(img);
    });
    if (!body.children.length) body.innerHTML = '<p style="color:#fff">まだスタンプがありません</p>';
  }

  /* ---------------- export ---------------- */
  function fitCanvas(src, W, H) {
    var c = E.makeCanvas(W, H);
    var ctx = c.getContext('2d');
    var s = Math.min(W / src.width, H / src.height);
    ctx.drawImage(src, (W - src.width * s) / 2, (H - src.height * s) / 2, src.width * s, src.height * s);
    return c;
  }
  function download(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }
  function zipFileName() {
    var el = $('zipNameInput');
    var raw = (el && el.value ? el.value : '').trim()
      .replace(/[\\/:*?"<>|]/g, '').replace(/\.zip$/i, '').trim();
    return (raw || ('line-stamps-' + new Date().toISOString().slice(0, 10))) + '.zip';
  }
  function refreshExport() {
    if (!$('zipNameInput').value) {
      $('zipNameInput').value = 'line-stamps-' + new Date().toISOString().slice(0, 10);
    }
    var sel = $('mainSourceSel');
    var one = $('dlOneSel');
    sel.innerHTML = '';
    one.innerHTML = '';
    state.stamps.forEach(function (st, i) {
      if (!st) return;
      var label = 'スタンプ ' + String(i + 1).padStart(2, '0');
      var o1 = document.createElement('option'); o1.value = i; o1.textContent = label; sel.appendChild(o1);
      var o2 = document.createElement('option'); o2.value = i; o2.textContent = label; one.appendChild(o2);
    });
    if (state.stamps[state.mainSource]) sel.value = state.mainSource;
    drawMainTab();
    runChecks();
  }
  function drawMainTab() {
    var idx = Number($('mainSourceSel').value || 0);
    var st = state.stamps[idx];
    if (!st) return;
    state.mainSource = idx;
    var composed = compose(st);
    var mc = $('mainCanvas').getContext('2d');
    mc.clearRect(0, 0, 240, 240);
    mc.drawImage(fitCanvas(composed, 240, 240), 0, 0);
    var tc = $('tabCanvas').getContext('2d');
    tc.clearRect(0, 0, 96, 74);
    tc.drawImage(fitCanvas(composed, 96, 74), 0, 0);
  }
  function stampChecks(st, blobSize) {
    var c = compose(st);
    var checks = [];
    checks.push({ ok: c.width <= MAX_W && c.height <= MAX_H && c.width % 2 === 0 && c.height % 2 === 0, warn: false, msg: 'サイズ ' + c.width + '×' + c.height + 'px（最大370×320・偶数）' });
    var b = E.contentBounds(c, 8);
    checks.push({ ok: !!b, warn: false, msg: b ? '透過背景あり（内容を検出）' : '内容が検出できません' });
    if (b) {
      var margin = Math.min(b.x, b.y, c.width - (b.x + b.w), c.height - (b.y + b.h));
      checks.push({ ok: margin >= 6, warn: margin >= 3, msg: 'イラスト周囲の余白 約' + margin + 'px（推奨10px前後）' });
    }
    if (blobSize != null) {
      checks.push({ ok: blobSize <= 1024 * 1024, warn: false, msg: 'ファイルサイズ ' + Math.round(blobSize / 1024) + 'KB（上限1MB）' });
    }
    return checks;
  }
  function runChecks() {
    var list = $('checkList');
    list.innerHTML = '';
    var filledIdx = [];
    state.stamps.forEach(function (st, i) { if (st) filledIdx.push(i); });
    function add(ok, warn, msg) {
      var li = document.createElement('li');
      li.className = ok ? 'ok' : (warn ? 'warn' : 'ng');
      li.textContent = msg;
      list.appendChild(li);
    }
    add(filledIdx.length === state.setSize, false,
      'スタンプ数 ' + filledIdx.length + ' / ' + state.setSize + ' 個' + (filledIdx.length === state.setSize ? '' : '（申請には全枠を埋めてください）'));
    var jobs = filledIdx.map(function (i) {
      return canvasToBlob(compose(state.stamps[i])).then(function (blob) {
        var cs = stampChecks(state.stamps[i], blob.size);
        var bad = cs.filter(function (c) { return !c.ok && !c.warn; });
        var warned = cs.filter(function (c) { return !c.ok && c.warn; });
        add(!bad.length && !warned.length, !bad.length && !!warned.length,
          'スタンプ' + String(i + 1).padStart(2, '0') + '：' + cs.map(function (c) { return c.msg; }).join(' ／ '));
      });
    });
    Promise.all(jobs).then(function () {
      add(true, false, 'メイン画像 240×240px ／ タブ画像 96×74px を自動生成します');
    });
  }
  function buildZip() {
    var entries = [];
    var jobs = [];
    state.stamps.forEach(function (st, i) {
      if (!st) return;
      jobs.push(canvasToBlob(compose(st)).then(function (blob) {
        return blob.arrayBuffer().then(function (buf) {
          entries.push({ name: String(i + 1).padStart(2, '0') + '.png', data: new Uint8Array(buf), order: i });
        });
      }));
    });
    var srcIdx = state.stamps[state.mainSource] ? state.mainSource : state.stamps.findIndex(Boolean);
    if (srcIdx >= 0) {
      var composed = compose(state.stamps[srcIdx]);
      jobs.push(canvasToBlob(fitCanvas(composed, 240, 240)).then(function (blob) {
        return blob.arrayBuffer().then(function (buf) {
          entries.push({ name: 'main.png', data: new Uint8Array(buf), order: 1000 });
        });
      }));
      jobs.push(canvasToBlob(fitCanvas(composed, 96, 74)).then(function (blob) {
        return blob.arrayBuffer().then(function (buf) {
          entries.push({ name: 'tab.png', data: new Uint8Array(buf), order: 1001 });
        });
      }));
    }
    return Promise.all(jobs).then(function () {
      entries.sort(function (a, b) { return a.order - b.order; });
      var zip = StampZip.createZip(entries.map(function (e) { return { name: e.name, data: e.data }; }));
      return new Blob([zip], { type: 'application/zip' });
    });
  }

  /* ---------------- project export/import ---------------- */
  function exportProjectFile() {
    serialize().then(function (data) {
      var jobs = data.stamps.map(function (s) {
        if (!s) return Promise.resolve(null);
        return Promise.all([blobToDataURL(s.orig), blobToDataURL(s.img)]).then(function (urls) {
          return { orig: urls[0], img: urls[1], scale: s.scale, rot: s.rot, pad: s.pad, dx: s.dx, dy: s.dy, texts: s.texts };
        });
      });
      return Promise.all(jobs).then(function (stamps) {
        return { app: 'line-stamp-maker', v: 1, setSize: data.setSize, mainSource: data.mainSource, stamps: stamps };
      });
    }).then(function (proj) {
      download(new Blob([JSON.stringify(proj)], { type: 'application/json' }), 'stamp-project.json');
      toast('バックアップを書き出しました');
    });
  }
  function blobToDataURL(blob) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(r.result); };
      r.onerror = rej;
      r.readAsDataURL(blob);
    });
  }
  function dataURLToBlob(url) {
    return fetch(url).then(function (r) { return r.blob(); });
  }
  function importProjectFile(file) {
    file.text().then(function (text) {
      var proj = JSON.parse(text);
      if (proj.app !== 'line-stamp-maker') throw new Error('bad file');
      var data = { setSize: proj.setSize, mainSource: proj.mainSource, stamps: [] };
      var jobs = proj.stamps.map(function (s) {
        if (!s) return Promise.resolve(null);
        return Promise.all([dataURLToBlob(s.orig), dataURLToBlob(s.img)]).then(function (b) {
          return { orig: b[0], img: b[1], scale: s.scale, rot: s.rot, pad: s.pad, dx: s.dx, dy: s.dy, texts: s.texts };
        });
      });
      return Promise.all(jobs).then(function (stamps) {
        data.stamps = stamps;
        return restoreProject(data);
      });
    }).then(function () {
      $('setSize').value = state.setSize;
      state.selected = null;
      showView('viewSet');
      scheduleSave();
      toast('バックアップを読み込みました');
    }).catch(function () {
      toast('読み込めませんでした。ファイルを確認してください');
    });
  }

  /* ---------------- bulk delete ---------------- */
  function syncBulkBar() {
    var n = Object.keys(state.bulkSel).length;
    $('bulkDeleteSelBtn').textContent = '選択した' + n + '個を削除';
    $('bulkDeleteSelBtn').disabled = n === 0;
  }
  function setBulkMode(on) {
    state.bulkMode = on;
    state.bulkSel = {};
    $('bulkBar').hidden = !on;
    $('bulkBtn').classList.toggle('active', on);
    $('bulkBtn').textContent = on ? '✓ 削除モード中' : '🗑 まとめて削除';
    syncBulkBar();
    renderGrid();
  }
  function bulkDelete(indices, label) {
    if (!indices.length) return;
    if (!confirm(label + 'を削除しますか？この操作は取り消せません')) return;
    indices.forEach(function (i) { state.stamps[i] = null; });
    if (state.selected != null && indices.indexOf(state.selected) >= 0) state.selected = null;
    setBulkMode(false);
    scheduleSave();
    toast(indices.length + '個のスタンプを削除しました');
  }

  /* ---------------- wiring ---------------- */
  function bindAll() {
    document.querySelectorAll('.tabbar .tab').forEach(function (b) {
      b.addEventListener('click', function () { showView(b.dataset.view); });
    });
    $('backToSetBtn').addEventListener('click', function () { showView('viewSet'); });
    $('backFromExportBtn').addEventListener('click', function () { showView('viewSet'); });
    $('gotoExportBtn').addEventListener('click', function () { showView('viewExport'); });
    $('setSize').addEventListener('change', function () {
      var n = Number($('setSize').value);
      var filledBeyond = state.stamps.slice(n).some(Boolean);
      if (filledBeyond && !confirm('作成済みのスタンプが一部消えます。スタンプ数を変更しますか？')) {
        $('setSize').value = state.setSize;
        return;
      }
      state.setSize = n;
      state.stamps.length = n;
      while (state.stamps.length < n) state.stamps.push(null);
      renderGrid();
      scheduleSave();
    });
    $('addImagesBtn').addEventListener('click', function () { state.selected = null; $('fileInput').click(); });
    $('fileInput').addEventListener('change', function () {
      var target = state.selected;
      handleFiles($('fileInput').files, target);
      $('fileInput').value = '';
      state.selected = target;
    });
    $('splitBtn').addEventListener('click', function () { $('sheetInput').click(); });
    $('sheetInput').addEventListener('change', function () {
      var f = $('sheetInput').files[0];
      $('sheetInput').value = '';
      if (!f) return;
      E.loadImage(f).then(openSplit).catch(function () { toast('画像を読み込めませんでした'); });
    });
    $('bulkBtn').addEventListener('click', function () {
      if (state.reorder) $('reorderBtn').click();
      setBulkMode(!state.bulkMode);
    });
    $('bulkCancelBtn').addEventListener('click', function () { setBulkMode(false); });
    $('bulkDeleteSelBtn').addEventListener('click', function () {
      var idx = Object.keys(state.bulkSel).map(Number);
      bulkDelete(idx, '選択した' + idx.length + '個のスタンプ');
    });
    $('bulkDeleteAllBtn').addEventListener('click', function () {
      var idx = [];
      state.stamps.forEach(function (st, i) { if (st) idx.push(i); });
      bulkDelete(idx, 'すべて（' + idx.length + '個）のスタンプ');
    });
    $('reorderBtn').addEventListener('click', function () {
      if (state.bulkMode) setBulkMode(false);
      state.reorder = !state.reorder;
      $('reorderBtn').classList.toggle('active', state.reorder);
      $('reorderBtn').textContent = state.reorder ? '✓ 並び替えを終わる' : '⇅ 並び替えモード';
      toast(state.reorder ? 'ドラッグで並び替えできます' : '並び替えを終了しました');
    });
    $('previewBtn').addEventListener('click', function () {
      renderPreview();
      $('previewModal').hidden = false;
    });
    $('previewCloseBtn').addEventListener('click', function () { $('previewModal').hidden = true; });
    $('pvLightBtn').addEventListener('click', function () {
      $('chatMock').className = 'chat-mock light';
      $('pvLightBtn').classList.add('active');
      $('pvDarkBtn').classList.remove('active');
    });
    $('pvDarkBtn').addEventListener('click', function () {
      $('chatMock').className = 'chat-mock dark';
      $('pvDarkBtn').classList.add('active');
      $('pvLightBtn').classList.remove('active');
    });
    $('helpBtn').addEventListener('click', function () { $('helpModal').hidden = false; });
    $('helpCloseBtn').addEventListener('click', function () { $('helpModal').hidden = true; });
    $('themeBtn').addEventListener('click', function () {
      var dark = document.documentElement.dataset.theme !== 'dark';
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      localStorage.setItem('lsm-theme', dark ? 'dark' : 'light');
      $('themeBtn').textContent = dark ? '☀️' : '🌙';
    });
    /* export view */
    $('mainSourceSel').addEventListener('change', drawMainTab);
    function mainIndex() {
      return state.stamps[state.mainSource] ? state.mainSource : state.stamps.findIndex(Boolean);
    }
    $('dlMainBtn').addEventListener('click', function () {
      var i = mainIndex();
      if (i < 0) { toast('スタンプがありません'); return; }
      canvasToBlob(fitCanvas(compose(state.stamps[i]), 240, 240)).then(function (b) { download(b, 'main.png'); });
    });
    $('dlTabBtn').addEventListener('click', function () {
      var i = mainIndex();
      if (i < 0) { toast('スタンプがありません'); return; }
      canvasToBlob(fitCanvas(compose(state.stamps[i]), 96, 74)).then(function (b) { download(b, 'tab.png'); });
    });
    $('dlOneBtn').addEventListener('click', function () {
      var i = Number($('dlOneSel').value);
      if (!state.stamps[i]) return;
      canvasToBlob(compose(state.stamps[i])).then(function (b) {
        download(b, String(i + 1).padStart(2, '0') + '.png');
      });
    });
    $('shareOneBtn').addEventListener('click', function () {
      var i = Number($('dlOneSel').value);
      if (!state.stamps[i]) { toast('スタンプがありません'); return; }
      var name = String(i + 1).padStart(2, '0') + '.png';
      canvasToBlob(compose(state.stamps[i])).then(function (b) {
        var file = new File([b], name, { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file] }).catch(function () {});
        } else {
          download(b, name);
          toast('この端末では共有が使えないため、ダウンロードしました');
        }
      });
    });
    $('dlZipBtn').addEventListener('click', function () {
      buildZip().then(function (blob) {
        download(blob, zipFileName());
        toast('ZIPを作成しました');
      });
    });
    $('shareZipBtn').addEventListener('click', function () {
      buildZip().then(function (blob) {
        var file = new File([blob], zipFileName(), { type: 'application/zip' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file] }).catch(function () {});
        } else {
          download(blob, zipFileName());
          toast('この端末では共有が使えないため、ダウンロードしました');
        }
      });
    });
    $('projExportBtn').addEventListener('click', exportProjectFile);
    $('projImportBtn').addEventListener('click', function () { $('projInput').click(); });
    $('projInput').addEventListener('change', function () {
      if ($('projInput').files[0]) importProjectFile($('projInput').files[0]);
      $('projInput').value = '';
    });
    $('projClearBtn').addEventListener('click', function () {
      if (!confirm('すべてのスタンプと編集データを消去しますか？この操作は取り消せません')) return;
      state.stamps = state.stamps.map(function () { return null; });
      state.selected = null;
      StampDB.remove('project').then(function () {
        showView('viewSet');
        toast('消去しました');
      });
    });
    bindImageTools();
    bindTextEditor();
    bindSplit();
  }

  /* ---------------- PWA ---------------- */
  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('sw.js').then(function (reg) {
      // an update that finished installing in a previous session is already waiting
      if (reg.waiting && navigator.serviceWorker.controller) {
        $('updateBanner').hidden = false;
      }
      reg.addEventListener('updatefound', function () {
        var nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', function () {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            $('updateBanner').hidden = false;
          }
        });
      });
      // iOS standalone apps check for updates lazily; ask explicitly on
      // launch and whenever the app comes back to the foreground.
      if (reg.update) reg.update().catch(function () {});
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden && reg.update) reg.update().catch(function () {});
      });
    }).catch(function () {});
    var refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (refreshing) return;
      refreshing = true;
      location.reload();
    });
    $('updateBtn').addEventListener('click', function () {
      navigator.serviceWorker.getRegistration().then(function (reg) {
        if (reg && reg.waiting) reg.waiting.postMessage('SKIP_WAITING');
        else location.reload();
      });
    });
  }

  /* ---------------- init ---------------- */
  function init() {
    var theme = localStorage.getItem('lsm-theme');
    if (theme === 'dark' || (!theme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.dataset.theme = 'dark';
      $('themeBtn').textContent = '☀️';
    }
    for (var i = 0; i < state.setSize; i++) state.stamps.push(null);
    bindAll();
    renderGrid();
    StampDB.get('project').then(function (data) {
      if (data) {
        restoreProject(data).then(function () {
          $('setSize').value = state.setSize;
          renderGrid();
          $('saveState').textContent = '前回の編集データを復元しました';
        }).catch(function () {});
      }
    }).catch(function () {});
    registerSW();
  }
  document.addEventListener('DOMContentLoaded', init);
})();
