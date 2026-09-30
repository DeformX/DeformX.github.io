
/* ropeviz viewer runtime — canvas-2D, zero dependencies.
 *
 * One renderer serves both page kinds:
 *   DY.player(id, spec)  animated swing replay (timeline + samples)
 *   DY.scene(id, spec)   posed rig (optional joint sliders, live clearances)
 *
 * Everything is world-frame metres, env-local (base at ARM.base_pos), matching
 * `sim_engine/data/robot_kin.npz` and every `*_viz.npz` the repo exports.
 * Colours are either CSS custom-property names ('--wire') or literals.
 */
window.DY = (function () {
'use strict';

/* ------------------------------------------------------------------ util */
const R2D = 180 / Math.PI, D2R = Math.PI / 180;

/* Theme tokens are read dozens of times per frame; getComputedStyle forces a
   style recalculation on every call, so the uncached version cost ~114 forced
   recalcs per frame and showed up as jitter. Cache, and invalidate on any
   theme change. `themeGen` lets downstream caches (chart bitmaps) do the same. */
let _tok = Object.create(null);
let themeGen = 0;
function css(v) {
  const c = _tok[v];
  if (c !== undefined) return c;
  return (_tok[v] = getComputedStyle(document.documentElement)
                      .getPropertyValue(v).trim());
}
function themeChanged() {
  _tok = Object.create(null);
  themeGen++;
  for (const k in _viewers) _viewers[k].draw();
  if (DY.redrawCharts) DY.redrawCharts();
}
if (window.matchMedia) {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  if (mq.addEventListener) mq.addEventListener('change', themeChanged);
}
new MutationObserver(themeChanged).observe(document.documentElement,
  { attributes: true, attributeFilter: ['data-theme', 'class'] });
function col(c, dflt) {
  if (!c) return css(dflt || '--s1');
  return c.charAt(0) === '-' ? css(c) : c;
}
function rgba(c, a) {
  const h = col(c);
  if (h.charAt(0) !== '#') return h;
  const s = h.length === 4
    ? [0, 1, 2].map(i => parseInt(h[i + 1] + h[i + 1], 16))
    : [0, 1, 2].map(i => parseInt(h.substr(1 + i * 2, 2), 16));
  return `rgba(${s[0]},${s[1]},${s[2]},${a})`;
}
function shade(c, t) {                       /* multiply a colour by t */
  const h = col(c);
  if (h.charAt(0) !== '#') return h;
  const s = [0, 1, 2].map(i => parseInt(h.substr(1 + i * 2, 2), 16));
  const o = s.map(v => Math.round(Math.min(255, Math.max(0, v * t))));
  return `rgb(${o[0]},${o[1]},${o[2]})`;
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
                       a[0] * b[1] - a[1] * b[0]];
const nrm = a => { const n = Math.hypot(a[0], a[1], a[2]) || 1; return scl(a, 1 / n); };
const lerp3 = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u,
                            a[2] + (b[2] - a[2]) * u];
function el(id) { return typeof id === 'string' ? document.getElementById(id) : id; }
function mk(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}
/* interpolate a [T][K][3] array at float frame f */
function frameOf(arr, f) {
  const i = Math.max(0, Math.min(Math.floor(f), arr.length - 2));
  if (arr.length < 2) return arr[0];
  const u = Math.max(0, Math.min(1, f - i));
  return arr[i].map((p, k) => lerp3(p, arr[i + 1][k], u));
}
function frameOf1(arr, f) {                  /* [T][3] */
  const i = Math.max(0, Math.min(Math.floor(f), arr.length - 2));
  if (arr.length < 2) return arr[0];
  return lerp3(arr[i], arr[i + 1], Math.max(0, Math.min(1, f - i)));
}

/* rotate v about unit axis n by angle a (Rodrigues) */
function rot3(v, n, a) {
  const c = Math.cos(a), si = Math.sin(a), d = dot3(n, v);
  return [v[0] * c + (n[1] * v[2] - n[2] * v[1]) * si + n[0] * d * (1 - c),
          v[1] * c + (n[2] * v[0] - n[0] * v[2]) * si + n[1] * d * (1 - c),
          v[2] * c + (n[0] * v[1] - n[1] * v[0]) * si + n[2] * d * (1 - c)];
}

/* ------------------------------------------------- kinematics (PoE, UR5e) */
let ARM = null;                              /* payload from ropeviz.armdata */
function setArm(a) { ARM = a; _sx = null; }
function mul(A, B) {
  const C = new Float64Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    let s = 0; for (let k = 0; k < 4; k++) s += A[i * 4 + k] * B[k * 4 + j];
    C[i * 4 + j] = s;
  }
  return C;
}
function xf(T, p) {
  return [T[0] * p[0] + T[1] * p[1] + T[2] * p[2] + T[3],
          T[4] * p[0] + T[5] * p[1] + T[6] * p[2] + T[7],
          T[8] * p[0] + T[9] * p[1] + T[10] * p[2] + T[11]];
}
function rot(T, v) {                          /* rotate only */
  return [T[0] * v[0] + T[1] * v[1] + T[2] * v[2],
          T[4] * v[0] + T[5] * v[1] + T[6] * v[2],
          T[8] * v[0] + T[9] * v[1] + T[10] * v[2]];
}
function expScrew(om, pt, th) {
  const T = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  if (Math.abs(th) < 1e-12) return T;
  const w = nrm(om), v = scl(crs(w, pt), -1);
  const K = [[0, -w[2], w[1]], [w[2], 0, -w[0]], [-w[1], w[0], 0]];
  const K2 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    let s = 0; for (let k = 0; k < 3; k++) s += K[i][k] * K[k][j];
    K2[i][j] = s;
  }
  const s = Math.sin(th), c = Math.cos(th);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const I = i === j ? 1 : 0;
      T[i * 4 + j] = I + s * K[i][j] + (1 - c) * K2[i][j];
    }
    let acc = 0;
    for (let j = 0; j < 3; j++) {
      const I = i === j ? 1 : 0;
      acc += (I * th + (1 - c) * K[i][j] + (th - s) * K2[i][j]) * v[j];
    }
    T[i * 4 + 3] = acc;
  }
  return T;
}
/* q [6] -> world transform of every link, flat row-major 4x4 */
function fk(q) {
  const NL = ARM.link_names.length, out = new Array(NL);
  let p = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  for (let k = 0; k < NL; k++) {
    if (k > 0) p = mul(p, expScrew(ARM.omega[k - 1], ARM.point[k - 1],
                                   q[k - 1] - ARM.home_q[k - 1]));
    out[k] = mul(p, ARM.T_home[k]);
  }
  return out;
}
/* minimum distance between segments p1q1 and p2q2 (ropesim_tasks/collision.py) */
function segDist(p1, q1, p2, q2) {
  const d1 = sub(q1, p1), d2 = sub(q2, p2), r = sub(p1, p2);
  const a = dot3(d1, d1), e = dot3(d2, d2), f = dot3(d2, r),
        c = dot3(d1, r), b = dot3(d1, d2);
  const den = a * e - b * b;
  let s = den > 1e-9 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
  const t = Math.min(1, Math.max(0, (b * s + f) / Math.max(e, 1e-9)));
  s = Math.min(1, Math.max(0, (t * b - c) / Math.max(a, 1e-9)));
  return Math.hypot(...sub(add(p1, scl(d1, s)), add(p2, scl(d2, t))));
}
/* every clearance the pipeline checks (and the two it does not), for a pose */
function clearances(T, world) {
  const W = world || {};
  const wallY = W.wall ? W.wall.y : ARM.base_pos[1];
  const keepZ = (W.plane ? W.plane.z : 0) ;
  const ee = xf(T[ARM.ee_idx], [0, 0, 0]);
  const tip = xf(T[ARM.ee_idx], [0, 0, ARM.tube_len]);
  const caps = {};
  for (const k in ARM.capsules) {
    const c = ARM.capsules[k];
    caps[k] = { a: xf(T[+k], c.a), b: xf(T[+k], c.b), r: c.r };
  }
  let stickArm = Infinity, stickArmLink = -1;
  for (const k of ARM.stick_arm_links) {
    const c = caps[k], gap = segDist(ee, tip, c.a, c.b) - (c.r + ARM.stick_r);
    if (gap < stickArm) { stickArm = gap; stickArmLink = k; }
  }
  let wall = Math.min(ee[1], tip[1]) - ARM.stick_r - wallY, wallWho = 'stick';
  for (const k of ARM.wall_check_links) {
    const c = caps[k], v = Math.min(c.a[1], c.b[1]) - c.r - wallY;
    if (v < wall) { wall = v; wallWho = ARM.link_names[k]; }
  }
  let floor = Math.min(ee[2], tip[2]) - ARM.stick_r - keepZ, floorWho = 'stick';
  for (const k in caps) {
    const c = caps[k], v = Math.min(c.a[2], c.b[2]) - c.r - keepZ;
    if (v < floor) { floor = v; floorWho = ARM.link_names[+k]; }
  }
  const wireEnd = [tip[0], tip[1], tip[2] - ARM.rope_len];
  let wire = Infinity, wireWho = '';
  for (const k in caps) {
    const c = caps[k];
    const gap = segDist(tip, wireEnd, c.a, c.b) - (c.r + 0.00635);
    if (gap < wire) { wire = gap; wireWho = ARM.link_names[+k]; }
  }
  /* overhead keep-out (hardware.STICK_TIP_MAX_Z, 2026-08-31): how far the
     STICK TIP is BELOW the ceiling. Negative = illegal, same sign convention
     as the other clearances. Bounds the stick only, not the rope. */
  const ceilZ = (ARM && ARM.stick_tip_max_z) || 2.7;
  const ceil = ceilZ - (tip[2] + ARM.stick_r);
  return { ee, tip, caps, stickArm, stickArmLink, wall, wallWho,
           floor, floorWho, wire, wireWho, wireEndZ: wireEnd[2], ceil, ceilZ,
           reach: Math.hypot(...sub(tip, ARM.base_pos)) };
}
/* the wire hanging straight down from `tip`, pooling on the keep-out plane */
function restingWire(tip, keepZ, nv) {
  const N = nv || (ARM ? ARM.rope_verts : 21), L = ARM ? ARM.rope_len : 1.0;
  const hang = Math.min(L, Math.max(0, tip[2] - keepZ)), out = [];
  for (let i = 0; i < N; i++) {
    const s = i * L / (N - 1);
    out.push(s > hang ? [tip[0], tip[1] + (s - hang), keepZ]
                      : [tip[0], tip[1], tip[2] - s]);
  }
  return out;
}

/* ------------------------------------------------------------------ view */
const LIGHT = nrm([0.45, -0.75, 0.55]);

class View {
  constructor(canvas, o) {
    o = o || {};
    this.cv = canvas;
    this.g = canvas.getContext('2d');
    // The robot faces +Y, so the home camera sits on the front (+Y) side.
    this.yaw = o.yaw !== undefined ? o.yaw : 0.75;
    this.pitch = o.pitch !== undefined ? o.pitch : 0.24;
    this.d0 = o.dist || 5.0;
    const t = o.target || [0, 1.2, 1.2];
    this.cx = t[0]; this.cy = t[1]; this.cz = t[2];
    this.fov = o.fov || 1.25;
    /* read ONCE — see the note on resize() */
    this.cssH = +canvas.getAttribute('height') || 600;
    canvas.style.height = this.cssH + 'px';
    this.W = 0; this.H = 0;
    this.home = { yaw: this.yaw, pitch: this.pitch, d0: this.d0,
                  cx: this.cx, cy: this.cy, cz: this.cz };
    /* global alpha MULTIPLIER, applied by every primitive on top of its own
       alpha. Set it, draw a whole swing's worth of primitives, set it back:
       that is how one figure holds one solid trajectory and N ghosts without
       every drawer growing an alpha argument. */
    this.amul = 1;
    this.onchange = o.onchange || function () {};
    this._bind();
  }
  reset() { Object.assign(this, this.home); this.onchange(); }
  /* named orientations; keeps the current target and distance */
  preset(name) {
    const P = { iso: [0.75, 0.24], front: [Math.PI / 2, 0.06],
                side: [0.0, 0.06], top: [-Math.PI / 2, 1.32] };
    const p = P[name] || P.iso;
    this.yaw = p[0]; this.pitch = p[1]; this.onchange();
  }
  cam() {
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const eye = [this.cx + this.d0 * cp * cy, this.cy + this.d0 * cp * sy,
                 this.cz + this.d0 * sp];
    const fwd = scl(sub([this.cx, this.cy, this.cz], eye), 1 / this.d0);
    const rt = nrm([fwd[1], -fwd[0], 0]);
    return { eye, fwd, rt, up: crs(rt, fwd), f: this.fov * this.H };
  }
  /* THE TRAP: assigning `canvas.height` writes through to the `height` content
     attribute. Re-reading that attribute as the CSS height therefore feeds the
     backing-store size back into itself, and on any display with
     devicePixelRatio > 1 the canvas doubles every frame — the page grows
     without bound, layout reflows continuously, and the figure jitters and
     blinks. `cssH` is captured once and is the only source of truth. */
  resize() {
    /* capped: a 3x display would otherwise rasterise 9x the pixels for no
       visible gain, and the mesh painter is fill-rate bound. */
    const r = Math.min(window.devicePixelRatio || 1, 2);
    const h = this.cssH;
    const w = this.cv.clientWidth || 800;
    const bw = Math.min(8192, Math.round(w * r));
    const bh = Math.min(8192, Math.round(h * r));
    if (this.cv.width !== bw || this.cv.height !== bh) {
      this.cv.width = bw; this.cv.height = bh;
      this.cv.style.height = h + 'px';
    }
    this.W = w; this.H = h;
    this.g.setTransform(r, 0, 0, r, 0, 0);
    this.g.clearRect(0, 0, w, h);
    this.g.lineJoin = 'round';
    this.g.font = '12px ' + (css('--mono') || 'monospace');
  }
  proj(p) {
    const cm = this._cm, r = sub(p, cm.eye);
    const z = dot3(r, cm.fwd);
    if (z < 0.08) return null;
    return [this.W / 2 + cm.f * dot3(r, cm.rt) / z,
            this.H / 2 - cm.f * dot3(r, cm.up) / z, z];
  }
  begin() { this.resize(); this._cm = this.cam(); }
  /* --- primitives ------------------------------------------------------ */
  poly(pts, color, width, alpha, dash) {
    const g = this.g;
    g.strokeStyle = col(color, '--ink3');
    g.lineWidth = width || 1;
    g.globalAlpha = (alpha === undefined ? 1 : alpha) * this.amul;
    if (dash) g.setLineDash(dash);
    g.beginPath();
    let on = false;
    for (const p of pts) {
      const s = this.proj(p);
      if (!s) { on = false; continue; }
      if (!on) { g.moveTo(s[0], s[1]); on = true; } else g.lineTo(s[0], s[1]);
    }
    g.stroke();
    if (dash) g.setLineDash([]);
    g.globalAlpha = 1;
  }
  ropeline(pts, color, width, alpha) {
    this.g.lineCap = 'round';
    this.poly(pts, color, width, alpha);
    this.g.lineCap = 'butt';
  }
  dot(p, r, color, alpha) {
    const s = this.proj(p);
    if (!s) return null;
    const g = this.g;
    g.fillStyle = col(color, '--ink');
    g.globalAlpha = (alpha === undefined ? 1 : alpha) * this.amul;
    g.beginPath(); g.arc(s[0], s[1], r, 0, 7); g.fill();
    g.globalAlpha = 1;
    return s;
  }
  /* screen-space capsule: a round-capped line whose width tracks depth */
  tube(a, b, r, color, alpha) {
    const pa = this.proj(a), pb = this.proj(b);
    if (!pa || !pb) return;
    const g = this.g;
    g.strokeStyle = col(color, '--stick');
    g.lineWidth = Math.max(1.2, this._cm.f * 2 * r / Math.max(pa[2], pb[2]));
    g.lineCap = 'round';
    g.globalAlpha = (alpha === undefined ? 1 : alpha) * this.amul;
    g.beginPath(); g.moveTo(pa[0], pa[1]); g.lineTo(pb[0], pb[1]); g.stroke();
    g.globalAlpha = 1; g.lineCap = 'butt';
  }
  quad(pts, fill, alpha, stroke) {
    const s = pts.map(p => this.proj(p));
    if (!s.every(Boolean)) return;
    const g = this.g;
    g.beginPath(); g.moveTo(s[0][0], s[0][1]);
    for (let i = 1; i < s.length; i++) g.lineTo(s[i][0], s[i][1]);
    g.closePath();
    if (fill) { g.globalAlpha = (alpha === undefined ? 0.15 : alpha) * this.amul;
                g.fillStyle = col(fill); g.fill(); }
    if (stroke) { g.globalAlpha = Math.min(1, (alpha === undefined ? 0.15 : alpha) * 3)
                                  * this.amul;
                  g.strokeStyle = col(stroke); g.lineWidth = 1.2; g.stroke(); }
    g.globalAlpha = 1;
  }
  /* a circle of radius `r` centred at `c`, lying in the plane normal to `n` */
  circle3(c, n, r, seg) {
    const N = nrm(n);
    let u = Math.abs(N[2]) < 0.9 ? crs(N, [0, 0, 1]) : crs(N, [1, 0, 0]);
    u = nrm(u);
    const v = crs(N, u), out = [], K = seg || 48;
    for (let i = 0; i <= K; i++) {
      const a = 2 * Math.PI * i / K;
      out.push(add(c, add(scl(u, r * Math.cos(a)), scl(v, r * Math.sin(a)))));
    }
    return out;
  }
  /* 3D shaft + screen-space arrowhead */
  arrow(a, b, color, width, dash) {
    const pa = this.proj(a), pb = this.proj(b);
    if (!pa || !pb) return;
    const g = this.g;
    this.poly([a, b], color, width || 2, 1, dash);
    const an = Math.atan2(pb[1] - pa[1], pb[0] - pa[0]);
    const s = Math.max(6, Math.min(13, this._cm.f * 0.035 / pb[2]));
    g.fillStyle = col(color, '--goal');
    g.globalAlpha = this.amul;
    g.beginPath(); g.moveTo(pb[0], pb[1]);
    g.lineTo(pb[0] - s * Math.cos(an - 0.42), pb[1] - s * Math.sin(an - 0.42));
    g.lineTo(pb[0] - s * Math.cos(an + 0.42), pb[1] - s * Math.sin(an + 0.42));
    g.closePath(); g.fill();
    g.globalAlpha = 1;
  }
  label(p, text, color, dx, dy) {
    const s = this.proj(p);
    if (!s) return;
    this.g.fillStyle = col(color, '--ink3');
    this.g.textAlign = 'left';
    this.g.globalAlpha = this.amul;
    this.g.fillText(text, s[0] + (dx === undefined ? 6 : dx),
                    s[1] + (dy === undefined ? 4 : dy));
    this.g.globalAlpha = 1;
  }
  /* screen point -> world ray direction (unnormalised is fine) */
  ray(sx, sy) {
    const cm = this._cm || this.cam();
    const a = (sx - this.W / 2) / cm.f, b = (this.H / 2 - sy) / cm.f;
    return add(cm.fwd, add(scl(cm.rt, a), scl(cm.up, b)));
  }
  /* where that ray meets the plane through p0 with normal n */
  onPlane(sx, sy, p0, n) {
    const cm = this._cm || this.cam(), d = this.ray(sx, sy);
    const den = dot3(d, n);
    if (Math.abs(den) < 1e-9) return null;
    return add(cm.eye, scl(d, dot3(sub(p0, cm.eye), n) / den));
  }
  /* closest point to that ray on the line through p0 along unit u */
  onAxis(sx, sy, p0, u) {
    /* standard line-line closest point: line P = p0 + t*u, ray Q = eye + s*d,
       |u| = |d| = 1, w0 = p0 - eye  =>  t = (b*(d.w0) - (u.w0)) / (1 - b^2) */
    const cm = this._cm || this.cam(), d = nrm(this.ray(sx, sy));
    const w0 = sub(p0, cm.eye);
    const b = dot3(u, d), den = 1 - b * b;
    if (Math.abs(den) < 1e-6) return null;
    return add(p0, scl(u, (b * dot3(d, w0) - dot3(u, w0)) / den));
  }
  /* frame the camera so `pts` (world points) all fit comfortably */
  fit(pts, pad) {
    if (!pts.length) return;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const p of pts) for (let i = 0; i < 3; i++) {
      if (p[i] < lo[i]) lo[i] = p[i];
      if (p[i] > hi[i]) hi[i] = p[i];
    }
    this.cx = (lo[0] + hi[0]) / 2; this.cy = (lo[1] + hi[1]) / 2;
    this.cz = (lo[2] + hi[2]) / 2;
    let rad = 0;                       /* max radius, not half-diagonal:  */
    for (const p of pts) {             /* the diagonal over-frames badly  */
      const d = Math.hypot(p[0] - this.cx, p[1] - this.cy, p[2] - this.cz);
      if (d > rad) rad = d;
    }
    this.d0 = Math.max(1.2, (pad || 1.25) * 2 * this.fov * rad);
    Object.assign(this.home, { cx: this.cx, cy: this.cy, cz: this.cz, d0: this.d0 });
  }
  _local(e) {
    const b = this.cv.getBoundingClientRect();
    return [e.clientX - b.left, e.clientY - b.top];
  }
  _bind() {
    const cv = this.cv, self = this;
    cv.style.touchAction = 'none';
    let drag = null, grab = null, held = false;
    /* `held` is separate from `grab` because a handle id of 0 is falsy — that
       exact bug sent the first waypoint's drag to the camera. */
    cv.addEventListener('pointerdown', e => {
      const L = self._local(e);
      /* an owner (the Viewer) gets first refusal: if the pointer is on a
         handle it takes the drag and the camera stays put. */
      grab = self.onGrabStart ? self.onGrabStart(L[0], L[1], e) : null;
      held = grab !== null && grab !== undefined;
      if (held) { cv.setPointerCapture(e.pointerId); e.preventDefault(); return; }
      drag = [e.clientX, e.clientY, e.shiftKey || e.button === 1 || e.button === 2];
      cv.setPointerCapture(e.pointerId); e.preventDefault();
    });
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('pointermove', e => {
      if (held) {
        const L = self._local(e);
        if (self.onGrabMove) self.onGrabMove(grab, L[0], L[1], e);
        return;
      }
      if (!drag) {
        if (self.onHover) { const L = self._local(e); self.onHover(L[0], L[1]); }
        return;
      }
      const dx = e.clientX - drag[0], dy = e.clientY - drag[1];
      if (drag[2]) {
        const cm = self.cam(), k = self.d0 / (self.fov * Math.max(1, self.H));
        self.cx -= dx * k * cm.rt[0] - dy * k * cm.up[0];
        self.cy -= dx * k * cm.rt[1] - dy * k * cm.up[1];
        self.cz -= dx * k * cm.rt[2] - dy * k * cm.up[2];
      } else {
        self.yaw -= dx * 0.008;
        self.pitch = Math.min(1.45, Math.max(-1.1, self.pitch + dy * 0.006));
      }
      drag = [e.clientX, e.clientY, drag[2]];
      self.onchange();
    });
    const release = () => {
      if (held && self.onGrabEnd) self.onGrabEnd(grab);
      held = false; grab = null; drag = null;
    };
    cv.addEventListener('pointerup', release);
    cv.addEventListener('pointercancel', release);
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      self.d0 = Math.min(24, Math.max(0.6, self.d0 * Math.exp(e.deltaY * 0.0012)));
      self.onchange();
    }, { passive: false });
  }
}

/* ----------------------------------------------------------- world layers */
function drawGrid(V, w) {
  const G = w.grid;
  if (!G) return;
  const z = G.z || 0, st = G.step || 0.5;
  for (let x = G.x0; x <= G.x1 + 1e-6; x += st) V.poly([[x, G.y0, z], [x, G.y1, z]], '--grid', 1, 0.55);
  for (let y = G.y0; y <= G.y1 + 1e-6; y += st) V.poly([[G.x0, y, z], [G.x1, y, z]], '--grid', 1, 0.55);
  V.poly([[G.x0, G.y0, z], [G.x1, G.y0, z], [G.x1, G.y1, z], [G.x0, G.y1, z],
          [G.x0, G.y0, z]], '--ink3', 1.4, 0.7);
}
function drawPlane(V, w) {
  const P = w.plane;
  if (!P) return;
  const G = w.grid || { x0: -2, x1: 2, y0: -0.5, y1: 3 };
  V.poly([[G.x0, G.y0, P.z], [G.x1, G.y0, P.z], [G.x1, G.y1, P.z],
          [G.x0, G.y1, P.z], [G.x0, G.y0, P.z]], '--warn', 1.3, 0.85, [6, 4]);
  if (P.label !== false) {
    /* screen-space, bottom-left: a world-anchored label lands on the arm from
       half the camera orbit. */
    const g = V.g;
    g.fillStyle = col('--warn'); g.textAlign = 'left';
    g.fillText((P.label || 'keep-out') + '  z = ' + P.z.toFixed(2) + ' m',
               10, V.H - 10);
  }
}
function drawWall(V, w) {
  const A = w.wall;
  if (!A) return;
  V.quad([[A.x0, A.y, A.z0], [A.x1, A.y, A.z0], [A.x1, A.y, A.z1], [A.x0, A.y, A.z1]],
         '--wall', 0.10, '--wall');
}
/* world-axis triad: x red, y green, z blue-ish, labelled, at the WORLD ORIGIN
   unless world.axes = {at, len} says otherwise. Visibility is the `axes`
   layer (off by default; the layer bar has the toggle). */
function drawAxes(V, w) {
  const A = (w.axes && typeof w.axes === 'object') ? w.axes : {};
  const o = A.at || [0, 0, 0], L = A.len || 0.5;
  const dirs = [[L, 0, 0], [0, L, 0], [0, 0, L]];
  const cols = ['--bad', '--good', '--s4'];
  const names = ['x', 'y', 'z'];
  for (let i = 0; i < 3; i++) {
    V.arrow(o, add(o, dirs[i]), cols[i], 1.8);
    V.label(add(o, scl(dirs[i], 1.12)), names[i], cols[i], 0, 4);
  }
}
function drawCloud(V, c) {
  const pts = c.pts, n = pts.length;
  const size = c.size || 2;
  const cA = col(c.color || '--good'), cB = col(c.color2 || '--bad');
  const g = V.g;
  for (let i = 0; i < n; i++) {
    const s = V.proj(pts[i]);
    if (!s) continue;
    const on = c.mask ? !!c.mask[i] : true;
    g.globalAlpha = c.alpha === undefined ? 0.55 : c.alpha;
    g.fillStyle = on ? cA : cB;
    if (on) { g.fillRect(s[0] - size / 2, s[1] - size / 2, size, size); }
    else {
      g.strokeStyle = cB; g.lineWidth = 1;
      g.beginPath();
      g.moveTo(s[0] - size, s[1] - size); g.lineTo(s[0] + size, s[1] + size);
      g.moveTo(s[0] + size, s[1] - size); g.lineTo(s[0] - size, s[1] + size);
      g.stroke();
    }
    g.globalAlpha = 1;
    if (c.dirs && c.dirs[i]) {
      const L = c.dir_len || 0.12;
      V.poly([pts[i], add(pts[i], scl(c.dirs[i], L))],
             c.dir_color || '--s4', 1.1, 0.7);
    }
  }
}

/* ------------------------------------------------------------- volume ---
 * A scalar field on voxel centres, as depth-sorted alpha splats. Far-to-near
 * so the compositing order is right, one screen-space square per cell whose
 * side tracks depth like every other primitive here.
 *
 * `Vo.clip` ({x|y|z: [lo, hi]}) and `Vo.thresh` are runtime state a page's
 * slice sliders write to — an unsliced 3-D volume is a brick, and slicing is
 * the only thing that makes one readable.
 */
function _ramp(stops, t) {                     /* piecewise-linear hex ramp */
  const n = stops.length - 1;
  const x = Math.max(0, Math.min(1, t)) * n;
  let i = Math.min(n - 1, Math.floor(x));
  const f = x - i;
  const a = _hex(stops[i]), b = _hex(stops[i + 1]);
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)},`
       + `${Math.round(a[1] + (b[1] - a[1]) * f)},`
       + `${Math.round(a[2] + (b[2] - a[2]) * f)})`;
}
const _hexMemo = Object.create(null);
function _hex(h) {
  let v = _hexMemo[h];
  if (v) return v;
  v = h.length === 4 ? [0, 1, 2].map(i => parseInt(h[i + 1] + h[i + 1], 16))
                     : [0, 1, 2].map(i => parseInt(h.substr(1 + i * 2, 2), 16));
  return (_hexMemo[h] = v);
}
/* Dark mode is a SELECTED ramp, not a flip of the light one: which of the two
   a page uses is decided by the surface it is actually drawn on. */
function _isDark() {
  const s = _hex((css('--card') || '#ffffff').trim().slice(0, 7) || '#ffffff');
  return (0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2]) < 128;
}
const LUT_N = 64;
function _volLut(Vo) {
  /* `Vo._cmapGen` lets a page swap the ramp at runtime (a colour control):
     bump it and the cached LUT is rebuilt on the next draw. */
  if (Vo._lut && Vo._lutGen === themeGen
      && Vo._lutCmapGen === (Vo._cmapGen || 0)) return Vo._lut;
  const stops = (_isDark() ? Vo.cmap_dark : Vo.cmap) || Vo.cmap;
  const lut = new Array(LUT_N);
  for (let i = 0; i < LUT_N; i++) lut[i] = _ramp(stops, i / (LUT_N - 1));
  Vo._lut = lut; Vo._lutGen = themeGen; Vo._lutCmapGen = Vo._cmapGen || 0;
  return lut;
}
/* A tip path drawn as a WINDOW around one frame: full strength inside, then
 * a smooth exponential fade outside, so a figure shows the part of the swing
 * that matters (the approach and the hit) without cutting the rest off with a
 * hard edge. `win` = {c: centre frame, frac: window as a fraction of the
 * path, fade: fraction over which it decays to nothing, bands: quantisation}.
 * Per-vertex alpha is not a canvas primitive, so the path is drawn as a few
 * constant-alpha runs — 10 bands is invisible as banding and costs 10 calls
 * instead of one per segment. */
function drawTipWindow(V, pts, win, color, width, base) {
  const n = pts.length;
  if (n < 2) return;
  const c = Math.max(0, Math.min(win.c === undefined ? n - 1 : win.c, n - 1));
  const half = Math.max(1, 0.5 * (win.frac === undefined ? 1 : win.frac) * n);
  const fade = Math.max(1e-6, (win.fade === undefined ? 0.25 : win.fade) * n);
  const nb = win.bands || 10;
  const a = new Array(n);
  for (let i = 0; i < n; i++) {
    const d = Math.abs(i - c) - half;
    a[i] = d <= 0 ? 1 : Math.exp(-(d / fade) * (d / fade) * 2.3);
  }
  let run = [pts[0]], lvl = Math.round(a[0] * nb);
  for (let i = 1; i < n; i++) {
    const l = Math.round(a[i] * nb);
    run.push(pts[i]);
    if (l !== lvl || i === n - 1) {
      if (lvl > 0 && run.length > 1) {
        V.poly(run, color, width, base * (lvl / nb));
      }
      run = [pts[i]];
      lvl = l;
    }
  }
}

function drawVolume(V, Vo) {
  const P = Vo.pts, v = Vo.v, n = P.length;
  if (!n) return;
  const lo = Vo.vmin, hi = Vo.vmax, span = (hi - lo) || 1;
  const lut = _volLut(Vo);
  const cl = Vo.clip || {}, th = Vo.thresh;
  const g = V.g, f = V._cm.f, base = Vo.alpha === undefined ? 0.55 : Vo.alpha;
  const gam = Vo.alpha_gamma || 0;
  /* one pass to project and cull, then sort the survivors far -> near */
  const sx = [], sy = [], sz = [], si = [];
  for (let i = 0; i < n; i++) {
    const p = P[i], t = (v[i] - lo) / span;
    if (th !== undefined && th !== null && v[i] < th) continue;
    if (cl.x && (p[0] < cl.x[0] || p[0] > cl.x[1])) continue;
    if (cl.y && (p[1] < cl.y[0] || p[1] > cl.y[1])) continue;
    if (cl.z && (p[2] < cl.z[0] || p[2] > cl.z[1])) continue;
    const s = V.proj(p);
    if (!s) continue;
    sx.push(s[0]); sy.push(s[1]); sz.push(s[2]); si.push(i);
  }
  const ord = si.map((_, k) => k).sort((a, b) => sz[b] - sz[a]);
  for (const k of ord) {
    const i = si[k];
    const t = Math.max(0, Math.min(1, (v[i] - lo) / span));
    const side = Math.max(1.5, f * Vo.size / sz[k]);
    const css = lut[Math.min(LUT_N - 1, (t * LUT_N) | 0)];
    g.globalAlpha = (gam > 0 ? base * Math.pow(t, gam) : base) * V.amul;
    if (Vo.shape === 'gauss') {
      /* a Gaussian splat: the cell's own alpha falls off radially, so
         neighbouring cells blend into a field instead of tiling into a
         mosaic of squares. `Vo.sigma` (in cell widths, default 0.5) sets
         how quickly; the gradient is clamped at ~2.5 sigma where the
         contribution is already < 2 % and a wider circle only costs fill. */
      const sig = (Vo.sigma || 0.5) * side, rad = Math.max(1.0, 2.5 * sig);
      const gr = g.createRadialGradient(sx[k], sy[k], 0, sx[k], sy[k], rad);
      /* the LUT holds `rgb(r,g,b)` strings (_ramp), not hex — parse those,
         and fall back to hex for a caller that passed one straight through */
      const rgb = css[0] === '#' ? _hex(css)
                                 : css.slice(4, -1).split(',').map(Number);
      for (let q = 0; q <= 4; q++) {
        const r = q / 4, a = Math.exp(-0.5 * (r * rad / sig) ** 2);
        gr.addColorStop(r, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a.toFixed(3)})`);
      }
      g.fillStyle = gr;
      g.beginPath(); g.arc(sx[k], sy[k], rad, 0, 7); g.fill();
    } else if (Vo.shape === 'dot') {
      g.fillStyle = css;
      g.beginPath(); g.arc(sx[k], sy[k], side / 2, 0, 7); g.fill();
    } else {
      g.fillStyle = css;
      g.fillRect(sx[k] - side / 2, sy[k] - side / 2, side, side);
    }
  }
  g.globalAlpha = 1;
}

/* ------------------------------------------------------------- handles ---
 * A handle is a world point the user can grab and drag. Dragging happens on a
 * plane through the handle: screen-parallel by default (what "just move it"
 * means), or constrained to one world axis while a key is held. The viewer
 * only reports the new position — what it means is the caller's business.
 */
function drawHandles(V, list, state) {
  for (const h of list) {
    if (h.kind === 'ring') {
      const act = state && state.id === h.id;
      const hov = state && state.hover === h.id;
      V.poly(V.circle3(h.c, h.axis, h.radius), h.color,
             act ? 2.6 : hov ? 2.2 : 1.5, act ? 1 : hov ? 0.9 : 0.55);
      if (act && state.ring) {
        /* the live spoke + angle, so a drag reads as rotation, not magic */
        const g = V.g, rg = state.ring;
        const sp = add(h.c, scl(rot3(rg.v0, rg.n, state.angle || 0), h.radius));
        V.poly([h.c, sp], h.color, 1.6, 0.9);
        const sc = V.proj(sp);
        if (sc) {
          g.fillStyle = col(h.color);
          g.font = '12px ' + (css('--mono') || 'monospace');
          g.fillText(((state.angle || 0) * R2D).toFixed(0) + '\u00b0',
                     sc[0] + 8, sc[1] - 8);
        }
      }
      continue;
    }
    const s = V.proj(h.p);
    if (!s) continue;
    const act = state && state.id === h.id;
    const hov = state && state.hover === h.id;
    const g = V.g, r = h.r || 6;
    g.globalAlpha = act ? 1 : hov ? 0.95 : 0.8;
    g.fillStyle = col(h.color, '--s4');
    g.beginPath(); g.arc(s[0], s[1], r, 0, 7); g.fill();
    g.globalAlpha = 1;
    g.strokeStyle = css('--card'); g.lineWidth = 1.5;
    g.beginPath(); g.arc(s[0], s[1], r, 0, 7); g.stroke();
    if (act || hov) {
      g.strokeStyle = col(h.color, '--s4'); g.lineWidth = 1.2;
      g.beginPath(); g.arc(s[0], s[1], r + 4.5, 0, 7); g.stroke();
    }
    if (h.label) {
      g.fillStyle = css('--ink');
      g.font = '10px ' + (css('--mono') || 'monospace');
      g.textAlign = 'center';
      g.fillText(h.label, s[0], s[1] + 3.5);
      g.textAlign = 'left';
      g.font = '12px ' + (css('--mono') || 'monospace');
    }
  }
}

/* -------------------------------------------------------------- the paths */
/* A Path is a bare 3-D polyline with a GROUP: the component bar toggles
 * groups, so "rope tip", "stick tip", "filtered sections" and "training
 * targets" become four buttons over the same viewport instead of four figures.
 *
 * `mask` marks the frames that count (a gate window, an accepted piece). The
 * masked runs draw at full weight and the rest fade to `mask_alpha` — or
 * vanish entirely with `mask_only`, which is how a "filtered" group sits on
 * top of the same trajectory the "whole path" group draws.
 */
function drawPath(V, P) {
  const c = P.color || '--s3', w = P.width || 1.6;
  const al = P.alpha === undefined ? 0.85 : P.alpha;
  if (!P.mask) { V.poly(P.pts, c, w, al, P.dash); return; }
  if (!P.mask_only) {
    V.poly(P.pts, c, Math.max(1, w * 0.7),
           al * (P.mask_alpha === undefined ? 0.18 : P.mask_alpha), P.dash);
  }
  let run = null;                                  /* the masked runs, solid */
  for (let i = 0; i < P.pts.length; i++) {
    if (P.mask[i]) { (run || (run = [])).push(P.pts[i]); }
    else if (run) { if (run.length > 1) V.poly(run, c, w, al, P.dash); run = null; }
  }
  if (run && run.length > 1) V.poly(run, c, w, al, P.dash);
}
/* every group a viewer knows about, in first-seen order */
function pathGroups(vw) {
  const out = [], seen = {};
  const add = (g, color) => {
    if (!g || seen[g]) return;
    seen[g] = 1; out.push({ key: g, color: color });
  };
  for (const P of (vw.world.paths || [])) add(P.group, P.color);
  for (const c of (vw.world.clouds || [])) add(c.group, c.color);
  for (const s of vw.samples) {
    for (const P of (s.paths || [])) add(P.group, P.color);
    if (s.cloud) add(s.cloud.group, s.cloud.color);
  }
  return out;
}
function groupOn(vw, g) {
  return !g || vw.groups[g] !== false;
}

/* --------------------------------------------------------------- the goal */
/* The 4D acceptance region: a dihedral WEDGE, not a cone.
 *
 * When the metric scores only the IN-PLANE arrival angle about a free axis
 * (`G.axis` — in this project the radial axis zh = unit(BASE - p) of
 * `ropeswing.theta`), the accepted directions are every v whose component in
 * the plane normal to that axis lies within tol_deg of the target. That set is
 * bounded by two half-planes hinged on the axis and is UNBOUNDED along it: a
 * cone would draw a tolerance the metric never applies (it would claim the
 * radial tilt is scored) and would be wrong in both directions — too tight
 * near the axis, too loose away from it.
 *
 * So: the two boundary half-planes as translucent quads, the tolerance arc in
 * the plane at three heights so the wedge reads as a volume, and the free axis
 * itself dashed through the goal. */
function drawWedge(V, G, p, d, c) {
  const zh = nrm(G.axis);
  let u0 = sub(d, scl(zh, dot3(d, zh)));           /* d, projected in-plane */
  const n0 = Math.hypot(u0[0], u0[1], u0[2]);
  if (n0 < 1e-6) return;                           /* d ~ the axis: no angle */
  u0 = scl(u0, 1 / n0);
  const w = crs(zh, u0);
  const a = (G.tol_deg || 30) * D2R;
  const L = G.wedge_len || 0.30;                   /* in-plane extent */
  const h = G.wedge_half || 0.10;                  /* extent along the axis */
  const K = 20;
  const ray = t => add(scl(u0, Math.cos(t)), scl(w, Math.sin(t)));
  const sector = o => {                            /* the pie slice: THE angle */
    const pts = [o];
    for (let i = 0; i <= K; i++) pts.push(add(o, scl(ray(-a + 2 * a * i / K), L)));
    pts.push(o);
    return pts;
  };
  const lo = add(p, scl(zh, -h)), hi = add(p, scl(zh, h));
  const eP = ray(a), eM = ray(-a);
  /* The slice THROUGH the goal is the angle you read: filled, with its two
     boundary rays and a spoke fan so the angular structure survives an
     edge-on view (where a filled slab alone reads as a box). */
  V.quad(sector(p), c, 0.14, c);
  for (let k = -3; k <= 3; k++) {                  /* spokes, boundary strongest */
    const u = ray(a * k / 3), edge = Math.abs(k) === 3;
    V.poly([p, add(p, scl(u, L))], c, edge ? 1.6 : 1, edge ? 0.85 : 0.22);
  }
  /* the same slice at both ends of the drawn axis span — ARC only, never the
     closed outline: closing it draws a box, and a box is the one thing this
     region is not */
  V.poly(sector(lo).slice(1, -1), c, 1, 0.3);
  V.poly(sector(hi).slice(1, -1), c, 1, 0.3);
  for (const u of [eP, eM]) {                      /* the boundary half-planes */
    V.poly([add(lo, scl(u, L)), add(hi, scl(u, L))], c, 1.1, 0.4);
  }
  /* the hinge IS the free axis, and the region does not end where the drawing
     does — the dashes run past both slices to say so */
  V.poly([add(p, scl(zh, -1.45 * h)), add(p, scl(zh, 1.45 * h))],
         c, 1.4, 0.7, [3, 3]);
  if (G.wedge_label !== false) {
    V.label(add(p, scl(eP, L)), '\u00b1' + (G.tol_deg || 30) + '\u00b0', c, 4, -3);
  }
}
/* A 5D goal: position + arrival direction. Drawn as a tolerance sphere, a
 * "gate" ring perpendicular to the commanded direction, the direction arrow
 * itself, and the acceptance region the metric uses: the cone of tol_deg, or
 * — when `axis` is set — the 4D wedge above.
 *
 * Those three are independently suppressible, because a figure that overlays
 * many goals drowns in them: `show_point` false drops the tolerance circle,
 * the centre dot and the label; `show_dir` false drops the gate ring and the
 * arrow; `show_region` false drops the cone / wedge. All default to on. */
function drawGoal(V, G, tipNow) {
  const p = G.p, tol = G.tol === undefined ? 0.05 : G.tol;
  const c = G.color || '--goal';
  const d = tipNow ? Math.hypot(...sub(tipNow, p)) : null;
  const s = V.proj(p);
  if (!s) return d;
  const near = d !== null && d <= tol;
  const rPix = Math.max(3, V._cm.f * tol / s[2]);
  const g = V.g;
  if (G.show_point !== false) {
    g.strokeStyle = col(c); g.lineWidth = near ? 2.4 : 1.3;
    g.globalAlpha = (near ? 1 : 0.5) * V.amul;
    g.beginPath(); g.arc(s[0], s[1], rPix, 0, 7); g.stroke();
    g.globalAlpha = 1;
    V.dot(p, 3, c);
  }
  if (G.d && (G.show_dir !== false || G.show_region !== false)) {
    const dir = nrm(G.d), L = G.arrow_len || 0.40;
    if (G.show_dir !== false) {
      /* the gate: a ring the tip should pass through, normal to the direction */
      if (tol > 1e-4) {
        V.poly(V.circle3(p, dir, tol), c, near ? 2.0 : 1.2, near ? 0.95 : 0.55);
      }
      /* `arrow_from_p`: the arrow STARTS at the point rather than straddling
         it — a tangent at a measured point, not a gate to pass through */
      if (G.arrow_from_p) V.arrow(p, add(p, scl(dir, L)), c, 2);
      else V.arrow(sub(p, scl(dir, L * 0.35)), add(p, scl(dir, L * 0.65)), c, 2);
    }
    if (G.show_region === false) {
      /* nothing */
    } else if (G.axis) {
      drawWedge(V, G, p, dir, c);
    } else if (G.tol_deg) {
      const Lc = G.cone_len || 0.30, rc = Lc * Math.tan(G.tol_deg * D2R);
      const apex = sub(p, scl(dir, Lc));
      const ring = V.circle3(p, dir, rc, 40);
      V.poly(ring, c, 1, 0.32, [3, 3]);
      for (let i = 0; i < 40; i += 10) V.poly([apex, ring[i]], c, 1, 0.28, [3, 3]);
    }
  }
  if (G.achieved_d && G.show_dir !== false) {
    const L = G.arrow_len || 0.40;
    /* `achieved_ok` (when the caller knows the verdict) colours the arrow;
       with an axis, the arrival is shown PROJECTED into the scored plane —
       that projection is what the 4D angle is measured on, and the arc closes
       the gap to the target so the miss is a shape, not just a number. */
    let ad = nrm(G.achieved_d);
    const ac = G.achieved_ok === undefined ? '--s3'
             : (G.achieved_ok ? '--good' : '--bad');
    if (G.axis && G.d) {
      const zh = nrm(G.axis);
      const inp = sub(ad, scl(zh, dot3(ad, zh)));
      const n = Math.hypot(inp[0], inp[1], inp[2]);
      if (n > 1e-6) {
        ad = scl(inp, 1 / n);
        let u0 = sub(nrm(G.d), scl(zh, dot3(nrm(G.d), zh)));
        const n0 = Math.hypot(u0[0], u0[1], u0[2]);
        if (n0 > 1e-6) {                       /* arc from target to arrival */
          u0 = scl(u0, 1 / n0);
          const wv = crs(zh, u0);
          const th = Math.atan2(dot3(ad, wv), dot3(ad, u0));
          const R = L * 0.5, K = 20, arc = [];
          for (let i = 0; i <= K; i++) {
            const t = th * i / K;
            arc.push(add(p, scl(add(scl(u0, Math.cos(t)), scl(wv, Math.sin(t))), R)));
          }
          V.poly(arc, ac, 1.6, 0.9);
        }
      }
    }
    V.arrow(p, add(p, scl(ad, L * 0.65)), ac, 1.8, [5, 3]);
  }
  if (G.label && G.show_point !== false) {
    V.label(p, G.label, '--ink3', rPix + 5, 4);
  }
  return d;
}

/* ------------------------------------------------------------- the robot */
/* Painter's-algorithm mesh renderer.
 *
 * Two things here are load-bearing rather than cosmetic:
 *   * back-face culling — the UR5e link meshes have consistently outward
 *     winding (armdata checks the signed volume at build time and sets
 *     `cull` per link), so roughly half the triangles never reach the
 *     rasteriser. That halves fill cost AND removes the main source of
 *     depth-sort popping, where a back face and the front face covering it
 *     have nearly equal average depth and swap order between frames.
 *   * reused typed-array scratch — the previous version allocated four arrays
 *     per triangle per frame (~14 k allocations at 60 Hz).
 */
let _wx = null, _wy = null, _wz = null, _sx = null, _sy = null, _sz = null;
let _sok = null, _zs = null, _sh = null, _fa = null, _fb = null, _fc = null;
let _ord = null;
const SHADES = 32;
let _lut = null, _lutBase = '';

function _armBuffers() {
  if (_sx && _sx.length) return;
  let nv = 0, nf = 0;
  for (const L of ARM.links) { nv += L.v.length / 3; nf += L.f.length / 3; }
  _wx = new Float64Array(nv); _wy = new Float64Array(nv); _wz = new Float64Array(nv);
  _sx = new Float64Array(nv); _sy = new Float64Array(nv); _sz = new Float64Array(nv);
  _sok = new Uint8Array(nv);
  _zs = new Float64Array(nf); _sh = new Int32Array(nf);
  _fa = new Int32Array(nf); _fb = new Int32Array(nf); _fc = new Int32Array(nf);
  _ord = new Int32Array(nf);
}

/* A TRANSLUCENT arm has to be composited once, not per triangle. The painter
   below fills *and* strokes every face (the stroke is what closes the AA
   seams), so at alpha < 1 those strokes stack into a visible wireframe and
   every overlapping face darkens. Render the arm opaque off-screen, then lay
   the whole image down at the ghost's alpha — one composite, no wireframe, no
   double-blending. */
let _off = null, _offg = null;
function drawArmMesh(V, T) {
  if (V.amul >= 0.999) return _armMesh(V, T);
  const cv = V.cv, a = V.amul;
  if (!_off) {
    _off = document.createElement('canvas');
    _offg = _off.getContext('2d');
  }
  if (_off.width !== cv.width || _off.height !== cv.height) {
    _off.width = cv.width; _off.height = cv.height;
  }
  const r = cv.width / Math.max(1, V.W);        /* the scale resize() applied */
  _offg.setTransform(1, 0, 0, 1, 0, 0);
  _offg.clearRect(0, 0, _off.width, _off.height);
  _offg.setTransform(r, 0, 0, r, 0, 0);
  _offg.lineJoin = 'round';
  const g0 = V.g;
  V.g = _offg; V.amul = 1;
  try { _armMesh(V, T); } finally { V.g = g0; V.amul = a; }
  g0.save();
  g0.setTransform(1, 0, 0, 1, 0, 0);
  g0.globalAlpha = a;
  g0.drawImage(_off, 0, 0);
  g0.restore();
  g0.globalAlpha = 1;
}

function _armMesh(V, T) {
  _armBuffers();
  const cm = V._cm, e0 = cm.eye[0], e1 = cm.eye[1], e2 = cm.eye[2];
  const fw = cm.fwd, rt = cm.rt, up = cm.up, f = cm.f;
  const halfW = V.W / 2, halfH = V.H / 2;
  let vo = 0, n = 0;

  for (let k = 0; k < ARM.links.length; k++) {
    const L = ARM.links[k], M = T[k], Vt = L.v, F = L.f, nv = Vt.length / 3;
    const cull = L.cull !== false;
    for (let a = 0; a < nv; a++) {
      const x = Vt[a * 3], y = Vt[a * 3 + 1], z = Vt[a * 3 + 2], i = vo + a;
      const wx = M[0] * x + M[1] * y + M[2] * z + M[3];
      const wy = M[4] * x + M[5] * y + M[6] * z + M[7];
      const wz = M[8] * x + M[9] * y + M[10] * z + M[11];
      _wx[i] = wx; _wy[i] = wy; _wz[i] = wz;
      const rx = wx - e0, ry = wy - e1, rz = wz - e2;
      const d = rx * fw[0] + ry * fw[1] + rz * fw[2];
      if (d < 0.08) { _sok[i] = 0; continue; }
      _sok[i] = 1;
      _sz[i] = d;
      _sx[i] = halfW + f * (rx * rt[0] + ry * rt[1] + rz * rt[2]) / d;
      _sy[i] = halfH - f * (rx * up[0] + ry * up[1] + rz * up[2]) / d;
    }
    for (let t = 0; t < F.length; t += 3) {
      const ia = vo + F[t], ib = vo + F[t + 1], ic = vo + F[t + 2];
      if (!(_sok[ia] && _sok[ib] && _sok[ic])) continue;
      const ax = _wx[ia], ay = _wy[ia], az = _wz[ia];
      const ux = _wx[ib] - ax, uy = _wy[ib] - ay, uz = _wz[ib] - az;
      const vx = _wx[ic] - ax, vy = _wy[ic] - ay, vz = _wz[ic] - az;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (cull && nx * (e0 - ax) + ny * (e1 - ay) + nz * (e2 - az) <= 0) continue;
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      const lam = Math.abs((nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]) / nl);
      _fa[n] = ia; _fb[n] = ib; _fc[n] = ic;
      _zs[n] = (_sz[ia] + _sz[ib] + _sz[ic]) / 3;
      _sh[n] = Math.min(SHADES - 1, (lam * (SHADES - 1)) | 0);
      _ord[n] = n;
      n++;
    }
    vo += nv;
  }
  if (!n) return;

  const ord = _ord.subarray(0, n);
  ord.sort((a, b) => _zs[b] - _zs[a]);            /* far -> near, in place */

  const base = css('--metal');
  if (_lutBase !== base || !_lut) {               /* quantised shade palette:
        building a colour string per triangle was the second-biggest cost */
    _lut = new Array(SHADES);
    for (let i = 0; i < SHADES; i++)
      _lut[i] = shade(base, 0.55 + 0.75 * i / (SHADES - 1));
    _lutBase = base;
  }
  const g = V.g;
  g.lineWidth = 0.7;
  g.globalAlpha = V.amul;
  let cur = -1;
  for (let qi = 0; qi < n; qi++) {
    const i = ord[qi], sh = _sh[i];
    if (sh !== cur) { const c = _lut[sh]; g.fillStyle = c; g.strokeStyle = c; cur = sh; }
    const a = _fa[i], b = _fb[i], c2 = _fc[i];
    g.beginPath();
    g.moveTo(_sx[a], _sy[a]);
    g.lineTo(_sx[b], _sy[b]);
    g.lineTo(_sx[c2], _sy[c2]);
    g.closePath();
    g.fill();
    g.stroke();                                   /* closes the AA seams */
  }
  g.globalAlpha = 1;
}

function drawSkeleton(V, origins, color) {
  V.poly(origins, color || '--metal', 3.5, 0.95);
  for (const o of origins) V.dot(o, 2.6, color || '--metal');
}
function drawCapsules(V, M) {
  for (const k in M.caps) {
    const c = M.caps[k];
    const hit = (ARM.stick_arm_links.indexOf(+k) >= 0 && M.stickArm < 0) ||
                (ARM.wall_check_links.indexOf(+k) >= 0 && M.wall < 0);
    V.tube(c.a, c.b, c.r, hit ? '--bad' : '--ink3', 0.3);
  }
}

/* Everything the renderer needs from one sample at one float frame. Module
 * level, not a Viewer method, because the viewer resolves TWO kinds of sample:
 * the selected one at the playhead, and any number of ghosts each at a frame
 * of its own (Viewer.ghost). */
function resolveSample(s, f, world) {
  const out = { s, f, T: null, ee: null, tip: null, rope: null, tipNow: null };
  if (s.q && ARM) {
    const i = Math.min(Math.floor(f), s.q.length - 1);
    const j = Math.min(i + 1, s.q.length - 1), u = f - i;
    const qf = s.q[i].map((v, k) => v + (s.q[j][k] - v) * u);
    out.T = fk(qf);
    out.q = qf;
    out.M = clearances(out.T, world);
    out.ee = out.M.ee; out.tip = out.M.tip;
  } else if (s.links) {
    out.origins = frameOf(s.links, f);
    out.ee = out.origins[out.origins.length - 1];
    out.tip = s.tube ? frameOf1(s.tube, f) : null;
  }
  /* `tube` IS the rope root the simulator drove (scene.py: "tube [T,3] rope
     root"). When a swing carries it, it is GROUND TRUTH and wins over FK.
     Recomputing the tip from `q` re-derives an approximation, and the rope —
     which starts at the real root — then hangs off the end of the stick:
     by the PD tracking residual (~5 mm, comparable to the 11 mm stick
     radius) when `q` is the ACHIEVED trajectory, and by up to 1.8 m when a
     page supplies commanded targets. Before 2026-08-31 only the `s.links`
     branch honoured `tube`, so every page that shipped joints drew the
     detached version. */
  if (s.tube) out.tip = frameOf1(s.tube, f);
  if (s.rope) {
    out.rope = frameOf(s.rope, f);
    out.tipNow = out.rope[out.rope.length - 1];
  } else if (out.tip && world.plane) {
    out.rope = restingWire(out.tip, world.plane.z);
    out.tipNow = out.rope[out.rope.length - 1];
  }
  return out;
}

/* =========================================================== the viewer  */
const DEFAULT_WORLD = {
  grid: { z: 0, x0: -2.5, x1: 2.5, y0: -0.5, y1: 3.0, step: 0.5 },
  wall: { y: 0.0, x0: -1.8, x1: 1.8, z0: 0.0, z1: 2.8 },
  plane: { z: 0.05 }
};

class Viewer {
  constructor(canvas, spec) {
    this.spec = spec;
    this.samples = spec.samples || [];
    this.world = Object.assign({}, DEFAULT_WORLD, spec.world || {});
    if (spec.world && spec.world.wall === null) this.world.wall = null;
    if (spec.world && spec.world.plane === null) this.world.plane = null;
    if (spec.world && spec.world.grid === null) this.world.grid = null;
    this.cur = 0;
    this.f = 0;
    this.playing = spec.autoplay !== false;
    this.speed = spec.speed || 0.5;
    this.trail = spec.trail === undefined ? 36 : spec.trail;
    this.layers = Object.assign(
      { mesh: !!ARM, skeleton: false, capsules: false, wall: true, grid: true,
        plane: true, trail: true, path: true, goals: true, clouds: true,
        rope: true, labels: true, axes: false, volume: true },
      spec.layers || {});
    /* component groups (Path.group / Cloud.group): visible unless a Path says
       `on: false` or the caller pre-seeds spec.groups. Kept separate from
       `layers` because layers are the fixed furniture of every figure and
       groups are whatever THIS figure decided to draw. */
    this.groups = Object.assign({}, spec.groups || {});
    for (const src of [spec.world && spec.world.paths].concat(
        (spec.samples || []).map(x => x.paths))) {
      for (const P of (src || [])) {
        if (P.on === false && this.groups[P.group] === undefined) {
          this.groups[P.group] = false;
        }
      }
    }
    /* back-compat: a caller that passes world.axes config wants it visible,
       unless spec.layers said otherwise explicitly. */
    if (this.world.axes && !(spec.layers && 'axes' in spec.layers)) {
      this.layers.axes = true;
    }
    const self = this;
    this.V = new View(canvas, Object.assign({}, spec.view || {},
                                            { onchange: () => self.draw() }));
    this.V.onGrabStart = (x, y, e) => self._grabStart(x, y, e);
    this.V.onGrabMove = (id, x, y, e) => self._grabMove(id, x, y, e);
    this.V.onGrabEnd = id => self._grabEnd(id);
    this.V.onHover = (x, y) => self._hover(x, y);
    this.followers = spec.follow || [];
    this.hooks = spec.draw ? [spec.draw] : [];
    /* pre-hooks run after the world layers and BEFORE the selected sample's
       own content, so anything they draw stays underneath it. That ordering is
       the whole point: a figure that overlays ghost swings behind one solid
       trajectory cannot get it from `hooks`, which paint on top. */
    this.prehooks = spec.predraw ? [spec.predraw] : [];
    /* handles: [{id, p:[x,y,z], color, r, label, axis}] — set by the owner and
       re-read every frame, so the owner can move them freely. `onhandle(id, p,
       phase)` fires on 'start' | 'move' | 'end'. */
    this.handles = spec.handles || [];
    this.hstate = { id: null, hover: null, plane: null, axis: null, p0: null };
    this.onhandle = null;
    this.readout = spec.readout ? el(spec.readout) : null;
    if (spec.fit !== false) this.autofit();
  }
  get sample() { return this.samples[this.cur] || {}; }
  get nframes() {
    const s = this.sample;
    if (s.rope) return s.rope.length;
    if (s.q) return s.q.length;
    if (s.links) return s.links.length;
    return 1;
  }
  autofit() {
    const pts = [];
    for (const s of this.samples) {
      if (s.rope) for (let t = 0; t < s.rope.length; t += Math.ceil(s.rope.length / 12)) {
        pts.push(s.rope[t][0], s.rope[t][s.rope[t].length - 1]);
      }
      for (const G of (s.goals || [])) pts.push(G.p);
    }
    for (const G of (this.world.goals || [])) pts.push(G.p);
    /* clouds are content, not context: a coverage grid must be inside the
       initial framing. Subsampled — the extent is what matters. */
    const clouds = (this.world.clouds || []).concat(
      this.samples.map(s => s.cloud).filter(Boolean));
    for (const c of clouds) {
      const P = c.pts || [], st = Math.max(1, Math.floor(P.length / 64));
      for (let i = 0; i < P.length; i += st) pts.push(P[i]);
    }
    /* a heat map is the content of the figure it is in, so it must be inside
       the initial framing too */
    for (const Vo of (this.world.volumes || []).concat(
        this.samples.map(x => x.volume).filter(Boolean))) {
      const P = Vo.pts || [], st = Math.max(1, Math.floor(P.length / 64));
      for (let i = 0; i < P.length; i += st) pts.push(P[i]);
    }
    for (const s of this.samples) {
      if (s.q && ARM) { const M = clearances(fk(s.q[0]), this.world);
                        pts.push(M.ee, M.tip); }
      else if (s.links) pts.push(s.links[0][0], s.links[0][s.links[0].length - 1]);
    }
    if (ARM) pts.push(ARM.base_pos);
    /* the floor and the wall are context, not content — they must not drive
       the framing, or every figure ends up a postage stamp in the middle. */
    if (pts.length > 1) this.V.fit(pts, this.spec.pad || 1.25);
  }
  /* resolve everything the renderer needs at the current float frame */
  resolve() {
    return resolveSample(this.sample,
                         Math.min(this.f, Math.max(0, this.nframes - 1.001)),
                         this.world);
  }
  /* Draw ANOTHER sample at ITS OWN frame, underneath the selected one: the
   * ghost. `opt` = {alpha, arm: 'mesh'|'skeleton'|false, stick, rope, tip,
   * goals, width}. Call it from a pre-hook — one solid trajectory, N ghosts,
   * every one on a frame of its own. */
  ghost(s, f, opt) {
    if (!s) return;
    const o = opt || {}, V = this.V, L = this.layers;
    const nf = s.rope ? s.rope.length : (s.q ? s.q.length : 1);
    const R = resolveSample(s, Math.max(0, Math.min(f, nf - 1.001)), this.world);
    const prev = V.amul;
    V.amul = prev * (o.alpha === undefined ? 0.5 : o.alpha);
    const armMode = o.arm === undefined ? 'mesh' : o.arm;
    if (R.T && armMode === 'mesh' && L.mesh) drawArmMesh(V, R.T);
    else if (R.T && armMode) drawSkeleton(V, R.T.map(T => xf(T, [0, 0, 0])), '--ink3');
    else if (!R.T && R.origins && armMode) drawSkeleton(V, R.origins);
    if (o.stick !== false && R.ee && R.tip) {
      V.tube(R.ee, R.tip, ARM ? ARM.stick_r : 0.011, '--stick');
    }
    if (o.tip && s.rope) {
      if (!s._tip) s._tip = s.rope.map(fr => fr[fr.length - 1]);
      if (o.tipWin) {
        drawTipWindow(V, s._tip, Object.assign({ c: f }, o.tipWin),
                      s.color || '--wire', 1.2, o.tipAlpha || 0.5);
      } else {
        V.poly(s._tip, s.color || '--wire', 1.2, 0.25);
      }
    }
    /* drag effect: the rope at a few EARLIER frames, each fainter than the
       last, so a still frame carries the direction and speed of the swing.
       `o.drag` = {n, step, decay} (frames back, spacing, per-echo factor). */
    if (o.drag && o.drag.n && s.rope) {
      const D = o.drag, step = D.step || 4, dec = D.decay || 0.55;
      for (let k = D.n; k >= 1; k--) {
        const fk = f - k * step;
        if (fk < 0) continue;
        const Rk = resolveSample(s, fk, this.world);
        if (!Rk.rope) continue;
        const keep = V.amul;
        V.amul = keep * Math.pow(dec, k);
        V.ropeline(Rk.rope, s.color || '--wire', (o.width || 2.4) * 0.85);
        V.amul = keep;
      }
    }
    if (o.rope !== false && R.rope) {
      V.ropeline(R.rope, s.color || '--wire', o.width || 2.4);
      V.dot(R.tipNow, 3.4, s.color || '--wire');
    }
    if (o.goals !== false) {
      for (const G of (s.goals || [])) drawGoal(V, G, R.tipNow);
    }
    V.amul = prev;
  }
  draw() {
    const V = this.V, R = this.resolve(), s = R.s, L = this.layers;
    V.begin();
    if (L.grid) drawGrid(V, this.world);
    if (L.plane) drawPlane(V, this.world);
    if (L.wall) drawWall(V, this.world);
    if (L.axes) drawAxes(V, this.world);
    if (L.clouds) for (const c of (this.world.clouds || [])) {
      if (groupOn(this, c.group)) drawCloud(V, c);
    }
    if (L.clouds && s.cloud && groupOn(this, s.cloud.group)) drawCloud(V, s.cloud);
    /* the volume is context the rest of the scene sits inside, so it goes
       down before the arm and the ropes */
    if (L.volume !== false) {
      for (const Vo of (this.world.volumes || [])) {
        if (groupOn(this, Vo.group)) drawVolume(V, Vo);
      }
      if (s.volume && groupOn(this, s.volume.group)) drawVolume(V, s.volume);
    }

    for (const h of this.prehooks) h(V, R, this);

    /* full tip paths, faint — the shape of the swing at a glance */
    if (s.rope && !s._tip) s._tip = s.rope.map(fr => fr[fr.length - 1]);
    if (L.path && s._tip && this.tipWin) {
      drawTipWindow(V, s._tip, Object.assign({ c: this.f }, this.tipWin),
                    s.color || '--wire', 1.4, 0.7);
    } else if (L.path && s._tip) {
      V.poly(s._tip, s.color || '--wire', 1.2, 0.25);
    }
    /* the selected sample gets the same drag echoes as a ghost when the page
       asks for them (`viewer.drag = {n, step, decay}`) */
    if (this.drag && this.drag.n && R.rope) {
      const D = this.drag, step = D.step || 4, dec = D.decay || 0.55;
      for (let k = D.n; k >= 1; k--) {
        const fk = this.f - k * step;
        if (fk < 0) continue;
        const Rk = resolveSample(s, fk, this.world);
        if (!Rk.rope) continue;
        const keep = V.amul;
        V.amul = keep * Math.pow(dec, k);
        V.ropeline(Rk.rope, s.color || '--wire', 2.0);
        V.amul = keep;
      }
    }
    if (L.path) for (const o of (s.overlays || [])) {
      if (!o._tip && o.pts) o._tip = o.pts.map(fr => fr[fr.length - 1]);
      if (o._tip) V.poly(o._tip, o.color || '--s3', 1.1, 0.2);
    }
    if (L.path && s.ref) V.poly(s.ref, s.ref_color || '--s2', 1.4, 0.65, [5, 4]);

    /* the arm */
    if (R.T && L.mesh) drawArmMesh(V, R.T);
    if (R.T && L.capsules) drawCapsules(V, R.M);
    if (R.T && (L.skeleton || !L.mesh)) {
      drawSkeleton(V, R.T.map(T => xf(T, [0, 0, 0])), '--ink3');
    }
    if (!R.T && R.origins) drawSkeleton(V, R.origins);
    /* the rigid stick, EE -> rope root */
    if (R.ee && R.tip) V.tube(R.ee, R.tip, ARM ? ARM.stick_r : 0.011, '--stick');
    else if (R.origins && R.rope) {
      V.poly([R.origins[R.origins.length - 1], R.rope[0]], '--stick', 2.5);
    }

    /* rope overlays first, primary rope on top */
    if (L.rope) {
      for (const o of (s.overlays || [])) {
        if (!o.pts) continue;
        const pts = frameOf(o.pts, R.f);
        V.poly(pts, o.color || '--s3', 1.8, o.alpha === undefined ? 0.6 : o.alpha);
        V.dot(pts[pts.length - 1], 2.8, o.color || '--s3',
              o.alpha === undefined ? 0.6 : o.alpha);
      }
      if (R.rope) {
        V.ropeline(R.rope, s.color || '--wire', 2.4);
        V.dot(R.tipNow, 3.4, s.color || '--wire');
      }
    }
    /* fading recent tip trail */
    if (L.trail && s._tip && this.trail > 0) {
      const n = Math.floor(R.f), g = V.g;
      for (let k = Math.max(1, n - this.trail); k <= n; k++) {
        const a = V.proj(s._tip[k - 1]), b = V.proj(s._tip[k]);
        if (!a || !b) continue;
        g.strokeStyle = rgba(s.color || '--wire',
                             0.12 + 0.62 * (1 - (n - k) / this.trail));
        g.lineWidth = 1.8;
        g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
      }
    }

    /* named paths — the trajectory-overlay component; drawn under the goals
       so a target annotation always stays on top */
    if (L.paths !== false) {
      for (const P of (this.world.paths || [])) {
        if (groupOn(this, P.group)) drawPath(V, P);
      }
      for (const P of (s.paths || [])) {
        if (groupOn(this, P.group)) drawPath(V, P);
      }
    }

    /* goals — always last so the annotation stays readable */
    let dist = null;
    if (L.goals) {
      for (const G of (this.world.goals || [])) drawGoal(V, G, R.tipNow);
      for (const G of (s.goals || [])) {
        const d = drawGoal(V, G, R.tipNow);
        if (d !== null && (dist === null || d < dist)) dist = d;
      }
    }
    for (const m of (this.world.marks || [])) {
      V.dot(m.p, m.r || 3, m.color || '--s4');
      if (m.label) V.label(m.p, m.label, m.color || '--ink3');
    }

    if (this.handles.length) drawHandles(V, this.handles, this.hstate);
    if (L.labels) this.hud(R, dist);
    for (const h of this.hooks) h(V, R, this);
    /* charts first, readout last: writing to the DOM dirties layout, and the
       chart path may read it. Reversing these two forced a synchronous
       layout every frame. */
    for (const id of this.followers) DY.chart(id, null, R.f);
    if (this.readout) this.updateReadout(R, dist);
  }
  hud(R, dist) {
    const V = this.V, g = V.g, s = R.s;
    let y = 18;
    g.textAlign = 'left';
    if (s.label) { g.fillStyle = css('--ink'); g.fillText(s.label, 10, y); y += 16; }
    if (dist !== null) {
      g.fillStyle = css('--ink2');
      g.fillText(`tip→target ${(100 * dist).toFixed(1)} cm`, 10, y); y += 16;
    }
    if (R.M) {
      const w = Math.min(R.M.stickArm, R.M.wall, R.M.floor, R.M.ceil);
      g.fillStyle = w < 0 ? css('--bad') : w < 0.05 ? css('--warn') : css('--ink2');
      g.fillText(`min clearance ${(100 * w).toFixed(1)} cm`, 10, y); y += 16;
    }
    if (this.nframes > 1) {
      g.textAlign = 'right';
      g.fillStyle = css('--ink2');
      const dt = s.dt || 1 / 60;
      g.fillText(`t = ${(R.f * dt).toFixed(3)} s`, V.W - 10, 18);
      g.textAlign = 'left';
    }
  }
  /* The readout is rebuilt on sample change and then only its live cells get
     new text. Replacing the table's innerHTML every frame — which is what this
     used to do — re-parsed the markup and invalidated layout 60 times a
     second, right before the charts read clientWidth. That is a layout-thrash
     loop, and it is what made playback stutter. */
  buildReadout() {
    if (!this.readout) return;
    const s = this.sample, rows = [];
    if (s.metrics) for (const k in s.metrics) rows.push([k, s.metrics[k], null]);
    const live = this.nframes > 1 ? ' (now)' : '';
    if (s.q && ARM) {
      rows.push(['stick↔arm' + live, '', 'sa']);
      rows.push(['wall' + live, '', 'wall']);
      rows.push(['keep-out plane' + live, '', 'floor']);
      rows.push(['ceiling' + live, '', 'ceil']);
      rows.push(['resting wire↔arm', '', 'wire']);
      rows.push(['stick tip' + live, '', 'tip']);
    }
    if ((s.goals && s.goals.length) ||
        (this.world.goals && this.world.goals.length)) {
      rows.push(['tip→target' + live, '', 'dist']);
    }
    this.readout.innerHTML = rows.map(
      r => `<tr><td>${r[0]}</td><td${r[2] ? ' data-k="' + r[2] + '"' : ''}>`
           + `${r[1]}</td></tr>`).join('');
    this._cells = {};
    const self = this;
    this.readout.querySelectorAll('td[data-k]').forEach(
      td => { self._cells[td.getAttribute('data-k')] = td; });
  }
  updateReadout(R, dist) {
    const c = this._cells;
    if (!c) return;
    const set = (k, v) => {
      const td = c[k];
      if (td && td.textContent !== v) td.textContent = v;
    };
    if (R.M) {
      set('sa', `${(100 * R.M.stickArm).toFixed(1)} cm`);
      set('wall', `${(100 * R.M.wall).toFixed(1)} cm`);
      set('floor', `${(100 * R.M.floor).toFixed(1)} cm`);
      set('ceil', `${(100 * R.M.ceil).toFixed(1)} cm`);
      set('wire', `${(100 * R.M.wire).toFixed(1)} cm`);
      set('tip', R.M.tip.map(v => v.toFixed(3)).join(', '));
    }
    if (dist !== null && dist !== undefined) set('dist', `${(100 * dist).toFixed(1)} cm`);
  }
  /* --- handle picking and dragging ------------------------------------- */
  _pick(x, y) {
    if (!this.handles.length) return null;
    const V = this.V;
    if (!V._cm) { V.begin(); }
    let best = null, bd = 1e9;
    for (const h of this.handles) {
      if (h.kind === 'ring') {
        const pts = V.circle3(h.c, h.axis, h.radius, 40);
        let d = 1e9;
        for (const p of pts) {
          const sp = V.proj(p);
          if (sp) d = Math.min(d, Math.hypot(sp[0] - x, sp[1] - y));
        }
        if (d < 9 && d < bd) { bd = d; best = h; }
        continue;
      }
      const s = V.proj(h.p);
      if (!s) continue;
      const d = Math.hypot(s[0] - x, s[1] - y);
      const r = (h.r || 6) + 7;
      if (d < r && d < bd) { bd = d; best = h; }
    }
    return best;
  }
  _hover(x, y) {
    const h = this._pick(x, y);
    const id = h ? h.id : null;
    if (id !== this.hstate.hover) {
      this.hstate.hover = id;
      this.V.cv.style.cursor = id ? 'move' : 'grab';
      this.draw();
    }
  }
  _grabStart(x, y, e) {
    const h = this._pick(x, y);
    if (!h) return null;
    this.hstate.id = h.id;
    if (h.kind === 'ring') {
      /* rotation: angle in the ring's plane, measured from the grab point */
      const n = nrm(h.axis);
      const p = this.V.onPlane(x, y, h.c, n);
      if (!p) { this.hstate.id = null; return null; }
      const v = sub(p, h.c), L = Math.hypot(v[0], v[1], v[2]);
      if (L < 1e-9) { this.hstate.id = null; return null; }
      this.hstate.ring = { c: h.c.slice(), n: n, v0: scl(v, 1 / L) };
      this.hstate.angle = 0;
      if (this.onhandle) this.onhandle(h.id, { angle: 0 }, 'start');
      this.draw();
      return h.id;
    }
    const key = e.shiftKey ? 'z' : (e.altKey ? 'y' : (e.ctrlKey ? 'x' : null));
    this.hstate.ring = null;
    this.hstate.p0 = h.p.slice();
    this.hstate.axis = h.axis || (key ? { x: [1, 0, 0], y: [0, 1, 0],
                                          z: [0, 0, 1] }[key] : null);
    this.hstate.plane = this.V.cam().fwd;
    if (this.onhandle) this.onhandle(h.id, h.p.slice(), 'start');
    this.draw();
    return h.id;
  }
  _grabMove(id, x, y) {
    const st = this.hstate;
    if (st.ring) {
      const rg = st.ring;
      const p = this.V.onPlane(x, y, rg.c, rg.n);
      if (!p) return;
      const v = sub(p, rg.c), L = Math.hypot(v[0], v[1], v[2]);
      if (L < 1e-9) return;
      const v1 = scl(v, 1 / L);
      st.angle = Math.atan2(dot3(crs(rg.v0, v1), rg.n), dot3(rg.v0, v1));
      if (this.onhandle) this.onhandle(id, { angle: st.angle }, 'move');
      this.draw();
      return;
    }
    const p = st.axis ? this.V.onAxis(x, y, st.p0, nrm(st.axis))
                      : this.V.onPlane(x, y, st.p0, st.plane);
    if (!p) return;
    if (this.onhandle) this.onhandle(id, p, 'move');
    this.draw();
  }
  _grabEnd(id) {
    this.hstate.id = null;
    this.hstate.ring = null;
    if (this.onhandle) this.onhandle(id, null, 'end');
    this.draw();
  }

  setSample(i) {
    this.cur = Math.max(0, Math.min(this.samples.length - 1, i));
    this.f = 0;
    this.buildReadout();
    if (this.onsample) this.onsample(this.cur);
    this.draw();
  }
  step(dt) {
    if (!this.playing || this.nframes < 2) return;
    this.f += dt * 60 * this.speed;
    if (this.f >= this.nframes - 1) this.f = 0;
    if (this.onframe) this.onframe(this.f);
    this.draw();
  }
}

/* ------------------------------------------------------------------- UI  */
function transportUI(host, vw) {
  const bar = mk('div', 'dy-row');
  const play = mk('button', 'dy-play' + (vw.playing ? ' on' : ''),
                  vw.playing ? 'pause' : 'play');
  const range = mk('input');
  range.type = 'range'; range.min = 0; range.step = 0.01;
  range.max = Math.max(1, vw.nframes - 1); range.value = 0;
  range.style.flex = '1';
  const tlab = mk('span', 'dy-t', '');
  const setLab = () => {
    const dt = vw.sample.dt || 1 / 60;
    tlab.textContent = `${(vw.f * dt).toFixed(3)} / ${((vw.nframes - 1) * dt).toFixed(2)} s`;
  };
  play.onclick = () => {
    vw.playing = !vw.playing;
    play.textContent = vw.playing ? 'pause' : 'play';
    play.classList.toggle('on', vw.playing);
  };
  range.addEventListener('input', () => {
    vw.f = +range.value; vw.playing = false;
    play.textContent = 'play'; play.classList.remove('on');
    setLab(); vw.draw();
  });
  const spd = mk('select');
  for (const v of [0.25, 0.5, 1.0, 2.0]) {
    const o = mk('option', '', v + '×'); o.value = v;
    if (Math.abs(v - vw.speed) < 1e-9) o.selected = true;
    spd.appendChild(o);
  }
  spd.onchange = () => { vw.speed = +spd.value; };
  bar.appendChild(play); bar.appendChild(range); bar.appendChild(tlab);
  bar.appendChild(spd);
  host.appendChild(bar);
  vw.onframe = () => { range.value = vw.f; setLab(); };
  /* let an owner drive the transport without reaching into the DOM */
  vw.setPlaying = on => {
    vw.playing = !!on;
    play.textContent = vw.playing ? 'pause' : 'play';
    play.classList.toggle('on', vw.playing);
  };
  vw.onsampleExtra = () => {
    range.max = Math.max(1, vw.nframes - 1); range.value = 0; setLab();
  };
  /* the sample can also change LENGTH in place (an editor rewriting q), and
     the scrubber has to follow or it clips the trajectory it is scrubbing */
  vw.refreshTransport = () => {
    range.max = Math.max(1, vw.nframes - 1);
    if (vw.f > +range.max) vw.f = 0;
    range.value = vw.f; setLab();
  };
  setLab();
}
function pickerUI(host, vw, onpick) {
  if (vw.samples.length < 2) return;
  const bar = mk('div', 'dy-btns');
  const btns = [];
  vw.samples.forEach((s, i) => {
    const b = mk('button', s.tone ? 'tone-' + s.tone : '', s.label || ('#' + (i + 1)));
    if (s.note) b.title = s.note;
    b.onclick = () => { vw.setSample(i); mark(); if (onpick) onpick(i); };
    bar.appendChild(b); btns.push(b);
  });
  function mark() { btns.forEach((b, i) => b.classList.toggle('on', i === vw.cur)); }
  mark();
  vw._mark = mark;
  host.appendChild(bar);
}
function layersUI(host, vw, keys) {
  const bar = mk('div', 'dy-btns dy-layers');
  const NAMES = { mesh: 'arm', skeleton: 'skeleton', capsules: 'capsules',
                  wall: 'wall', grid: 'floor', plane: 'keep-out', trail: 'trail',
                  path: 'tip path', goals: 'targets', clouds: 'cloud',
                  rope: 'rope', axes: 'axes', volume: 'heat map' };
  for (const k of keys) {
    if (k === 'mesh' && !ARM) continue;
    const b = mk('button', vw.layers[k] ? 'on' : '', NAMES[k] || k);
    b.onclick = () => {
      vw.layers[k] = !vw.layers[k];
      b.classList.toggle('on', vw.layers[k]);
      vw.draw();
    };
    bar.appendChild(b);
  }
  const vb = mk('span', 'dy-sep', '');
  bar.appendChild(vb);
  for (const v of ['iso', 'front', 'side', 'top']) {
    const b = mk('button', '', v);
    b.onclick = () => { vw.V.preset(v); };
    bar.appendChild(b);
  }
  const rb = mk('button', '', 'reset');
  rb.onclick = () => { vw.autofit(); vw.V.reset(); };
  bar.appendChild(rb);
  host.appendChild(bar);
}
/* the component bar: one button per Path/Cloud group, with the group's colour,
   so a figure that overlays several families of curve says which is which and
   lets you take any of them away. Only rendered when a figure HAS groups. */
function componentsUI(host, vw) {
  const gs = pathGroups(vw);
  if (!gs.length) return;
  const bar = mk('div', 'dy-btns dy-groups');
  const lab = mk('span', 'dy-glab', 'show');
  bar.appendChild(lab);
  for (const g of gs) {
    const b = mk('button', groupOn(vw, g.key) ? 'on' : '', '');
    const sw = mk('span', 'dy-sw', '');
    sw.style.background = col(g.color, '--ink3');
    b.appendChild(sw);
    b.appendChild(document.createTextNode(g.key));
    b.onclick = () => {
      vw.groups[g.key] = !groupOn(vw, g.key);
      b.classList.toggle('on', groupOn(vw, g.key));
      vw.draw();
    };
    bar.appendChild(b);
  }
  const all = mk('button', '', 'all');
  all.onclick = () => {
    for (const g of gs) vw.groups[g.key] = true;
    [...bar.querySelectorAll('button')].forEach(b => {
      if (b !== all && b.textContent !== 'none') b.classList.add('on');
    });
    vw.draw();
  };
  const none = mk('button', '', 'none');
  none.onclick = () => {
    for (const g of gs) vw.groups[g.key] = false;
    [...bar.querySelectorAll('button')].forEach(b => {
      if (b !== all && b !== none) b.classList.remove('on');
    });
    vw.draw();
  };
  bar.appendChild(mk('span', 'dy-sep', ''));
  bar.appendChild(all); bar.appendChild(none);
  host.appendChild(bar);
}
function jointUI(host, vw, spec) {
  const poses = spec.poses || [];
  const lim = spec.joint_limits || ARM.joint_limits;
  const wide = [];
  for (let i = 0; i < 6; i++) {
    let lo = lim[i][0], hi = lim[i][1];
    for (const p of poses) { lo = Math.min(lo, p.q[i]); hi = Math.max(hi, p.q[i]); }
    wide.push([Math.min(lo, -Math.PI), Math.max(hi, Math.PI)]);
  }
  const box = mk('div', 'dy-sliders');
  const rows = [];
  for (let i = 0; i < 6; i++) {
    const row = mk('div', 'dy-jrow');
    const name = ARM.joint_short[i];
    row.innerHTML =
      `<label for="${vw.id}-j${i}">${name}</label>` +
      `<input id="${vw.id}-j${i}" type="range" min="${wide[i][0].toFixed(4)}"` +
      ` max="${wide[i][1].toFixed(4)}" step="0.001"` +
      ` aria-label="${ARM.joint_names[i]} in radians">` +
      `<input class="dy-num" type="number" step="0.01"` +
      ` aria-label="${ARM.joint_names[i]} in radians">` +
      `<span class="dy-deg"></span>`;
    box.appendChild(row);
    const s = row.querySelector('input[type=range]');
    const n = row.querySelector('input.dy-num');
    const d = row.querySelector('span.dy-deg');
    rows.push([s, n, d]);
    const set = v => {
      if (!Number.isFinite(v)) return;
      vw.samples[vw.cur].q[0][i] = Math.min(wide[i][1], Math.max(wide[i][0], v));
      sync();
    };
    s.addEventListener('input', () => set(+s.value));
    n.addEventListener('change', () => set(+n.value));
  }
  function sync() {
    const q = vw.samples[vw.cur].q[0];
    rows.forEach((r, i) => {
      r[0].value = q[i]; r[1].value = q[i].toFixed(4);
      r[2].textContent = (q[i] * R2D).toFixed(1) + '°';
    });
    vw.draw();
  }
  host.appendChild(box);
  vw.onsample = sync;
  sync();
}

/* --------------------------------------------------------------- exports */
const _viewers = {};

function build(id, spec, mode) {
  const cv = el(id);
  if (!cv) { console.warn('[ropeviz] no canvas #' + id); return null; }
  const host = el(spec.ui_host || (cv.id + '-ui'));
  const vw = new Viewer(cv, spec);
  vw.id = cv.id;
  _viewers[cv.id] = vw;
  if (host) {
    if (mode === 'scene' && spec.controls !== false && ARM) jointUI(host, vw, spec);
    /* `picker: false` for a page whose own UI selects the sample (a grid, a
       table) — the flat button list would just say it twice */
    if (spec.picker !== false) pickerUI(host, vw);
    if (mode === 'player' && spec.transport !== false) transportUI(host, vw);
    if (spec.layer_ui !== false) {
      layersUI(host, vw, spec.layer_keys ||
        (mode === 'scene'
          ? ['mesh', 'capsules', 'skeleton', 'wall', 'grid', 'plane', 'goals',
             'clouds', 'axes']
          : ['mesh', 'capsules', 'trail', 'path', 'goals', 'wall', 'grid',
             'plane', 'axes']));
    }
    if (spec.group_ui !== false) componentsUI(host, vw);
  }
  const inner = vw.onsample;
  vw.onsample = i => {
    if (inner) inner(i);
    if (vw.onsampleExtra) vw.onsampleExtra(i);
    if (vw._mark) vw._mark();
  };
  vw.buildReadout();
  new ResizeObserver(() => vw.draw()).observe(cv);
  vw.draw();
  return vw;
}

let _last = 0;
function tick(now) {
  const dt = Math.min(0.05, (now - _last) / 1000 || 0.016);
  _last = now;
  for (const k in _viewers) _viewers[k].step(dt);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

return {
  setArm, arm: () => ARM, fk, xf, rot, rot3, mul, expScrew, clearances,
  restingWire, segDist, nrm, cross: crs, sub, add, scl, dot3,
  themeGen: () => themeGen,
  View, Viewer, css, col, rgba, shade,
  /* the library's own drawers, so a hook composes with them instead of
     re-deriving the projection, the palette and the painter's algorithm */
  drawGoal, drawArmMesh, drawSkeleton, drawCapsules, drawWall, drawGrid,
  drawPlane, drawCloud, drawPath, drawVolume, resolveSample, frameOf, frameOf1,
  ramp: _ramp, isDark: _isDark,
  player: (id, spec) => build(id, spec, 'player'),
  scene: (id, spec) => build(id, spec, 'scene'),
  get: id => _viewers[id],
  viewers: _viewers,
  DEFAULT_WORLD,
  chart: function () { /* replaced by charts.js when it is included */ }
};
})();

