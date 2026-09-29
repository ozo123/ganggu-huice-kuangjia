/* 港股 TA-Lib 全因子 20 组多空回测 — 报告交互层
   手写 SVG，无外部依赖，可离线以 file:// 打开。
   数据：data/index.js（目录）、data/overview-v2.js（全因子汇总）、data/v2_<因子>.js（按需加载） */
(() => {
'use strict';

const INDEX = window.HK_INDEX || { factors: [], meta: {} };
let OVERVIEW = window.HK_OVERVIEW_V2 || { slices: {}, series: [], groups: [] };
const AUDIT = window.HK_AUDIT || {};
const CORR = window.HK_CORR_V2 || null;
const POOL=AUDIT.pool_policy||null;
const SELECTION=window.HK_SELECTION||null;
const OLD_CORR=window.HK_SELECTION_CORR||null;
const BENCH=window.HK_BENCHMARK||null;
const BENCH_MAP=new Map(BENCH ? BENCH.dates.map((d,i)=>[d,BENCH.nav[i]]) : []);
const retained=(id,mode)=>INDEX.factors.some(f=>f.id===id&&(!f.modes||f.modes.includes(mode)));
const FILTER=window.HK_FILTER||{slices:{}};
const decision=(id,mode=state.fMode,hold=state.fHold)=>(FILTER.slices[mode+'__'+hold]?.rows||[]).find(r=>r.factor_id===id);
const availableFactors=mode=>INDEX.factors.filter(f=>retained(f.id,mode)&&f.settings.includes(mode+'__'+state.fHold)&&(state.view==='overview'||(decision(f.id,mode)?.status==='selected')===(state.view==='selected')));

const NS = 'http://www.w3.org/2000/svg';
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));

/* ── 取值与格式化 ───────────────────────────────────────── */
const isNum = v => v !== null && v !== undefined && typeof v === 'number' && isFinite(v);
const pct = (v, d = 1) => isNum(v) ? (v * 100).toFixed(d) + '%' : '—';
const pctS = (v, d = 1) => isNum(v) ? (v > 0 ? '+' : '') + (v * 100).toFixed(d) + '%' : '—';
const num = (v, d = 2) => isNum(v) ? v.toFixed(d) : '—';
const nav = v => isNum(v) ? (Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(2)) : '—';
const cls = v => !isNum(v) ? '' : v >= 0 ? 'pos' : 'neg';
const MODE_LABEL = (INDEX.meta && INDEX.meta.modeLabels) || { cash: '后复权现金分红', reinvest: '后复权分红再投' };

/* ── 20 组是序数，颜色用一条发散色带表达“低值→高值” ──────── */
const RAMP = [[150, 62, 43], [192, 110, 80], [219, 168, 137], [214, 211, 199],
              [166, 196, 186], [92, 156, 145], [26, 100, 92]];
function groupColor(i, n = 20) {
  const t = n <= 1 ? 0 : i / (n - 1);
  const x = t * (RAMP.length - 1);
  const a = Math.min(RAMP.length - 2, Math.floor(x));
  const f = x - a;
  const c = RAMP[a].map((v, k) => Math.round(v + (RAMP[a + 1][k] - v) * f));
  return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
}
const CAT = ['#33607e', '#1f6b62', '#a5762f', '#a8452f', '#6b5b8e', '#4a7a53',
             '#8a5a72', '#5d6b7a', '#7a6a3f', '#3f6f7a', '#7d5a4a'];
const catColor = i => CAT[((i % CAT.length) + CAT.length) % CAT.length];

/* ── SVG 基础 ───────────────────────────────────────────── */
function el(name, attrs) {
  const node = document.createElementNS(NS, name);
  if (attrs) for (const k in attrs) if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
  return node;
}
function box(svg) { const vb = svg.viewBox.baseVal; return { W: vb.width, H: vb.height }; }
function empty(svg, message) {
  svg.textContent = '';
  const { W, H } = box(svg);
  const t = el('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle' });
  t.textContent = message;
  svg.appendChild(t);
}
function niceTicks(lo, hi, count) {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step) out.push(v);
  return out;
}
function logTicks(lo, hi) {
  const out = [];
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) out.push(Math.pow(10, e));
  return out.filter(v => v >= lo * 0.999 && v <= hi * 1.001);
}
function finite(values) { return values.filter(isNum); }
function extent(values) {
  const f = finite(values);
  if (!f.length) return null;
  let lo = Math.min.apply(null, f), hi = Math.max.apply(null, f);
  if (lo === hi) { lo -= Math.abs(lo) * 0.05 + 1e-6; hi += Math.abs(hi) * 0.05 + 1e-6; }
  return [lo, hi];
}
function hover(svg, W, L, R, T, ih, n, onMove, onLeave) {
  const hit = el('rect', { class: 'hit', x: L, y: T, width: Math.max(1, W - L - R), height: Math.max(1, ih) });
  hit.addEventListener('mousemove', e => {
    const rect = svg.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width * W;
    const i = Math.max(0, Math.min(n - 1, Math.round((px - L) / Math.max(1, W - L - R) * (n - 1))));
    onMove(i);
  });
  hit.addEventListener('mouseleave', onLeave);
  svg.appendChild(hit);
  return hit;
}
function xAxisLabels(svg, dates, x, W, H, L, R) {
  const n = dates.length;
  if (!n) return;
  const picks = [0, Math.floor((n - 1) / 3), Math.floor(2 * (n - 1) / 3), n - 1]
    .filter((v, i, a) => a.indexOf(v) === i);
  picks.forEach(i => {
    const t = el('text', {
      x: x(i), y: H - 7,
      'text-anchor': i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'
    });
    t.textContent = String(dates[i] || '').slice(0, 10);
    svg.appendChild(t);
  });
}

/* ── 通用折线 ───────────────────────────────────────────── */
function plotLine(svg, cfg) {
  const { W, H } = box(svg);
  const L = cfg.left || 58, R = cfg.right || 16, T = cfg.top || 12, B = cfg.bottom || 28;
  const iw = W - L - R, ih = H - T - B;
  svg.textContent = '';
  const dates = cfg.dates || [];
  const series = (cfg.series || []).filter(s => s && s.values && s.values.length);
  const pick = v => isNum(v) ? (cfg.log ? v > 0 : true) : false;
  const pool = [];
  series.forEach(s => s.values.forEach(v => { if (pick(v)) pool.push(v); }));
  if (!pool.length || dates.length < 2) { empty(svg, cfg.emptyMessage || '该设定下没有可用数据'); return; }
  let lo = Math.min.apply(null, pool), hi = Math.max.apply(null, pool);
  const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.05 || 1;
  lo -= pad; hi += pad;
  if (cfg.zeroBase) lo = Math.min(0, lo);
  if (cfg.log) lo = Math.max(lo, Math.min.apply(null, pool) * 0.98);
  const yOf = cfg.log
    ? v => T + (1 - (Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * ih
    : v => T + (1 - (v - lo) / (hi - lo)) * ih;
  const n = dates.length;
  const xOf = i => L + (n <= 1 ? 0 : (i / (n - 1)) * iw);

  const ticks = cfg.log ? logTicks(lo, hi) : niceTicks(lo, hi, cfg.yTicks || 4);
  ticks.forEach(v => {
    const y = yOf(v);
    svg.appendChild(el('line', { class: 'gridline', x1: L, y1: y, x2: W - R, y2: y }));
    const t = el('text', { x: L - 8, y: y + 3.5, 'text-anchor': 'end' });
    t.textContent = (cfg.yFormat || (x => num(x)))(v);
    svg.appendChild(t);
  });
  svg.appendChild(el('line', { class: 'axis', x1: L, y1: T + ih, x2: W - R, y2: T + ih }));
  if (!cfg.log && lo < 0 && hi > 0) svg.appendChild(el('line', { class: 'zeroline', x1: L, y1: yOf(0), x2: W - R, y2: yOf(0) }));

  series.forEach((s, si) => {
    let d = '', open = false;
    s.values.forEach((v, i) => {
      if (!pick(v)) { open = false; return; }
      d += (open ? 'L' : 'M') + xOf(i).toFixed(2) + ' ' + yOf(v).toFixed(2) + ' ';
      open = true;
    });
    if (!d) return;
    if (s.fill) {
      svg.appendChild(el('path', {
        d: d + 'L' + xOf(n - 1).toFixed(2) + ' ' + (T + ih) + ' L' + L + ' ' + (T + ih) + ' Z',
        fill: s.color, opacity: s.fillOpacity || 0.14, stroke: 'none'
      }));
    }
    svg.appendChild(el('path', {
      d: d, fill: 'none', stroke: s.color || catColor(si), 'stroke-width': s.width || 1.4,
      'stroke-opacity': s.opacity === undefined ? 0.9 : s.opacity,
      'stroke-dasharray': s.dash || null, 'stroke-linejoin': 'round', 'stroke-linecap': 'round'
    }));
  });
  xAxisLabels(svg, dates, xOf, W, H, L, R);

  const cursor = el('line', { class: 'crosshair', x1: 0, y1: T, x2: 0, y2: T + ih, opacity: 0 });
  svg.appendChild(cursor);
  const dots = series.map(s => {
    const c = el('circle', { r: 3.2, fill: s.color || '#000', stroke: '#fff', 'stroke-width': 1.2, opacity: 0 });
    svg.appendChild(c); return c;
  });
  hover(svg, W, L, R, T, ih, n, i => {
    cursor.setAttribute('x1', xOf(i)); cursor.setAttribute('x2', xOf(i)); cursor.setAttribute('opacity', 1);
    series.forEach((s, si) => {
      const v = s.values[i];
      const ok = pick(v);
      dots[si].setAttribute('opacity', ok ? 1 : 0);
      if (ok) { dots[si].setAttribute('cx', xOf(i)); dots[si].setAttribute('cy', yOf(v)); }
    });
    if (cfg.onHover) cfg.onHover(i, series);
  }, () => {
    cursor.setAttribute('opacity', 0);
    dots.forEach(d => d.setAttribute('opacity', 0));
    if (cfg.onLeave) cfg.onLeave();
  });
}

/* ── 净值 + 水下曲线 ────────────────────────────────────── */
function navChart(svg, cfg) {
  const { W, H } = box(svg);
  const L = 60, R = 16, T = 14;
  const split = Math.round(H * 0.70), gap = 16, B = 26;
  const mainH = split - T, ddT = split + gap, ddH = H - B - ddT;
  svg.textContent = '';
  const dates = cfg.dates || [];
  const values = cfg.values || [];
  const good = values.filter(isNum).concat((cfg.benchmark||[]).filter(isNum));
  if (good.length < 2) { empty(svg, '该设定下多空组合没有可用净值'); return; }
  const iw = W - L - R, n = dates.length;
  const xOf = i => L + (n <= 1 ? 0 : (i / (n - 1)) * iw);
  let lo = Math.min.apply(null, good), hi = Math.max.apply(null, good);
  const useLog = cfg.log && lo > 0;
  const pd = (hi - lo) * 0.07 || 1;
  lo -= pd; hi += pd;
  if (useLog) lo = Math.max(lo, Math.min.apply(null, good) * 0.9);
  const yOf = useLog
    ? v => T + (1 - (Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * mainH
    : v => T + (1 - (v - lo) / (hi - lo)) * mainH;
  const ticks = useLog ? logTicks(lo, hi) : niceTicks(lo, hi, 4);
  ticks.forEach(v => {
    const y = yOf(v);
    svg.appendChild(el('line', { class: 'gridline', x1: L, y1: y, x2: W - R, y2: y }));
    const t = el('text', { x: L - 8, y: y + 3.5, 'text-anchor': 'end' });
    t.textContent = nav(v); svg.appendChild(t);
  });
  if (!useLog && lo <= 1 && hi >= 1) {
    svg.appendChild(el('line', { class: 'zeroline', x1: L, y1: yOf(1), x2: W - R, y2: yOf(1) }));
    // niceTicks 常常已经画了 1.00，避免重复标注
    if (!ticks.some(v => Math.abs(yOf(v) - yOf(1)) < 8)) {
      const t = el('text', { x: L - 8, y: yOf(1) + 3.5, 'text-anchor': 'end' });
      t.textContent = '1.00'; svg.appendChild(t);
    }
  }
  // 净值 ≤ 0 的区间加一层底纹：那里已不是可出资组合的净值
  if (cfg.brokenBelowZero && !useLog && lo < 0) {
    const y0 = Math.max(T, Math.min(T + mainH, yOf(0)));
    svg.appendChild(el('rect', { x: L, y: y0, width: iw, height: Math.max(0, T + mainH - y0), fill: 'var(--neg)', opacity: 0.05 }));
    const t = el('text', { x: L + 6, y: (y0 + T + mainH) / 2 + 3.5 });
    t.textContent = '价差净值 ≤ 0';
    svg.appendChild(t);
  }
  let d = '', open = false;
  values.forEach((v, i) => {
    if (!isNum(v) || (useLog && v <= 0)) { open = false; return; }
    d += (open ? 'L' : 'M') + xOf(i).toFixed(2) + ' ' + yOf(v).toFixed(2) + ' '; open = true;
  });
  svg.appendChild(el('path', { d: d + 'L' + xOf(n - 1).toFixed(2) + ' ' + (T + mainH) + ' L' + L + ' ' + (T + mainH) + ' Z',
    fill: cfg.color, opacity: 0.10, stroke: 'none' }));
  svg.appendChild(el('path', { d: d, fill: 'none', stroke: cfg.color, 'stroke-width': 2.2, 'stroke-linejoin': 'round' }));
  if(cfg.benchmark){
    let bd='',connected=false;
    cfg.benchmark.forEach((v,i)=>{if(!isNum(v)){connected=false;return;}bd+=(connected?'L':'M')+xOf(i).toFixed(2)+' '+yOf(v).toFixed(2)+' ';connected=true;});
    svg.appendChild(el('path',{d:bd,fill:'none',stroke:'#486cc6','stroke-width':2.2,'stroke-dasharray':'7 3','data-series':'hsi'}));
  }
  svg.appendChild(el('line', { class: 'axis', x1: L, y1: T + mainH, x2: W - R, y2: T + mainH }));

  // 水下曲线：同一净值的回撤，单独一条带状区域
  let peak = 1;
  const dd = cfg.drawdown || values.map(v => { if (!isNum(v)) return null; peak = Math.max(peak, v); return peak > 0 ? v / peak - 1 : null; });
  const ddMin = Math.min.apply(null, finite(dd).concat([-0.0001]));
  const ddY = v => ddT + (1 - (v - ddMin) / (0 - ddMin)) * ddH;
  let ddPath = '', o2 = false;
  dd.forEach((v, i) => {
    if (!isNum(v)) { o2 = false; return; }
    ddPath += (o2 ? 'L' : 'M') + xOf(i).toFixed(2) + ' ' + ddY(v).toFixed(2) + ' '; o2 = true;
  });
  if (ddPath) {
    svg.appendChild(el('path', { d: ddPath + 'L' + xOf(n - 1).toFixed(2) + ' ' + (ddT + ddH) + ' L' + L + ' ' + (ddT + ddH) + ' Z',
      fill: 'var(--neg)', opacity: 0.16, stroke: 'none' }));
    svg.appendChild(el('path', { d: ddPath, fill: 'none', stroke: 'var(--neg)', 'stroke-width': 1.1, 'stroke-opacity': 0.8 }));
  }
  svg.appendChild(el('line', { class: 'axis', x1: L, y1: ddT, x2: W - R, y2: ddT }));
  const lab = el('text', { x: L, y: ddT - 5 });
  lab.textContent = cfg.brokenBelowZero
    ? '回撤（水下曲线）　价差净值曾 ≤ 0，回撤比不再有组合含义'
    : '回撤（水下曲线）　最深 ' + pct(ddMin);
  svg.appendChild(lab);
  const top = el('text', { x: L, y: T - 2 });
  top.textContent = cfg.topLabel || '';
  svg.appendChild(top);
  xAxisLabels(svg, dates, xOf, W, H, L, R);

  const cursor = el('line', { class: 'crosshair', x1: 0, y1: T, x2: 0, y2: ddT + ddH, opacity: 0 });
  svg.appendChild(cursor);
  const dot = el('circle', { r: 3.6, fill: cfg.color, stroke: '#fff', 'stroke-width': 1.3, opacity: 0 });
  svg.appendChild(dot);
  hover(svg, W, L, R, T, ddT + ddH - T, n, i => {
    cursor.setAttribute('x1', xOf(i)); cursor.setAttribute('x2', xOf(i)); cursor.setAttribute('opacity', 1);
    if (isNum(values[i])) {
      dot.setAttribute('opacity', 1); dot.setAttribute('cx', xOf(i)); dot.setAttribute('cy', yOf(values[i]));
    } else dot.setAttribute('opacity', 0);
    if (cfg.onHover) cfg.onHover(i);
  }, () => { cursor.setAttribute('opacity', 0); dot.setAttribute('opacity', 0); if (cfg.onLeave) cfg.onLeave(); });
}

/* ── 分组柱（20 组，序数配色） ──────────────────────────── */
function groupBars(svg, cfg) {
  const { W, H } = box(svg);
  const L = 44, R = 12, T = 16, B = 22;
  const iw = W - L - R, ih = H - T - B;
  svg.textContent = '';
  const values = cfg.values || [];
  const f = finite(values);
  if (!f.length) { empty(svg, '该设定下没有可用的分组统计'); return; }
  const hi = Math.max.apply(null, f.map(Math.abs)) || 1;
  let lo = Math.min(0, Math.min.apply(null, f));
  const yOf = v => T + (1 - (v - lo) / (hi - lo)) * ih;
  const bw = iw / values.length;
  const zero = yOf(0);
  svg.appendChild(el('line', { class: 'zeroline', x1: L, y1: zero, x2: W - R, y2: zero }));
  const t0 = el('text', { x: L - 6, y: zero + 3.5, 'text-anchor': 'end' }); t0.textContent = '0';
  svg.appendChild(t0);
  const t1 = el('text', { x: L - 6, y: yOf(hi) + 3.5, 'text-anchor': 'end' });
  t1.textContent = (cfg.yFormat || pct)(hi); svg.appendChild(t1);
  values.forEach((v, i) => {
    if (!isNum(v)) return;
    const x = L + i * bw + bw * 0.16, w = bw * 0.68;
    const y = v >= 0 ? yOf(v) : zero;
    const h = Math.max(1, Math.abs(zero - yOf(v)));
    svg.appendChild(el('rect', { x: x, y: y, width: w, height: h, fill: groupColor(i, values.length), opacity: 0.92 }));
  });
  [0, 9, 19].forEach(i => {
    const t = el('text', { x: L + i * bw + bw / 2, y: H - 6, 'text-anchor': 'middle' });
    t.textContent = 'Q' + String(i + 1).padStart(2, '0'); svg.appendChild(t);
  });
  if (cfg.onHover) {
    hover(svg, W, L, R, T, ih, values.length, i => cfg.onHover(i), () => cfg.onLeave && cfg.onLeave());
  }
}

/* ── 斜率图（前向价差曲线） ───────────────────────────────── */
function slopeChart(svg, cfg) {
  const { W, H } = box(svg);
  const L = 56, R = 24, T = 34, B = 30;
  const valueFormat=cfg.valueFormat || (v=>pct(v,1));
  const axisFormat=cfg.axisFormat || (v=>pct(v,0));
  const iw = W - L - R, ih = H - T - B;
  svg.textContent = '';
  const labels = cfg.labels || [];
  const series = (cfg.series || []).filter(s => s.values.some(isNum));
  const pool = [];
  series.forEach(s => s.values.forEach(v => { if (isNum(v)) pool.push(v); }));
  if (!pool.length || labels.length < 2) { empty(svg, '三个持仓期均无可定义的比较数据'); return; }
  let lo = Math.min.apply(null, pool), hi = Math.max.apply(null, pool);
  const pad = (hi - lo) * 0.22 || 0.05;
  lo -= pad; hi += pad;
  const yOf = v => T + (1 - (v - lo) / (hi - lo)) * ih;
  const xOf = i => L + (labels.length <= 1 ? iw / 2 : (i / (labels.length - 1)) * iw);
  niceTicks(lo, hi, 4).forEach(v => {
    const y = yOf(v);
    svg.appendChild(el('line', { class: 'gridline', x1: L, y1: y, x2: W - R, y2: y }));
    const t = el('text', { x: L - 7, y: y + 3.5, 'text-anchor': 'end' }); t.textContent = axisFormat(v);
    svg.appendChild(t);
  });
  if (lo < 0 && hi > 0) svg.appendChild(el('line', { class: 'zeroline', x1: L, y1: yOf(0), x2: W - R, y2: yOf(0) }));
  series.forEach((s,si) => {
    const lx=L+si*110;
    svg.appendChild(el('line',{x1:lx,y1:12,x2:lx+18,y2:12,stroke:s.color,'stroke-width':2}));
    const legend=el('text',{x:lx+24,y:16});legend.textContent=s.label||'';svg.appendChild(legend);
    let d = '', open = false;
    s.values.forEach((v, i) => {
      if (!isNum(v)) { open = false; return; }
      d += (open ? 'L' : 'M') + xOf(i).toFixed(2) + ' ' + yOf(v).toFixed(2) + ' '; open = true;
    });
    if (d) svg.appendChild(el('path', { d: d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-opacity': 0.85 }));
    s.values.forEach((v, i) => {
      if (!isNum(v)) return;
      svg.appendChild(el('circle', { cx: xOf(i), cy: yOf(v), r: 4, fill: '#fff', stroke: s.color, 'stroke-width': 2 }));
      const other=series[1-si]?.values[i];
      const above=!isNum(other)||v>other||(v===other&&si===0);
      const t = el('text', { x: xOf(i), y: yOf(v) + (above?-10:19), 'text-anchor': i===0?'start':i===labels.length-1?'end':'middle', fill: s.color });
      t.setAttribute('style', 'font-weight:600');
      t.textContent = valueFormat(v); svg.appendChild(t);
    });
  });
  labels.forEach((lab, i) => {
    const t = el('text', { x: xOf(i), y: H - 8, 'text-anchor': 'middle' }); t.textContent = lab;
    svg.appendChild(t);
  });
}

/* ── 直方图 ─────────────────────────────────────────────── */
function histogram(svg, cfg) {
  const { W, H } = box(svg);
  const L = 44, R = 14, T = 18, B = 30;
  const iw = W - L - R, ih = H - T - B;
  svg.textContent = '';
  const values = finite(cfg.values || []);
  if (values.length < 3) { empty(svg, '该设定下 IC 观测不足'); return; }
  let lo = Math.min.apply(null, values), hi = Math.max.apply(null, values);
  if (lo === hi) { lo -= 0.01; hi += 0.01; }
  const bins = cfg.bins || 21;
  const step = (hi - lo) / bins;
  const counts = new Array(bins).fill(0);
  values.forEach(v => { counts[Math.min(bins - 1, Math.floor((v - lo) / step))] += 1; });
  const yMax = Math.max.apply(null, counts) || 1;
  const bw = iw / bins;
  const yOf = c => T + (1 - c / yMax) * ih;
  const xOf = v => L + ((v - lo) / (hi - lo)) * iw;
  svg.appendChild(el('line', { class: 'axis', x1: L, y1: T + ih, x2: W - R, y2: T + ih }));
  counts.forEach((c, i) => {
    const v = lo + (i + 0.5) * step;
    const h = Math.max(c > 0 ? 1 : 0, T + ih - yOf(c));
    svg.appendChild(el('rect', {
      x: L + i * bw + 0.6, y: T + ih - h, width: Math.max(1, bw - 1.2), height: h,
      fill: v >= 0 ? 'var(--pos)' : 'var(--neg)', opacity: 0.72
    }));
  });
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const varSum = values.reduce((a, b) => a + (b - mean) * (b - mean), 0);
  const sd = values.length > 1 ? Math.sqrt(varSum / (values.length - 1)) : 0;
  [[mean, 'var(--ink)', '均值 ' + num(mean, 3)], [0, 'var(--muted)', null]].forEach(pair => {
    const x = xOf(pair[0]);
    if (x < L - 1 || x > W - R + 1) return;
    svg.appendChild(el('line', { x1: x, y1: T, x2: x, y2: T + ih, stroke: pair[1], 'stroke-width': 1.2, 'stroke-dasharray': '3 3' }));
    if (pair[2]) {
      const t = el('text', { x: Math.min(W - R, x + 4), y: T + 9, fill: pair[1] });
      t.textContent = pair[2]; svg.appendChild(t);
    }
  });
  [lo, (lo + hi) / 2, hi].forEach((v, i) => {
    const t = el('text', { x: xOf(v), y: H - 10, 'text-anchor': i === 0 ? 'start' : i === 2 ? 'end' : 'middle' });
    t.textContent = num(v, 2); svg.appendChild(t);
  });
  // n 与 σ 放在面板标题的 aside 里，避免与均值标注在窄图里相撞
}

/* ── IC 时序：柱 + 滚动均值 ─────────────────────────────── */
function icTimeSeries(svg, cfg) {
  const { W, H } = box(svg);
  const L = 52, R = 16, T = 16, B = 28;
  const iw = W - L - R, ih = H - T - B;
  svg.textContent = '';
  const dates = cfg.dates || [];
  const values = cfg.values || [];
  const f = finite(values);
  if (f.length < 3) { empty(svg, '该设定下没有可用的 IC 序列'); return; }
  const n = dates.length;
  const hi = Math.max.apply(null, f.map(Math.abs)) * 1.08 || 1;
  const yOf = v => T + (1 - (v + hi) / (2 * hi)) * ih;
  const xOf = i => L + (n <= 1 ? 0 : (i / (n - 1)) * iw);
  [hi, 0, -hi].forEach(v => {
    const y = yOf(v);
    svg.appendChild(el('line', { class: v === 0 ? 'zeroline' : 'gridline', x1: L, y1: y, x2: W - R, y2: y }));
    const t = el('text', { x: L - 7, y: y + 3.5, 'text-anchor': 'end' }); t.textContent = num(v, 2);
    svg.appendChild(t);
  });
  const bw = Math.max(1, iw / n * 0.72);
  values.forEach((v, i) => {
    if (!isNum(v)) return;
    const y0 = yOf(0), y1 = yOf(v);
    svg.appendChild(el('rect', {
      x: xOf(i) - bw / 2, y: Math.min(y0, y1), width: bw, height: Math.max(0.7, Math.abs(y1 - y0)),
      fill: v >= 0 ? 'var(--pos)' : 'var(--neg)', opacity: 0.42
    }));
  });
  const win = cfg.window || 12;
  const roll = values.map((_, i) => {
    const slice = finite(values.slice(Math.max(0, i - win + 1), i + 1));
    return slice.length >= Math.max(2, Math.ceil(win / 3)) ? slice.reduce((a, b) => a + b, 0) / slice.length : null;
  });
  let d = '', open = false;
  roll.forEach((v, i) => {
    if (!isNum(v)) { open = false; return; }
    d += (open ? 'L' : 'M') + xOf(i).toFixed(2) + ' ' + yOf(v).toFixed(2) + ' '; open = true;
  });
  if (d) svg.appendChild(el('path', { d: d, fill: 'none', stroke: 'var(--ink)', 'stroke-width': 1.9 }));
  xAxisLabels(svg, dates, xOf, W, H, L, R);
  const cursor = el('line', { class: 'crosshair', x1: 0, y1: T, x2: 0, y2: T + ih, opacity: 0 });
  svg.appendChild(cursor);
  hover(svg, W, L, R, T, ih, n, i => {
    cursor.setAttribute('x1', xOf(i)); cursor.setAttribute('x2', xOf(i)); cursor.setAttribute('opacity', 1);
    if (cfg.onHover) cfg.onHover(i, values[i], roll[i]);
  }, () => { cursor.setAttribute('opacity', 0); if (cfg.onLeave) cfg.onLeave(); });
}

/* ── 散点（全因子） ─────────────────────────────────────── */
function scatter(svg, cfg) {
  const { W, H } = box(svg);
  const L = 74, R = 20, T = 18, B = 44;
  const iw = W - L - R, ih = H - T - B;
  svg.textContent = '';
  const pts = (cfg.points || []).filter(p => isNum(p.x) && isNum(p.y));
  if (pts.length < 1) { empty(svg, '该切片下没有同时具备 alpha 与 IC 的因子'); return; }
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  let xlo = Math.min.apply(null, xs), xhi = Math.max.apply(null, xs);
  let ylo = Math.min.apply(null, ys), yhi = Math.max.apply(null, ys);
  const xp = (xhi - xlo) * 0.08 || 0.01, yp = (yhi - ylo) * 0.08 || 0.01;
  xlo -= xp; xhi += xp; ylo -= yp; yhi += yp;
  const xOf = v => L + (v - xlo) / (xhi - xlo) * iw;
  const yOf = v => T + (1 - (v - ylo) / (yhi - ylo)) * ih;
  niceTicks(xlo, xhi, 5).forEach(v => {
    svg.appendChild(el('line', { class: 'gridline', x1: xOf(v), y1: T, x2: xOf(v), y2: T + ih }));
    const t = el('text', { x: xOf(v), y: T + ih + 15, 'text-anchor': 'middle' }); t.textContent = num(v, 2);
    svg.appendChild(t);
  });
  niceTicks(ylo, yhi, 4).forEach(v => {
    svg.appendChild(el('line', { class: 'gridline', x1: L, y1: yOf(v), x2: W - R, y2: yOf(v) }));
    const t = el('text', { x: L - 8, y: yOf(v) + 3.5, 'text-anchor': 'end' }); t.textContent = pct(v, 0);
    svg.appendChild(t);
  });
  [['横轴：平均 IC（Spearman）', L + iw / 2, H - 8, 'middle'],
   ['年化多空净收益', 13, T + ih / 2, 'middle']].forEach((spec, i) => {
    const t = el('text', { x: spec[1], y: spec[2], 'text-anchor': spec[3] });
    t.textContent = spec[0];
    if (i === 1) t.setAttribute('transform', 'rotate(-90 ' + spec[1] + ' ' + spec[2] + ')');
    svg.appendChild(t);
  });
  if (xlo < 0 && xhi > 0) svg.appendChild(el('line', { class: 'zeroline', x1: xOf(0), y1: T, x2: xOf(0), y2: T + ih }));
  if (ylo < 0 && yhi > 0) svg.appendChild(el('line', { class: 'zeroline', x1: L, y1: yOf(0), x2: W - R, y2: yOf(0) }));
  const nodes = [];
  pts.forEach(p => {
    const c = el('circle', {
      class: 'pick', cx: xOf(p.x), cy: yOf(p.y), r: 3.4,
      fill: catColor(p.g), 'fill-opacity': 0.78, stroke: 'none'
    });
    c.addEventListener('click', () => cfg.onPick && cfg.onPick(p.id));
    c.addEventListener('mouseenter', () => cfg.onHover && cfg.onHover(p));
    c.addEventListener('mouseleave', () => cfg.onLeave && cfg.onLeave());
    svg.appendChild(c); nodes.push(c);
  });
}

/* ── 热力图（分组持仓只数） ─────────────────────────────── */
function heatmap(svg, cfg) {
  const { W, H } = box(svg);
  const L = 44, R = 16, T = 14, B = 24;
  const iw = W - L - R, ih = H - T - B;
  svg.textContent = '';
  const rows = cfg.rows || [], rowLabels = cfg.rowLabels || [], dates = cfg.dates || [];
  if (!rows.length || !rows[0].length) { empty(svg, '该设定下没有持仓只数记录'); return; }
  const flat = [];
  rows.forEach(r => r.forEach(v => { if (isNum(v) && v > 0) flat.push(v); }));
  const hi = flat.length ? Math.max.apply(null, flat) : 1;
  const cw = iw / rows[0].length, ch = ih / rows.length;
  const color = v => {
    if (!isNum(v) || v <= 0) return null;
    const t = Math.min(1, Math.sqrt(v / hi));
    const a = [232, 236, 229], b = [26, 100, 92];
    return 'rgb(' + a.map((c, i) => Math.round(c + (b[i] - c) * t)).join(',') + ')';
  };
  rows.forEach((row, r) => {
    row.forEach((v, c) => {
      const fill = color(v);
      if (!fill) return;
      svg.appendChild(el('rect', { x: L + c * cw, y: T + r * ch, width: Math.max(0.6, cw - 0.28), height: Math.max(0.6, ch - 0.28), fill: fill }));
    });
  });
  rowLabels.forEach((lab, r) => {
    const t = el('text', { x: L - 7, y: T + r * ch + ch / 2 + 3.5, 'text-anchor': 'end' });
    t.textContent = lab; svg.appendChild(t);
  });
  const xOf = i => L + (i / Math.max(1, dates.length - 1)) * iw;
  xAxisLabels(svg, dates, xOf, W, H, L, R);
  svg.appendChild(el('rect', { x: W - R - 74, y: T, width: 74, height: 8, fill: 'rgb(26,100,92)', opacity: 0.9 }));
  const lb = el('text', { x: W - R - 78, y: T + 8, 'text-anchor': 'end' });
  lb.textContent = '持仓只数 ' + hi; svg.appendChild(lb);
  const cell = el('rect', { class: 'hit', x: L, y: T, width: iw, height: ih });
  cell.addEventListener('mousemove', e => {
    const rect = svg.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width * W, py = (e.clientY - rect.top) / rect.height * H;
    const c = Math.max(0, Math.min(dates.length - 1, Math.floor((px - L) / cw)));
    const r = Math.max(0, Math.min(rows.length - 1, Math.floor((py - T) / ch)));
    if (cfg.onHover) cfg.onHover(r, c, rows[r][c]);
  });
  cell.addEventListener('mouseleave', () => cfg.onLeave && cfg.onLeave());
  svg.appendChild(cell);
}

/* ── 前向价差曲线曲线（固定信号，改变前向窗口） ───────────── */
const MODE_COLOR = { reinvest: 'var(--pos)', cash: 'var(--warn)' };
function decayChart(svg, cfg) {
  const { W, H } = box(svg);
  const L = cfg.left || 56, R = 16, T = 22, B = 34;
  const iw = W - L - R, ih = H - T - B;
  svg.textContent = '';
  const horizons = cfg.horizons || [];
  const series = (cfg.series || []).filter(s => s.values && s.values.some(isNum));
  const pool = [];
  series.forEach(s => s.values.forEach(v => { if (isNum(v)) pool.push(v); }));
  if (!pool.length || horizons.length < 2) { empty(svg, '该因子没有可用的衰减曲线'); return; }
  const xp = horizons.map(h => Math.log10(h));
  const xMin = xp[0], xMax = xp[xp.length - 1];
  const xOfH = h => L + (Math.log10(h) - xMin) / (xMax - xMin) * iw;
  let lo = Math.min.apply(null, pool), hi = Math.max.apply(null, pool);
  if (cfg.includeZero) { lo = Math.min(0, lo); hi = Math.max(0, hi); }
  const pad = (hi - lo) * 0.18 || 0.005;
  lo -= pad; hi += pad;
  const yOf = v => T + (1 - (v - lo) / (hi - lo)) * ih;
  niceTicks(lo, hi, 4).forEach(v => {
    const y = yOf(v);
    svg.appendChild(el('line', { class: 'gridline', x1: L, y1: y, x2: W - R, y2: y }));
    const t = el('text', { x: L - 7, y: y + 3.5, 'text-anchor': 'end' });
    t.textContent = pct(v, 1); svg.appendChild(t);
  });
  if (lo < 0 && hi > 0) svg.appendChild(el('line', { class: 'zeroline', x1: L, y1: yOf(0), x2: W - R, y2: yOf(0) }));
  (cfg.markHolds || []).forEach(h => {
    const x = xOfH(h);
    svg.appendChild(el('line', { x1: x, y1: T, x2: x, y2: T + ih, stroke: 'var(--hair-2)', 'stroke-width': 1, 'stroke-dasharray': '2 3' }));
  });
  series.forEach(s => {
    let d = '', open = false;
    s.values.forEach((v, i) => {
      if (!isNum(v)) { open = false; return; }
      d += (open ? 'L' : 'M') + xOfH(horizons[i]).toFixed(2) + ' ' + yOf(v).toFixed(2) + ' '; open = true;
    });
    if (d) svg.appendChild(el('path', { d: d, fill: 'none', stroke: s.color, 'stroke-width': s.width || 2 }));
    s.values.forEach((v, i) => {
      if (!isNum(v)) return;
      svg.appendChild(el('circle', { cx: xOfH(horizons[i]), cy: yOf(v), r: 3.4, fill: '#fff', stroke: s.color, 'stroke-width': 1.8 }));
    });
  });
  horizons.forEach(h => {
    const t = el('text', { x: xOfH(h), y: H - 20, 'text-anchor': 'middle' });
    t.textContent = h + 'D'; svg.appendChild(t);
    const y = el('text', { x: xOfH(h), y: H - 8, 'text-anchor': 'middle' });
    y.textContent = cfg.showYears ? (h / 252).toFixed(2) : '';
    svg.appendChild(y);
  });
  const unit = el('text', { x: L, y: T - 6 });
  unit.textContent = cfg.unitLabel || '每期平均多空价差（毛值）';
  svg.appendChild(unit);
  if (cfg.legend) {
    svg.appendChild(el('rect', { x: W - R - 124, y: T - 14, width: 9, height: 9, fill: MODE_COLOR.reinvest }));
    const a = el('text', { x: W - R - 111, y: T - 6 }); a.textContent = '分红再投'; svg.appendChild(a);
    svg.appendChild(el('rect', { x: W - R - 52, y: T - 14, width: 9, height: 9, fill: MODE_COLOR.cash }));
    const b = el('text', { x: W - R - 39, y: T - 6 }); b.textContent = '现金分红'; svg.appendChild(b);
  }
}

/* ── 状态与渲染 ─────────────────────────────────────────── */
const state = { view:'overview', ovMode: 'reinvest', ovHold: 21, fMode: 'reinvest', fHold: 21, factor: null, hidden: {} };
const loaded = {};

function options(select, entries, value) {
  select.textContent = '';
  entries.forEach(e => {
    const o = document.createElement('option');
    o.value = e[0]; o.textContent = e[1];
    select.appendChild(o);
  });
  if (value !== undefined) select.value = value;
}
const MODES = [['reinvest', MODE_LABEL.reinvest], ['cash', MODE_LABEL.cash]];
const HOLDS = [['1', '1 个交易日'], ['5', '5 个交易日'], ['21', '21 个交易日']];

function sliceOf(mode, hold) {
  return (OVERVIEW.slices || {})[mode + '__' + hold] || null;
}

/* 总览 */
function renderOverview() {
  $('#ov-adjustment-warning').hidden=state.ovMode!=='cash';
  const s = sliceOf(state.ovMode, state.ovHold);
  const modeLabel = MODE_LABEL[state.ovMode];
  $('#ov-hero-label').textContent = modeLabel + ' · 持仓 ' + state.ovHold + ' 个交易日：年化多空净收益 为正的因子数';
  if (!s) { $('#ov-hero').textContent = '—'; $('#ov-metrics').textContent = ''; return; }
  const share = isNum(s.positive_share) ? (s.positive_share * 100).toFixed(1) + '%' : '—';
  $('#ov-hero').innerHTML = '<span class="' + cls(s.positive_count - s.n_valid / 2) + '">' + s.positive_count +
    '</span><em> / ' + s.n_valid + '　(' + share + ')</em>';
  $('#ov-metrics').innerHTML = [
    ['中位数年化净收益', pctS(s.median_alpha), cls(s.median_alpha)],
    ['中位数平均 IC', num(s.median_ic, 3), cls(s.median_ic)],
    ['中位数 |IC t 值|', num(s.median_abs_t, 2), ''],
    ['中位数最终净值', nav(s.median_nav), s.median_nav >= 1 ? 'pos' : 'neg']
  ].map(m => '<div class="metric"><small>' + m[0] + '</small><b class="' + m[2] + '">' + m[1] + '</b></div>').join('');
  $('#ov-scatter-aside').textContent = '给定 '+s.n_factors+' 个，其中 '+s.n_valid + ' 个有完整多空及 IC 结果';

  const groups = OVERVIEW.groups || [];
  $('#ov-legend').innerHTML = groups.map((g, i) =>
    '<button class="key" type="button" aria-pressed="true" data-g="' + i + '">' +
    '<span class="swatch" style="background:' + catColor(i) + '"></span>' + g + '</button>').join('');
  $$('#ov-legend button').forEach(b => b.addEventListener('click', () => {
    const g = b.dataset.g;
    state.hidden[g] = !state.hidden[g];
    b.setAttribute('aria-pressed', state.hidden[g] ? 'false' : 'true');
    drawScatter();
  }));
  drawScatter();
  drawMedianBars();
  drawOverviewDecay();
  drawRanking();
}

function drawOverviewDecay() {
  const horizons=[1,5,21];
  const series=['reinvest','cash'].map(m=>({label:m==='cash'?'现金分红':'分红再投',color:MODE_COLOR[m],values:horizons.map(h=>(sliceOf(m,h)||{}).median_ic)}));
  slopeChart($('#ov-decay'),{labels:['1D','5D','21D'],series,valueFormat:v=>num(v,4),axisFormat:v=>num(v,3)});
  $('#ov-decay-note').textContent='各持仓窗口的已测因子 Rank IC 中位数，使用每日完整信号样本。';
}

function visiblePoints() {
  const s = sliceOf(state.ovMode, state.ovHold);
  if (!s) return [];
  return s.points.filter(p => !state.hidden[String(p.g)]);
}

function drawScatter() {
  const pts = visiblePoints();
  scatter($('#ov-scatter'), {
    points: pts.map(p => ({ ...p, x: p.i, y: p.a, g: p.g, id: p.id })),
    onPick: id => {state.fMode=state.ovMode;state.fHold=state.ovHold;$('#f-mode').value=state.fMode;$('#f-hold').value=String(state.fHold);selectFactor(id, true);},
    onHover: p => {
      const f = INDEX.factors.find(x => x.id === p.id) || {};
      $('#ov-scatter-readout').innerHTML = '<b>' + p.id + '</b><span class="sep">|</span>' +
        (f.group || '') + '<span class="sep">|</span>平均 IC <b>' + num(p.i, 3) + '</b><span class="sep">|</span>年化净收益 <b>' +
        pctS(p.a) + '</b><span class="sep">|</span>最终净值 <b>' + nav(p.n) + '</b><span class="sep">|</span>点击查看该因子';
    },
    onLeave: () => { $('#ov-scatter-readout').textContent = '把指针移到点上查看因子；点击即切换。'; }
  });
}

function drawMedianBars() {
  const svg = $('#ov-median');
  const { W, H } = box(svg);
  const L = 54, R = 14, T = 20, B = 34;
  const iw = W - L - R, ih = H - T - B;
  svg.textContent = '';
  const rows = OVERVIEW.series || [];
  const vals = rows.map(r => isNum(r.median_alpha) ? r.median_alpha : null);
  const gross = rows.map(r => isNum(r.gross_median_alpha) ? r.gross_median_alpha : null);
  const f = finite(vals).concat(finite(gross));
  if (!f.length) { empty(svg, '没有可用的中位数'); return; }
  // 域包含 0 与毛值，再留边距；不要用 max(0, ·) 把上界钉死在 0，
  // 否则全为负值时上下界重叠、刻度只剩两个。
  let hi = Math.max.apply(null, f.concat([0]));
  let lo = Math.min.apply(null, f.concat([0]));
  const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.05 || 0.01;
  hi += pad; lo -= pad;
  const yOf = v => T + (1 - (v - lo) / (hi - lo)) * ih;
  const bw = iw / rows.length;
  niceTicks(lo, hi, 4).forEach(v => {
    const y = yOf(v);
    svg.appendChild(el('line', { class: v === 0 ? 'zeroline' : 'gridline', x1: L, y1: y, x2: W - R, y2: y }));
    const t = el('text', { x: L - 7, y: y + 3.5, 'text-anchor': 'end' }); t.textContent = pct(v, 0);
    svg.appendChild(t);
  });
  rows.forEach((r, i) => {
    const v = vals[i];
    const g = gross[i];
    const x = L + i * bw + bw * 0.18, w = bw * 0.64;
    // 两段柱：深色是扣费前的 alpha，浅色是 20bp 双边的年化拖累。
    if (isNum(v)) {
      const yNet = yOf(v);
      const yGross = isNum(g) ? yOf(g) : yOf(0);
      const y0 = yOf(0);
      const h1 = Math.abs(yGross - y0), h2 = Math.abs(yNet - yGross);
      if (h1 > 0.4) svg.appendChild(el('rect', {
        x: x, y: Math.min(y0, yGross), width: w, height: h1,
        fill: v >= 0 ? 'var(--pos)' : 'var(--neg)', opacity: 0.9
      }));
      if (h2 > 0.4) svg.appendChild(el('rect', {
        x: x, y: Math.min(yGross, yNet), width: w, height: h2, fill: 'var(--muted)', opacity: 0.32
      }));
      const t = el('text', { x: x + w / 2, y: v >= 0 ? yNet - 5 : yNet + 12, 'text-anchor': 'middle' });
      t.textContent = pct(v, 1); svg.appendChild(t);
      // 只有净值和毛值之间有足够空隙时才标注毛值，否则会与净值标签压在一起
      if (isNum(g) && Math.abs(yNet - yGross) >= 17) {
        const gy = g >= 0 ? yGross - 4 : yGross + 11;
        const gl = el('text', { x: x + w / 2, y: gy, 'text-anchor': 'middle', fill: 'var(--muted)' });
        gl.textContent = '毛 ' + pct(g, 1); svg.appendChild(gl);
      }
    }
    const l1 = el('text', { x: x + w / 2, y: H - 21, 'text-anchor': 'middle' });
    l1.textContent = (r.mode === 'cash' ? '现金' : '再投'); svg.appendChild(l1);
    const l2 = el('text', { x: x + w / 2, y: H - 4, 'text-anchor': 'middle' });
    l2.textContent = r.hold_days + 'D'; svg.appendChild(l2);
  });
  // 两组口径之间的分隔，让“同组更近”成立
  const divider = L + 3 * bw;
  svg.appendChild(el('line', { class: 'gridline', x1: divider, y1: T, x2: divider, y2: T + ih }));
  const feeByHold = {};
  let feeSample = null;
  rows.forEach(r => { if (isNum(r.fee_annualized)) { feeByHold[r.hold_days] = r.fee_annualized; feeSample = r; } });
  const byMode = m => rows.filter(r => r.mode === m)
    .map(r => r.hold_days + 'D ' + pct(r.median_alpha, 1) +
      (isNum(r.gross_median_alpha) ? ' ← 毛 ' + pct(r.gross_median_alpha, 1) : '')).join('　');
  $('#ov-median-note').innerHTML =
    ('按实际名义金额计提的年化费用率中位数：') +
    Object.keys(feeByHold).sort((a, b) => a - b).map(h => h + 'D ' + pct(feeByHold[h], 0)).join('　') +
    '<br>中位年化收益（净 ← 扣费前）：<br>现金　' + byMode('cash') + '<br>再投　' + byMode('reinvest') +
    ('<br>毛收益另跑零费用资金路径；浅色段为两条路径的收益差，包含费用引起的资金复利与停用差异，不能视为纯会计费用。');
}

function drawRanking() {
  const s = sliceOf(state.ovMode, state.ovHold);
  const fill = (ul, list, kind) => {
    ul.innerHTML = list.map((r, i) =>
      '<li><span class="idx">' + (kind === 'top' ? '↑' : '↓') + (i + 1) + '</span>' +
      '<button class="nm" type="button" data-id="' + r.factor_id + '">' + r.factor_id +
      '<span>' + r.function + ' · ' + r.output + '</span></button>' +
      '<span class="val ' + cls(r.alpha) + '">' + pctS(r.alpha) + '</span></li>').join('');
    $$('button.nm', ul).forEach(b => b.addEventListener('click', () => {state.fMode=state.ovMode;state.fHold=state.ovHold;$('#f-mode').value=state.fMode;$('#f-hold').value=String(state.fHold);selectFactor(b.dataset.id, true);}));
  };
  if (s) {
    fill($('#ov-top'), s.top, 'top');
    fill($('#ov-bottom'), s.bottom, 'bottom');
    $('#ov-rank-aside').textContent = MODE_LABEL[state.ovMode] + ' · ' + state.ovHold + ' 日持仓 · ' + s.n_valid + ' 个因子';
  }
}

/* 单因子 */
function selectFactor(id, scroll) {
  if (!id) return;
  if(state.view==='overview'||!availableFactors(state.fMode).some(f=>f.id===id)){
    state.view=decision(id)?.status==='selected'?'selected':'rejected';
    applyView();
  }
  if (!availableFactors(state.fMode).some(f => f.id === id)) return;
  refreshFactorList();
  state.factor = id;
  $('#f-search').value = id;
  ensureFactor(id).then(() => { if(state.factor!==id)return; renderFactor(); if (scroll) $('#factor').scrollIntoView({ block: 'start' }); });
}

function ensureFactor(id) {
  if (loaded[id]) return Promise.resolve(loaded[id]);
  const safe = id.replace(/[\\/ ]/g, '_');
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'data/v2_' + safe + '.js';
    s.onload = () => {
      const d = window.HK_V2_FACTOR;
      if (!d || d.factor_id !== id) { reject(new Error('missing payload ' + id)); return; }
      loaded[id] = d; resolve(d);
    };
    s.onerror = () => reject(new Error('failed to load data/f_' + safe + '.js'));
    document.head.appendChild(s);
  }).catch(err => {
    $('#factor-note').textContent = '数据加载失败：' + err.message;
    throw err;
  });
}

const rampLegend = (host, n) => {
  host.innerHTML = '<span>Q01 低值</span><span class="strip" style="background:linear-gradient(90deg,' +
    Array.from({ length: 11 }, (_, i) => groupColor(i * (n - 1) / 10, n)).join(',') + ')"></span><span>Q20 高值</span>';
};

function renderCalculation(id, cur) {
  const c = INDEX.factors.find(f=>f.id===id)?.calculation || {};
  $('#factor-formula').textContent = c.formula || '未提供完整公式；请查看定义缺口。';
  const p = c.parameters || {};
  $('#factor-formula-parameters').textContent = Object.keys(p).length ? '本次参数：' + Object.entries(p).map(([k,v])=>k+' = '+(typeof v==='object'?JSON.stringify(v):v)).join('；') : '';
  $('#factor-formula-method').textContent = c.method && c.method !== c.formula ? c.method : '';
  $('#factor-formula-notes').textContent = Array.isArray(c.notes) ? c.notes.join('；') : (c.notes || '');
  $('#factor-formula-direction').textContent = '以上为基础计算式。先验方向 ×'+(c.prior_direction ?? 1)+'；当前设置 IC 定向 ×'+(cur?.direction_multiplier ?? '—')+'。';
}

function renderFactor() {
  if(!availableFactors(state.fMode).some(f=>f.id===state.factor)){
    const ids=availableFactors(state.fMode);if(ids.length)selectFactor(ids[Math.floor(ids.length/2)].id,false);else $('#factor-note').textContent='该口径没有成功结果';return;
  }
  const full = loaded[state.factor];
  if (!full) return;
  const d = full;
  const mode = state.fMode, hold = state.fHold;
  $('#factor-adjustment-warning').hidden=mode!=='cash';
  const cur = d.modes[mode] && d.modes[mode][hold];
  $('#factor-title').textContent = '单因子详情 · ' + (INDEX.factors.find(f=>f.id===d.factor_id)?.name || d.factor_id);
  renderCalculation(d.factor_id, cur);
  $('#f-rule').innerHTML = 'Q01 最低值组 → 50% 空头担保<br>Q20 最高值组 → 50% 多头';
  if (!cur) {
    $$('#factor svg.chart').forEach(s=>empty(s,'该版本仍在计算中'));
    $('#fv-nav').textContent='计算中'; $('#fv-metrics').textContent='';
    $('#factor-note').textContent = '该设定下的全量计算尚未完成。'; return;
  }
  const ser = cur.series;
  const ls = cur.ls || {};
  // Short losses can exceed their allocated collateral; flag nonpositive equity.
  // 一旦复合净值跌到 0 或以下，最终净值与回撤就不再描述一个可出资组合。
  const spreadBroken = cur.nonpositive_nav === true ||
    (ser.ls_nav || []).some(v => isNum(v) && v <= 0);

  $('#fv-label').textContent = MODE_LABEL[mode] + ' · 持仓 ' + hold + ' 个交易日 · 多空组合最终净值';
  $('#fv-nav').innerHTML = '<span class="' + (isNum(ls.final_nav) && ls.final_nav >= 1 ? 'pos' : 'neg') + '">' +
    nav(ls.final_nav) + '</span>' + (spreadBroken ? '<em class="flag">价差净值曾跌破 0</em>' : '');
  $('#fv-metrics').innerHTML = [
    ['年化净收益', pctS(ls.annualized_return), cls(ls.annualized_return)],
    ['净夏普', num(ls.sharpe, 3), cls(ls.sharpe)],
    ['毛夏普', num(cur.gross_ls?.sharpe, 3), cls(cur.gross_ls?.sharpe)],
    ['原 IC → 定向 IC', num(cur.preorientation_rank_ic,4)+' → '+num(cur.ic?.mean,4), ''],
    ['IC 方向', cur.direction_multiplier<0?'× −1 · 已翻转':'× +1 · 保留', ''],
    ['平均 IC', num(cur.ic && cur.ic.mean, 3), cls(cur.ic && cur.ic.mean)],
    ['Rank IC · HAC t', num(cur.ic && cur.ic.tstat, 2), ''],
    ['最大回撤', spreadBroken ? '不适用' : pct(ls.max_drawdown), spreadBroken ? 'na' : 'neg']
  ].map(m => '<div class="metric"><small>' + m[0] + '</small><b class="' + m[2] + '">' + m[1] + '</b>' +
    (m[0] === '最大回撤' && spreadBroken ? '<span class="warn">价差净值 ≤ 0，回撤比失去含义</span>' : '') + '</div>').join('');

  const dates = cur.dates;
  const benchmark=dates.map(d=>BENCH_MAP.get(d)??null);
  const feeAnnual = ls.annualized_fee_rate;
  $('#ls-aside').textContent = '有效开仓 ' + cur.signal_count + ' 次 · 胜率 ' + pct(ls.win_rate) +
    ' · 年化费用率 ' + pct(feeAnnual, 1) + (spreadBroken ? ' · 曾出现资不抵债' : '');
  navChart($('#ls-nav'), {
    dates: dates, values: ser.ls_nav, benchmark, drawdown: ser.ls_drawdown, color: 'var(--ink)', log: false,
    topLabel: '多空净值（日终扣费后毛敞口 ≤100%，单边 20bp）',
    brokenBelowZero: spreadBroken,
    onHover: i => {
      const ddv = ser.ls_drawdown ? ser.ls_drawdown[i] : drawdownAt(ser.ls_nav, i);
      $('#ls-readout').innerHTML = '<b>' + String(dates[i]).slice(0, 10) + '</b><span class="sep">|</span>净值 <b>' +
        nav(ser.ls_nav[i]) + '</b><span class="sep">|</span>当期收益 <b>' + pctS(ser.ls_return[i], 2) + '</b>' +
        '<span class="sep">|</span>距峰值 <b>' + (spreadBroken ? '—' : pct(ddv)) + '</b><span class="sep">|</span>恒生指数 <b>'+nav(benchmark[i])+'</b>';
    },
    onLeave: () => { $('#ls-readout').textContent = '把指针移到图上查看逐期数值。'; }
  });

  rampLegend($('#cum-ramp'), 20);
  $('#cum-legend').innerHTML = '<span class="key"><span class="swatch" style="background:var(--ink)"></span>多空（日终敞口≤100%）</span>' +
    '<span class="key"><span class="swatch" style="background:' + groupColor(0, 20) + '"></span>Q01 低值组</span>' +
    '<span class="key"><span class="swatch" style="background:' + groupColor(19, 20) + '"></span>Q20 高值组</span>' +
    '<span class="key">中间为 Q02–Q19</span><span class="key"><span class="swatch" style="background:#486cc6"></span>恒生指数（价格指数）</span>';
  const gseries = [];
  // 中间 18 组作为纹理降到背景，Q01 与 Q20 是决定多空价差的两条腿，画实
  for (let g = 1; g <= 18; g++) gseries.push({ values: ser['q' + String(g + 1).padStart(2, '0') + '_nav'], color: groupColor(g, 20), width: 0.9, opacity: 0.3 });
  [0, 19].forEach(g => gseries.push({ values: ser['q' + String(g + 1).padStart(2, '0') + '_nav'], color: groupColor(g, 20), width: 1.8, opacity: 0.95 }));
  gseries.push({ values: ser.ls_nav, color: 'var(--ink)', width: 2.6, opacity: 1 });
  gseries.push({ values: benchmark, color: '#486cc6', width: 2.2, opacity: 1, dash:'7 3' });
  plotLine($('#cum-nav'), {
    dates: dates, series: gseries, yFormat: v => nav(v), yTicks: 4, left: 58, bottom: 30,
    onHover: i => {
      const picks = [0, 4, 9, 14, 19];
      const parts = picks.map(g => 'Q' + String(g + 1).padStart(2, '0') + ' ' +
        nav(ser['q' + String(g + 1).padStart(2, '0') + '_nav'][i]));
      $('#cum-readout').innerHTML = '<b>' + String(dates[i]).slice(0, 10) + '</b><span class="sep">|</span>多空 <b>' +
        nav(ser.ls_nav[i]) + '</b><span class="sep">|</span>恒指 '+nav(benchmark[i])+'<span class="sep">|</span>' + parts.join('　');
    },
    onLeave: () => { $('#cum-readout').textContent = '把指针移到图上查看该信号日的各组净值。'; }
  });

  groupBars($('#group-ret'), {
    values: cur.group_annualized_return, yFormat: v => pct(v, 0),
    onHover: i => {
      $('#group-ret-readout').innerHTML = '<b>Q' + String(i + 1).padStart(2, '0') + '</b><span class="sep">|</span>年化收益 <b>' +
        pctS(cur.group_annualized_return[i]) + '</b><span class="sep">|</span>波动率 ' + pct(cur.group_volatility[i]) +
        '<span class="sep">|</span>平均单期收益 <b>' + pctS(cur.group_average_return[i], 2) + '</b><span class="sep">|</span>最终净值 <b>' +
        nav(cur.group_final_nav[i]) + '</b>';
    },
    onLeave: () => { $('#group-ret-readout').textContent = '把指针移到柱上查看该组的收益、波动与持仓统计。'; }
  });
  $('#group-table').innerHTML = cur.group_annualized_return.map((v, i) =>
    '<tr class="' + (i === 0 || i === 19 ? 'em' : '') + '"><td>Q' + String(i + 1).padStart(2, '0') + '</td><td class="' + cls(v) + '">' +
    pctS(v) + '</td><td>' + pct(cur.group_volatility[i]) + '</td><td>' + nav(cur.group_final_nav[i]) + '</td><td>'+num(cur.group_metrics?.[i]?.sharpe,3)+'</td><td>'+num(cur.group_gross_metrics?.[i]?.sharpe,3)+'</td></tr>').join('');

  groupBars($('#group-vol'), { values: cur.group_volatility, yFormat: v => pct(v, 0) });
  groupVolNote(cur);

  const alphaAt=(m,h)=>retained(d.factor_id,m)?((d.modes[m]||{})[h]||{ls:{}}).ls.annualized_return:null;
  slopeChart($('#alpha-decay'),{labels:['1D','5D','21D'],series:['reinvest','cash'].map(m=>({label:m==='cash'?'现金分红':'分红再投',color:MODE_COLOR[m],values:[1,5,21].map(h=>alphaAt(m,h))}))});
  $('#decay-readout').textContent='每日滚动组合年化净收益：'+[1,5,21].map(h=>h+'D '+pctS(alphaAt(mode,h))).join(' · ')+'。未在另一复权口径保留时，不绘制该口径曲线。';

  const ic = ser.ic;
  const idates = cur.ic_dates || dates;
  const icv = finite(ic);
  const mean = cur.ic && cur.ic.mean;
  const sd = cur.ic && cur.ic.std;
  $('#icdist-aside').textContent = '均值 ' + num(mean, 3) + '　σ ' + num(sd, 3) + '　IR ' +
    (isNum(mean) && isNum(sd) && sd > 0 ? num(mean / sd, 2) : '—') + '　n ' + icv.length;
  histogram($('#ic-dist'), { values: ic, bins: 23 });

  $('#icts-aside').textContent = 'IC>0 占比 ' + (icv.length ? pct(icv.filter(v => v > 0).length / icv.length, 1) : '—');
  icTimeSeries($('#ic-ts'), {
    dates: idates, values: ic, window: 12,
    onHover: (i, v, roll) => {
      $('#icts-readout').innerHTML = '<b>' + String(idates[i]).slice(0, 10) + '</b><span class="sep">|</span>IC <b>' + num(v, 4) +
        '</b><span class="sep">|</span>12 期滚动均值 <b>' + num(roll, 4) + '</b><span class="sep">|</span>累计 IC <b>' +
        num(ser.cum_ic[i], 2) + '</b>';
    },
    onLeave: () => { $('#icts-readout').textContent = '把指针移到图上查看该期 IC。'; }
  });

  $('#cumic-aside').textContent = '累计 ' + num(cur.ic && cur.ic.cum, 2);
  plotLine($('#cum-ic'), {
    dates: idates, series: [{ values: icv.length ? ser.cum_ic : [], color: 'var(--blue)', width: 1.9, fill: true, fillOpacity: 0.10 }],
    yFormat: v => num(v, 1), left: 48, bottom: 28, yTicks: 4,
    emptyMessage: '该设定下没有可用 IC'
  });

  const counts = cur.counts || [];
  const rowLabels = [];
  for (let g = 0; g < 20; g++) rowLabels.push('Q' + String(g + 1).padStart(2, '0'));
  heatmap($('#hold-count'), {
    rows: counts[0] ? transpose(counts).slice(0, 20) : [], rowLabels: rowLabels, dates: cur.count_dates || [],
    onHover: (r, c, v) => {
      $('#cnt-readout').innerHTML = '<b>' + String((cur.count_dates || [])[c]).slice(0, 10) + '</b><span class="sep">|</span>Q' +
        String(r + 1).padStart(2, '0') + '<span class="sep">|</span>'+('跨批持仓条目')+' <b>' + (isNum(v) ? v : 0) + '</b>';
    },
    onLeave: () => { $('#cnt-readout').textContent = '把指针移到图上查看该信号日该组的持仓只数。'; }
  });
  const totals = counts.map(r => r.reduce((a, b) => a + b, 0));
  const f2 = finite(totals);
  const perGroup = [];
  for (let g = 0; g < 20; g++) {
    const col = finite(counts.map(r => r[g]));
    if (!col.length) continue;
    const sorted = col.slice().sort((a, b) => a - b);
    perGroup.push(sorted[Math.floor(sorted.length / 2)]);
  }
  const nonEmpty = perGroup.filter(v=>v>0).length;
  $('#cnt-aside').innerHTML = f2.length
    ? ('每日跨批持仓条目 ') + Math.min.apply(null, f2) + ' – ' + Math.max.apply(null, f2) +
      '（中位 ' + f2.slice().sort((a, b) => a - b)[Math.floor(f2.length / 2)] + '）· 各组中位只数 ' +
      (nonEmpty ? Math.min.apply(null, perGroup) + ' – ' + Math.max.apply(null, perGroup) : '—') +
      ' · ' + nonEmpty + '/20 组有持仓记录'
    : '—';

  const fmeta = INDEX.factors.find(x => x.id === d.factor_id) || {};
  $('#hold-meta').innerHTML = [
    ['因子', d.factor_id],
    ['函数 / 输出', d.function + ' → ' + d.output_name],
    ['来源分类', d.group],
    ['lookback', fmeta.lookback === undefined ? '—' : String(fmeta.lookback)],
    ['复权口径', MODE_LABEL[mode]],
    ['持仓期', hold + (' 个交易日 / 每日滚动 H 批')],
    ['信号期数', String(cur.signal_count) + ' 期'],
    ['分组规则', '平均秩映射至 Q01–Q20；并列不拆分，可能空组'],
    ['费率', '单边 20bp，按实际交易名义金额计费'],
    ['缺失处理', '入场失败留现金；持有缺报价按过去估值；到期按估值模拟结算']
  ].map(m => '<dt>' + m[0] + '</dt><dd>' + m[1] + '</dd>').join('');

  const auditPath=full.audit_path;
  $('#manifest-path').textContent='summary.csv';
  $('#manifest-doc').textContent='methodology.md';
  {
    $('#hold-strategies').innerHTML=[1,5,21].map(h=>'<tr><td>滚动 '+h+'D</td><td><a href="'+auditPath+'/groups_'+mode+'_'+(d.modes[mode][h]?.direction_multiplier||1)+'.npz">分组矩阵</a></td><td>信号t → t+1入场；t+1+H退出</td><td>'+((d.modes[mode][h]||{}).signal_count||0)+'</td></tr>').join('');
    $('#series-path').textContent=auditPath+'/series_'+mode+'_'+hold+'.parquet';
    $('#groups-path').textContent=auditPath+'/groups_'+mode+'_'+cur.direction_multiplier+'.npz';
    $('#factor-note').textContent=(full.assumptions||[]).join('；')+'。'+(cur.ls.active_entries===0?'本股票池下没有形成有效多空开仓，净值及收益不可定义；图中的恒指仍供参照。':'')+'完整逐日净值与 IC 已保存；分组由信号日决定，不能开仓的计划份额保持现金。H 批为等初始资金；多空组合超限时实际减仓，余仓保留原到期日。Q01–Q20为独立全资金多头账本，分组收益和IC均已按半年历史与5日成交额股票池重算。';
  }
  renderCapital(full,mode,hold);
  renderICDetails(cur);
  renderCorrelations();
}

function groupVolNote(cur) {
  const v = cur.group_volatility;
  const f = finite(v);
  if (!f.length) { $('#group-vol-note').textContent = '—'; return; }
  const lo = Math.min.apply(null, f), hi = Math.max.apply(null, f);
  const loG = v.findIndex(x => x === lo), hiG = v.findIndex(x => x === hi);
  $('#group-vol-note').innerHTML = '波动率最低 <strong>Q' + String(loG + 1).padStart(2, '0') + '</strong> ' + pct(lo) +
    '，最高 <strong>Q' + String(hiG + 1).padStart(2, '0') + '</strong> ' + pct(hi) +
    '。两侧波动率不对称时，多空价差同时承担方向与风险错配。';
}
function drawdownAt(values, i) {
  let peak = -Infinity;
  for (let k = 0; k <= i; k++) if (isNum(values[k])) peak = Math.max(peak, values[k]);
  return isNum(values[i]) && peak > 0 ? values[i] / peak - 1 : null;
}
function transpose(rows) {
  const out = [];
  const cols = rows[0] ? rows[0].length : 0;
  for (let c = 0; c < cols; c++) { out.push(rows.map(r => r[c])); }
  return out;
}
const baseName = id => id.replace(/[\\/ ]/g, '_');

function renderAudit() {
  const q=AUDIT.verification||{};
  const rv=AUDIT.real_verification||{};
  $('#audit-status').textContent=(AUDIT.build_status==='complete'?'本轮筛选及结果核对已完成':'全量计算进行中')+' · '+(AUDIT.completed_factor_modes||0)+' / '+(AUDIT.expected_factor_modes||187)+' 入选因子与复权组合已核对 · 原数据 SHA256 '+(AUDIT.source_hashes_match?'全部一致':'尚未确认');
  $('#audit-facts').innerHTML=[['资金管理','多空各半 · H 批滚动'],['供股策略','不认购 · 不追加资金'],['已核验异常','7 / 7 条已修复'],['低于 −100% 日收益',String(AUDIT.cash_policy?.below_minus_one ?? '—')+' 条']].map(x=>'<div><small>'+x[0]+'</small><b>'+x[1]+'</b></div>').join('');
  $('#audit-findings').innerHTML=(AUDIT.findings||[]).map(x=>'<article class="audit-item"><span>'+x.severity+'</span><div><b>'+x.title+'</b><p>'+x.detail+'</p></div></article>').join('')+'<p class="note">独立账本与统计校验：'+(q.passed||0)+' / '+(q.total||0)+' 项；真实数据抽样校验：'+(rv.passed||0)+' / '+(rv.total||0)+' 项。<a href="audit-v2/audit.json">完整核查证据</a> · <a href="audit-v2/verification.json">模拟账本校验</a> · <a href="audit-v2/real_verification.json">真实数据校验</a> · <a href="audit-v2/completion.json">全量覆盖核对</a> · <a href="https://quantopian.github.io/alphalens/alphalens.html">Rank IC 定义参考</a></p>';
  const events=AUDIT.cash_policy?.verified_events||[];
  $('#cash-events').innerHTML=events.map(e=>'<tr><td>'+e.code+'</td><td>'+e.date+'</td><td>'+pctS(e.before_return)+'</td><td>'+pctS(e.after_return)+'</td><td>'+e.terms+'</td><td><a href="'+e.source+'" target="_blank" rel="noopener">公告</a></td></tr>').join('');
  renderModelMethod();
}
function renderPool(){
  if(!POOL)return;
  const d=POOL.counts;
  $('#pool-range').textContent='有候选日期中位 '+num(POOL.median_eligible_active_dates,0)+' 只 · '+POOL.min_eligible_active_dates+'–'+POOL.max_eligible+' 只';
  plotLine($('#pool-history'),{dates:d.date,series:[{values:d.raw_tradable,color:'#9b9c99',width:1},{values:d.eligible,color:'#1f6b62',width:2}],yFormat:v=>num(v,0),left:56,
    onHover:i=>{$('#pool-readout').textContent=d.date[i]+' · 原始可交易 '+d.raw_tradable[i]+' · 满半年 '+d.after_age[i]+' · 完整5日窗口 '+d.after_complete_window[i]+' · 最终候选 '+d.eligible[i]+' 只';},
    onLeave:()=>{$('#pool-readout').textContent='每个信号日使用当时及此前的数据重新计算。';}});
  const input=$('#pool-date');input.min=d.date[0];input.max=d.date[d.date.length-1];input.value=input.max;
  const update=()=>{let i=d.date.length-1;while(i>0&&d.date[i]>input.value)i--;
    $('#pool-date-note').textContent='采用不晚于所选日的样本交易日：'+d.date[i];
    $('#pool-counts').innerHTML=[['原始可交易',d.raw_tradable[i]],['历史满半年',d.after_age[i]],['完整5日成交额',d.after_complete_window[i]],['成交额达标及币种可比',d.eligible[i]]].map(x=>'<dt>'+x[0]+'</dt><dd>'+x[1]+' 只</dd>').join('');};
  input.addEventListener('change',update);update();
}
function refreshFactorList(){
  const list=$('#f-list');list.textContent='';
  availableFactors(state.fMode).forEach(f=>{const o=document.createElement('option');o.value=f.id;list.appendChild(o);});
}
function renderSelection(){
  if(!SELECTION)return;
  const m=$('#selection-mode').value,r=SELECTION.modes[m],a=SELECTION.modes.cash,b=SELECTION.modes.reinvest;
  $('#selection-facts').innerHTML=[['现金分红保留',a.n_retained+' / '+a.n_input],['分红再投保留',b.n_retained+' / '+b.n_input],['排序依据','本版21日净多空年化'],['当前集合最大 |ρ|',num(r.max_abs_correlation,4)]].map(x=>'<div><small>'+x[0]+'</small><b>'+x[1]+'</b></div>').join('');
  $('#selection-caveat').textContent='本轮只在上一版两套集合中去重，使用半年历史/5日成交额股票池的全样本21日净多空收益和月末因子相关矩阵。现金删除 '+a.n_correlation_removed+' 个高相关、'+a.n_other_removed+' 个不满足有效收益/覆盖条件的因子；再投分别删除 '+b.n_correlation_removed+'、'+b.n_other_removed+' 个。保留集合中超过 |ρ|=0.8 的因子对均为0。删除者对应优先已测因子及收益见明细。这是样本内事后筛选，不是样本外验证。';
  $('#selection-decisions').innerHTML=r.rows.map(x=>'<tr><td>'+x.factor_id+'</td><td>'+(x.status==='retained'?'保留':'删除')+'</td><td>'+pctS(x.net_21d_annualized,2)+'</td><td>'+x.reason+'</td><td>'+(x.blocked_by||'—')+'</td><td>'+num(x.rho,4)+'</td></tr>').join('');
}
function renderModelMethod(){
  $('#model-method').textContent='初始资金均分 H 批，每批开仓多头与空头担保各半，费用在资本内扣除，卖空所得封存。t 日收盘信号、t+1 收盘建仓；每天收盘交易并扣费后，多空市值合计≤净资产。超限则实际按比例减仓，减仓扣单边20bp，剩余持仓保留原到期日，到期用剩余实际资金续投。失败批次平仓扣费，其他批次以可用现金偿付其负余额，转出批次本金同步减少。';
}
function renderCapital(full,mode,hold){
  const r=(full.modes[mode]||{})[hold];
  if(!r){empty($('#capital-compare'),'数据缺失');return;}
  const ratio=r.series.ls_gross_exposure.map((x,i)=>r.series.ls_nav[i]>0?x/r.series.ls_nav[i]:null);
  const before=r.series.ls_pre_cap_gross.map((x,i)=>r.series.ls_pre_cap_nav[i]>0?x/r.series.ls_pre_cap_nav[i]:null);
  const cr=r.capital_review||{};
  plotLine($('#capital-compare'),{dates:r.dates,series:[{values:before,color:'#929894',width:1},{values:ratio,color:'#1f6b62',width:2},{values:r.dates.map(()=>1),color:'#b55d4d',width:1,dash:'5 4'}],yFormat:pct,left:60});
  $('#capital-aside').textContent=hold+' 批 · 每批初始 '+pct(1/Number(hold),2)+' · 批内多空各半 · 单边 20bp';
  $('#capital-stats').innerHTML=[['日终最高毛敞口',pct(cr.post_cap_max,2)],['日终超过100%的天数',num(cr.post_cap_over100_days,0)],['减仓前最高毛敞口',pct(cr.pre_cap_max,2)],['触发降仓天数',num(cr.cap_reduction_days,0)],['平均日终毛敞口',pct(r.mean_ls_exposure)],['滚动 CAGR',pctS(r.ls.cagr)],['停止开新仓的批次',num(r.bankrupt_sleeves,0)+' / '+hold]].map(x=>'<dt>'+x[0]+'</dt><dd>'+x[1]+'</dd>').join('');
  $('#capital-limit').textContent='100%约束指日终交易并扣费后的账面敞口；盘中和收盘减仓前可能超过。沿用研究估值：到期或强制减仓遇到无可成交报价时，按最后可用标记模拟结算，未模拟停牌延迟、滑点和借券。组合资不抵债则全平并保留扣费后亏损、停止交易；不将负净值截成零。';
  $('#ls-method').textContent='开仓50%资金做多Q20、50%作Q01空头担保，卖空所得封存。每日日终扣费后，多空名义市值合计不超过净资产100%；超限实际减仓，全部开仓、到期平仓、风险减仓均按金额扣单边20bp。两条费用路径各自执行相同风险规则。';
}
function renderICDetails(cur){
  $('#ic-t-column').textContent='HAC t 值';
  const rows=[['Rank IC',cur.ic],['Pearson IC',cur.pearson_ic]];
  $('#ic-extra').innerHTML=rows.map(([label,m])=>{
    if(!m)return '<tr><td>'+label+'</td><td colspan="6">无可定义的有效样本</td></tr>';
    const ir=isNum(m.ir)?m.ir:(m.std>0?m.mean/m.std:null);
    return '<tr><td>'+label+'</td><td>'+num(m.mean,4)+'</td><td>'+num(m.std,4)+'</td><td>'+num(ir,3)+'</td><td>'+num(m.tstat,2)+'</td><td>'+pct(m.positive_share,1)+'</td><td>'+(m.n||0)+'</td></tr>';
  }).join('');
  $('#ic-method-label').textContent='每天取信号 · float64 · 当时股票池';
  const n=finite(cur.series.ic_n_stocks||[]).filter(v=>v>0);
  $('#ic-extra-note').textContent='ICIR = 均值 / 标准差，未年化；HAC 使用 Bartlett 权重，滞后 '+cur.ic.hac_lags+' 日（至少 H−1），处理窗口重叠及短期序列相关。共同样本平均 '+(n.length?num(n.reduce((a,b)=>a+b,0)/n.length,0):'—')+' 只；正 IC 占比、分布、累计值使用同一完整样本。全部可实现因子均保留，未经收益优选；多个因子仍涉及多重检验，t值不能直接解释为样本外有效。';
}
let matrixIDs=[];
function renderCorrelations(){
  const matrix=CORR;
  const canvas=$('#corr-matrix'); if(!canvas)return;
  const ctx=canvas.getContext('2d');ctx.clearRect(0,0,780,780);
  if(!matrix){ctx.fillStyle='#78857e';ctx.font='18px sans-serif';ctx.fillText('全量因子计算后生成相关性矩阵',100,200);return;}
  const mode=$('#corr-mode').value||'reinvest';const group=$('#corr-group').value||'all';const min=Number($('#corr-min').value||12);
  const cm=matrix.slices?.[mode+'__'+state.ovHold]||matrix.modes[mode];if(!cm)return;
  const lookup=new Map(INDEX.factors.map(f=>[f.id,f]));
  matrixIDs=matrix.ids.map((id,i)=>i).filter(i=>retained(matrix.ids[i],mode)&&(group==='all'||lookup.get(matrix.ids[i]).group===group)).sort((a,b)=>{const aa=lookup.get(matrix.ids[a]),bb=lookup.get(matrix.ids[b]);return aa.group.localeCompare(bb.group)||aa.id.localeCompare(bb.id);});
  const n=matrixIDs.length,L=48,S=712,cell=S/Math.max(n,1);
  const color=v=>{const c=v<0?[168,69,47]:[31,107,98],b=[245,244,236],q=Math.abs(v);return 'rgb('+c.map((x,i)=>Math.round(b[i]+q*(x-b[i]))).join(',')+')';};
  for(let a=0;a<n;a++)for(let b=0;b<n;b++){const i=matrixIDs[a],j=matrixIDs[b],v=cm.matrix[i][j];ctx.fillStyle=isNum(v)&&cm.days[i][j]>=min?color(v):'#d9ded6';ctx.fillRect(L+b*cell,L+a*cell,cell+.3,cell+.3);}
  ctx.font='11px sans-serif';ctx.fillStyle='#41524c';ctx.fillText('因子序号 →（按分类 / 名称排序）',L,20);
  for(let k=0;k<n;k+=Math.max(1,Math.ceil(n/10))){ctx.fillText(String(k+1),L+k*cell,40);ctx.fillText(String(k+1),10,L+k*cell+8);}
  const fi=matrix.ids.indexOf(state.factor);let near=[];
  if(fi>=0){near=matrixIDs.filter(j=>j!==fi&&isNum(cm.matrix[fi][j])&&cm.days[fi][j]>=min).map(j=>({id:matrix.ids[j],r:cm.matrix[fi][j],n:cm.days[fi][j],stocks:cm.overlap[fi][j]})).sort((a,b)=>Math.abs(b.r)-Math.abs(a.r)).slice(0,20);}
  $('#corr-neighbors-title').textContent=(state.factor||'当前因子')+' · 最相关的 20 个因子';
  $('#corr-neighbors').innerHTML=near.length?near.map(x=>'<tr><td><a href="#factor" data-factor="'+x.id+'">'+x.id+'</a></td><td class="'+cls(x.r)+'">'+num(x.r,3)+'</td><td>'+x.n+'</td><td>'+num(x.stocks,0)+'</td></tr>').join(''):'<tr><td colspan="4">无满足覆盖条件的相关因子；常数因子的相关性不可定义。</td></tr>';
  $$('#corr-neighbors a').forEach(a=>a.addEventListener('click',()=>{state.fMode=mode;$('#f-mode').value=mode;selectFactor(a.dataset.factor,true);}));
  $('#corr-note').textContent='半年/5日股票池：展示筛选前全部因子的定向后月末截面相关；先按 |ρ|>0.8 贪心去重，再筛选定向后 IC≥0.01。'+matrix.sample_dates.length+' 个月度截面（每月最后可用交易日；末月截至数据结束日；'+matrix.sample_dates[0]+'—'+matrix.sample_dates.at(-1)+'）。每个因子对至少 20 只共同证券；当前显示至少 '+min+' 个有效月末的 '+n+' 个因子。矩阵按对计算有效日期，可能不是半正定矩阵，不能直接当作组合协方差。';
  $('#corr-download').href='correlation_'+mode+'_'+state.ovHold+'.csv';
  const hit=e=>{const b=canvas.getBoundingClientRect(),xx=(e.clientX-b.left)*780/b.width,yy=(e.clientY-b.top)*780/b.height;const a=Math.floor((yy-L)/cell),c=Math.floor((xx-L)/cell);return a>=0&&c>=0&&a<n&&c<n?[matrixIDs[a],matrixIDs[c]]:null;};
  canvas.onmousemove=e=>{const x=hit(e);if(!x)return;const [i,j]=x;$('#corr-readout').textContent=matrix.ids[i]+' × '+matrix.ids[j]+' · ρ '+(cm.days[i][j]>=min?num(cm.matrix[i][j],4):'覆盖不足')+' · '+cm.days[i][j]+' 个月 · 平均 '+num(cm.overlap[i][j],0)+' 只共同证券';};
  canvas.onclick=e=>{const x=hit(e);if(x){state.fMode=mode;$('#f-mode').value=mode;selectFactor(matrix.ids[x[0]],true);}};
}


function applyView(){
  const overview=state.view==='overview';
  ['overview','correlation','overview-extra'].forEach(id=>{if($('#'+id))$('#'+id).hidden=!overview;});
  $('#screening').hidden=overview;
  $$('.viewbar [data-view]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.view===state.view)));
  const list=availableFactors(state.fMode);
  $('#factor').hidden=overview||!list.length;
  refreshFactorList();
  const selection=FILTER.slices[state.fMode+'__'+state.fHold]||{rows:[],n_after_correlation:0};
  const rows=selection.rows.filter(r=>(r.status==='selected')===(state.view==='selected'));
  $('#screening-title').textContent=state.view==='selected'?'筛选出的好因子':'无效因子与未入选项';
  $('#screening-sub').textContent=state.view==='selected'?'通过相关性去重，定向后平均 Rank IC ≥ 0.01。':'保留原有图表；冗余、低 IC、数据不足及计算失败分别标记。高相关未入选不等于因子没有预测能力。';
  $('#screening-count').textContent=MODE_LABEL[state.fMode]+' · '+state.fHold+' 日 · '+rows.length+' 个因子；相关性步骤保留 '+selection.n_after_correlation+' 个。';
  const body=$('#screening-rows');body.textContent='';
  rows.forEach(r=>{
    const tr=document.createElement('tr'),td=document.createElement('td');
    const calculable=list.some(f=>f.id===r.factor_id);
    const name=document.createElement(calculable?'button':'span');name.textContent=r.name+' · '+r.factor_id;
    if(calculable)name.addEventListener('click',()=>selectFactor(r.factor_id,true));td.appendChild(name);tr.appendChild(td);
    const conflict=(r.blocked_by||[]).map(p=>p.factor_id+' (ρ='+num(p.rho,3)+')').join('、');
    [pctS(r.annualized_return),num(r.net_sharpe,3),num(r.gross_sharpe,3),num(r.preorientation_rank_ic,4),num(r.ic_mean,4),r.direction_multiplier<0?'−1 翻转':(r.direction_multiplier===1?'+1 保留':'—'),r.reason+(conflict?'；'+conflict:'')].forEach(v=>{const cell=document.createElement('td');cell.textContent=v;tr.appendChild(cell);});
    body.appendChild(tr);
  });
  if(!rows.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=8;td.textContent='当前设置没有此类因子。';tr.appendChild(td);body.appendChild(tr);}
}
function chooseView(view){
  state.view=view;applyView();
  if(view!=='overview'){
    const options=availableFactors(state.fMode);
    const id=options.some(f=>f.id===state.factor)?state.factor:options[0]?.id;
    if(id)selectFactor(id,false);
  }
}
function setupViews(){
  $$('.viewbar [data-view]').forEach(b=>b.addEventListener('click',()=>chooseView(b.dataset.view)));
  $$('.viewbar [role=tab]').forEach((b,i,buttons)=>b.addEventListener('keydown',e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();const next=buttons[(i+(e.key==='ArrowRight'?1:buttons.length-1))%buttons.length];next.focus();next.click();}}));
  const update=()=>{
    state.ovMode=state.fMode=$('#view-mode').value;state.ovHold=state.fHold=Number($('#view-hold').value);
    ['ov-mode','f-mode','corr-mode'].forEach(id=>$('#'+id).value=state.fMode);
    ['ov-hold','f-hold'].forEach(id=>$('#'+id).value=String(state.fHold));
    renderOverview();renderCorrelations();chooseView(state.view);
  };
  $('#view-mode').addEventListener('change',update);$('#view-hold').addEventListener('change',update);
  chooseView('overview');
}

/* ── 启动 ───────────────────────────────────────────────── */
let booted = false;
function boot() {
  if (booted) return;
  booted = true;
  const meta = INDEX.meta || {};
  $('#eyebrow-range').textContent = meta.dateStart + ' → ' + meta.dateEnd + '　·　' + meta.nSymbols + ' 只证券　·　' + meta.nDates + ' 个交易日';
  $('#specs').innerHTML = [
    ['已测因子', String(INDEX.factors.length)],
    ['分组', '20 组（Q01 低 → Q20 高）'],
    ['新版资金', '50% 多头 + 50% 空头担保，不借现金'],
    ['费率', '单边 ' + (meta.feeOneWay * 10000) + 'bp'],
    ['持仓期', '1 / 5 / 21 个交易日'],
    ['口径', '后复权现金分红、后复权分红再投'],
    ['方向', '各口径及持仓期：全样本 IC 定向']
  ].map(m => '<dt>' + m[0] + '</dt><dd>' + m[1] + '</dd>').join('');

  options($('#ov-mode'), MODES, state.ovMode);
  options($('#ov-hold'), HOLDS, String(state.ovHold));
  options($('#f-mode'), MODES, state.fMode);
  options($('#f-hold'), HOLDS, String(state.fHold));
  options($('#corr-mode'), MODES, 'reinvest');
  options($('#corr-group'), [['all','当前口径已测的因子']].concat([...new Set(INDEX.factors.map(f=>f.group))].sort().map(g=>[g,g])), 'all');
  ['corr-mode','corr-group','corr-min','corr-source'].forEach(id=>$('#'+id).addEventListener('change',renderCorrelations));
  if(BENCH)$('#benchmark-note').textContent='用户提供的基准快照，不参与选股。';else $('#benchmark-note').textContent='本次未提供指数基准；图中展示策略净值与回撤。';

  refreshFactorList();

  $('#ov-mode').addEventListener('change', e => { state.ovMode = e.target.value; renderOverview(); });
  $('#ov-hold').addEventListener('change', e => { state.ovHold = e.target.value; renderOverview(); });
  $('#f-mode').addEventListener('change', e => { state.fMode = e.target.value; refreshFactorList();renderFactor(); });
  $('#f-hold').addEventListener('change', e => { state.fHold = e.target.value; renderFactor(); });
  const search = $('#f-search');
  const commit = () => {
    const raw = search.value.trim();
    if (!raw) return;
    const exact = availableFactors(state.fMode).find(f => f.id.toLowerCase() === raw.toLowerCase());
    if (exact) { selectFactor(exact.id, false); return; }
    const hits = availableFactors(state.fMode).filter(f => f.id.toLowerCase().indexOf(raw.toLowerCase()) === 0);
    if (hits.length === 1) { selectFactor(hits[0].id, false); return; }
    const any = availableFactors(state.fMode).filter(f => (f.id+' '+f.name+' '+f.function).toLowerCase().includes(raw.toLowerCase()));
    if (any.length) { selectFactor(any[0].id, false); return; }
    search.value = state.factor || '';
  };
  search.addEventListener('change', commit);
  search.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });

  $('#colophon').innerHTML='真实历史回测仅验证此实现可以运行。双复权分别计算，并按全样本 IC 翻转负方向；筛选结果属于样本内事后诊断。现有公司行动与样本覆盖限制见 <a href="methodology.md">方法说明</a>；所有历史版本和阻塞原因保留。';
  renderOverview();
  renderCorrelations();
  setupViews();
}

/** 默认选中当前切片 年化收益中位数附近的因子：代表性默认值，避免用最优因子当门面。 */
function defaultFactorId() {
  const s = sliceOf(state.ovMode, state.ovHold) || sliceOf('reinvest', '21');
  if (s && s.points && s.points.length) {
    const sorted = s.points.filter(p => isNum(p.a)).slice().sort((a, b) => a.a - b.a);
    if (sorted.length) return sorted[Math.floor(sorted.length / 2)].id;
  }
  const first = INDEX.factors.find(f => f.id);
  return first ? first.id : null;
}
window.selectLibraryFactor=id=>selectFactor(id,true);
document.addEventListener('DOMContentLoaded', boot);
if (document.readyState !== 'loading') boot();
})();
