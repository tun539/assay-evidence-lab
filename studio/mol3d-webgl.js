'use strict';

/**
 * Hardware-Accelerated WebGL2 Molecular Mesh & Impostor Renderer (Mol* / AlphaFold Server aesthetic).
 * Renders true Z-buffered 3D extruded α-helices, β-strand arrowheads, smooth spline tubes,
 * beveled purine/pyrimidine ring blocks, ball-and-stick sidechains/pockets, and cavity-AO surfaces
 * onto an offscreen GPU canvas, composited seamlessly into any 2D viewport canvas.
 */
const Mol3DWebGL = (() => {
  const VERT_SRC = `#version 300 es
    precision highp float;
    layout(location = 0) in vec3 aPos;
    layout(location = 1) in vec3 aNorm;
    layout(location = 2) in vec3 aCol;
    layout(location = 3) in float aAo;

    uniform mat4 uRot;
    uniform float uScale;
    uniform float uCamDist;
    uniform vec2 uOffset;
    uniform vec2 uViewport;

    out vec3 vNorm;
    out vec3 vCol;
    out float vDepth;
    out float vAo;

    void main() {
      vec3 rv = (uRot * vec4(aPos, 1.0)).xyz;
      float denom = max(12.0, uCamDist - rv.z);
      float persp = uCamDist / denom;
      float px = uOffset.x + rv.x * uScale * persp;
      float py = uOffset.y - rv.y * uScale * persp;
      float ndcX = (px / uViewport.x) * 2.0 - 1.0;
      float ndcY = 1.0 - (py / uViewport.y) * 2.0;
      float ndcZ = clamp(-rv.z / (uCamDist * 0.65), -0.98, 0.98);
      gl_Position = vec4(ndcX, ndcY, ndcZ, 1.0);

      vNorm = normalize((uRot * vec4(aNorm, 0.0)).xyz);
      vCol = aCol;
      vDepth = rv.z;
      vAo = aAo;
    }
  `;

  const FRAG_SRC = `#version 300 es
    precision highp float;
    in vec3 vNorm;
    in vec3 vCol;
    in float vDepth;
    in float vAo;

    uniform float uRadius;
    uniform vec3 uBg;
    uniform float uOutline;
    uniform float uAlpha;
    uniform float uSpecPow;

    out vec4 outColor;

    void main() {
      vec3 N = normalize(vNorm);
      vec3 V = vec3(0.0, 0.0, 1.0);
      if (N.z < 0.0) N = -N;

      vec3 L1 = normalize(vec3(-0.36, 0.58, 0.73));
      vec3 L2 = normalize(vec3(0.54, -0.28, 0.56));
      vec3 H1 = normalize(L1 + V);

      float ndotl1 = max(0.0, dot(N, L1));
      float ndotl2 = max(0.0, dot(N, L2));
      float spec = pow(max(0.0, dot(N, H1)), uSpecPow);
      float rim = pow(1.0 - abs(dot(N, V)), 2.2);

      float silhouette = mix(1.0, smoothstep(0.04, 0.42, abs(N.z)), uOutline);
      float light = (0.32 + 0.62 * ndotl1 + 0.16 * ndotl2 + 0.12 * rim) * vAo;
      vec3 lit = min(vec3(1.0), vCol * light + vec3(0.38 * spec)) * silhouette;

      float fog = clamp((uRadius - vDepth) / (2.9 * max(8.0, uRadius)) * 0.24, 0.0, 0.28);
      vec3 finalRgb = mix(lit, uBg, fog);
      outColor = vec4(finalRgb * uAlpha, uAlpha);
    }
  `;

  let shared = null;

  function ensureContext() {
    if (shared) return shared;
    if (typeof document === 'undefined') return null;
    try {
      const cvs = document.createElement('canvas');
      const gl = cvs.getContext('webgl2', {
        antialias: true,
        alpha: true,
        depth: true,
        preserveDrawingBuffer: true,
      });
      if (!gl) return null;

      const compile = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
          gl.deleteShader(s);
          return null;
        }
        return s;
      };
      const vs = compile(gl.VERTEX_SHADER, VERT_SRC);
      const fs = compile(gl.FRAGMENT_SHADER, FRAG_SRC);
      if (!vs || !fs) return null;
      const prog = gl.createProgram();
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;

      const vao = gl.createVertexArray();
      const vbo = gl.createBuffer();
      const ibo = gl.createBuffer();

      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 40, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 40, 12);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 40, 24);
      gl.enableVertexAttribArray(3);
      gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 40, 36);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      gl.bindVertexArray(null);

      shared = {
        canvas: cvs,
        gl,
        prog,
        vao,
        vbo,
        ibo,
        locs: {
          uRot: gl.getUniformLocation(prog, 'uRot'),
          uScale: gl.getUniformLocation(prog, 'uScale'),
          uCamDist: gl.getUniformLocation(prog, 'uCamDist'),
          uOffset: gl.getUniformLocation(prog, 'uOffset'),
          uViewport: gl.getUniformLocation(prog, 'uViewport'),
          uRadius: gl.getUniformLocation(prog, 'uRadius'),
          uBg: gl.getUniformLocation(prog, 'uBg'),
          uOutline: gl.getUniformLocation(prog, 'uOutline'),
          uAlpha: gl.getUniformLocation(prog, 'uAlpha'),
          uSpecPow: gl.getUniformLocation(prog, 'uSpecPow'),
        },
        sphereUnit: buildUnitSphere(14, 10),
      };
      return shared;
    } catch {
      return null;
    }
  }

  function buildUnitSphere(segLon, segLat) {
    const verts = [];
    const idx = [];
    for (let y = 0; y <= segLat; y++) {
      const phi = (y / segLat) * Math.PI;
      const sp = Math.sin(phi), cp = Math.cos(phi);
      for (let x = 0; x <= segLon; x++) {
        const th = (x / segLon) * Math.PI * 2;
        verts.push(sp * Math.cos(th), cp, sp * Math.sin(th));
      }
    }
    for (let y = 0; y < segLat; y++) {
      for (let x = 0; x < segLon; x++) {
        const a = y * (segLon + 1) + x;
        const b = a + segLon + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    return { verts, idx };
  }

  function vSub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function vAdd(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function vScale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function vDot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function vCross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  function vLen(a) { return Math.hypot(a[0], a[1], a[2]); }
  function vNorm(a) { const l = vLen(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function vDist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }

  function catmullRom(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    return [0, 1, 2].map(k =>
      0.5 * (
        (2 * p1[k])
        + (-p0[k] + p2[k]) * t
        + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2
        + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3
      )
    );
  }

  class MeshBuilder {
    constructor() {
      this.verts = [];
      this.indices = [];
      this.vCount = 0;
    }

    pushVertex(p, n, rgb, ao = 1.0) {
      this.verts.push(
        p[0], p[1], p[2],
        n[0], n[1], n[2],
        rgb[0] / 255, rgb[1] / 255, rgb[2] / 255,
        ao
      );
      return this.vCount++;
    }

    pushSphere(center, radius, rgb, ao = 1.0, unit) {
      const base = this.vCount;
      const uVerts = unit.verts;
      const uIdx = unit.idx;
      const cr = rgb[0] / 255, cg = rgb[1] / 255, cb = rgb[2] / 255;
      for (let i = 0; i < uVerts.length; i += 3) {
        const nx = uVerts[i], ny = uVerts[i + 1], nz = uVerts[i + 2];
        this.verts.push(
          center[0] + nx * radius,
          center[1] + ny * radius,
          center[2] + nz * radius,
          nx, ny, nz,
          cr, cg, cb,
          ao
        );
      }
      this.vCount += uVerts.length / 3;
      for (let i = 0; i < uIdx.length; i++) {
        this.indices.push(base + uIdx[i]);
      }
    }

    pushCylinder(p0, p1, r0, r1, rgb0, rgb1, segs = 8, ao = 1.0) {
      const dir = vSub(p1, p0);
      const len = vLen(dir);
      if (len < 1e-4) return;
      const axis = vScale(dir, 1 / len);
      let u = vCross(axis, Math.abs(axis[1]) < 0.85 ? [0, 1, 0] : [1, 0, 0]);
      u = vNorm(u);
      const v = vNorm(vCross(axis, u));
      const base = this.vCount;
      for (let ring = 0; ring < 2; ring++) {
        const c = ring ? p1 : p0;
        const r = ring ? r1 : r0;
        const col = ring ? rgb1 : rgb0;
        for (let s = 0; s <= segs; s++) {
          const th = (s * 2 * Math.PI) / segs;
          const ct = Math.cos(th), st = Math.sin(th);
          const n = [u[0] * ct + v[0] * st, u[1] * ct + v[1] * st, u[2] * ct + v[2] * st];
          const p = [c[0] + n[0] * r, c[1] + n[1] * r, c[2] + n[2] * r];
          this.pushVertex(p, n, col, ao);
        }
      }
      const stride = segs + 1;
      for (let s = 0; s < segs; s++) {
        const a = base + s, b = a + stride;
        this.indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }

    pushExtrudedSection(frames, profFn, rgbFn, aoFn) {
      if (frames.length < 2) return;
      const sampleAngles = [0, 1, 2, 3, 4, 5, 6, 7].map(i => (i * 2 * Math.PI) / 8);
      const ringSize = sampleAngles.length + 1;
      const base = this.vCount;

      for (let fi = 0; fi < frames.length; fi++) {
        const fr = frames[fi];
        const rgb = rgbFn(fr);
        const ao = aoFn ? aoFn(fr) : 1.0;
        const { hw, ht, square } = profFn(fr);
        for (let si = 0; si < ringSize; si++) {
          const th = sampleAngles[si % sampleAngles.length];
          let lx = Math.cos(th), ly = Math.sin(th);
          if (square) {
            lx = Math.sign(lx) * Math.pow(Math.abs(lx), 0.45);
            ly = Math.sign(ly) * Math.pow(Math.abs(ly), 0.45);
          }
          const off = vAdd(vScale(fr.binorm, lx * hw), vScale(fr.normal, ly * ht));
          const n = vNorm(vAdd(vScale(fr.binorm, lx / Math.max(0.15, hw)), vScale(fr.normal, ly / Math.max(0.15, ht))));
          const col = (fr.innerDark && ly < -0.15) ? rgb.map(c => Math.round(c * 0.78)) : rgb;
          this.pushVertex(vAdd(fr.pos, off), n, col, ao);
        }
      }

      for (let fi = 0; fi < frames.length - 1; fi++) {
        const r0 = base + fi * ringSize;
        const r1 = base + (fi + 1) * ringSize;
        for (let si = 0; si < ringSize - 1; si++) {
          const a = r0 + si, b = r1 + si;
          this.indices.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }

      for (const endIdx of [0, frames.length - 1]) {
        const fr = frames[endIdx];
        const rgb = rgbFn(fr);
        const ao = aoFn ? aoFn(fr) : 1.0;
        const { hw, ht, square } = profFn(fr);
        const capN = endIdx === 0 ? vScale(fr.tang, -1) : fr.tang;
        const centerV = this.pushVertex(fr.pos, capN, rgb, ao);
        const ringBase = this.vCount;
        for (let si = 0; si < ringSize; si++) {
          const th = sampleAngles[si % sampleAngles.length];
          let lx = Math.cos(th), ly = Math.sin(th);
          if (square) {
            lx = Math.sign(lx) * Math.pow(Math.abs(lx), 0.45);
            ly = Math.sign(ly) * Math.pow(Math.abs(ly), 0.45);
          }
          const p = vAdd(fr.pos, vAdd(vScale(fr.binorm, lx * hw), vScale(fr.normal, ly * ht)));
          this.pushVertex(p, capN, rgb, ao);
        }
        for (let si = 0; si < ringSize - 1; si++) {
          if (endIdx === 0) this.indices.push(centerV, ringBase + si + 1, ringBase + si);
          else this.indices.push(centerV, ringBase + si, ringBase + si + 1);
        }
      }
    }

    pushSlab3D(verts3D, norm3D, thickness, rgb, ao = 1.0) {
      if (verts3D.length < 3) return;
      const halfT = vScale(norm3D, thickness);
      const top = verts3D.map(v => vAdd(v, halfT));
      const bot = verts3D.map(v => vSub(v, halfT));
      const topN = norm3D, botN = vScale(norm3D, -1);

      const topCenter = verts3D.reduce((acc, v) => vAdd(acc, v), [0, 0, 0]).map(x => x / verts3D.length);
      const tcIdx = this.pushVertex(vAdd(topCenter, halfT), topN, rgb, ao);
      const tStart = this.vCount;
      for (const p of top) this.pushVertex(p, topN, rgb, ao);
      for (let i = 0; i < top.length; i++) {
        this.indices.push(tcIdx, tStart + i, tStart + ((i + 1) % top.length));
      }

      const bcIdx = this.pushVertex(vSub(topCenter, halfT), botN, rgb, ao);
      const bStart = this.vCount;
      for (const p of bot) this.pushVertex(p, botN, rgb, ao);
      for (let i = 0; i < bot.length; i++) {
        this.indices.push(bcIdx, bStart + ((i + 1) % bot.length), bStart + i);
      }

      const sideCol = rgb.map(c => Math.round(c * 0.85));
      for (let i = 0; i < verts3D.length; i++) {
        const j = (i + 1) % verts3D.length;
        const edgeDir = vSub(verts3D[j], verts3D[i]);
        const sn = vNorm(vCross(edgeDir, norm3D));
        const a = this.pushVertex(top[i], sn, sideCol, ao);
        const b = this.pushVertex(top[j], sn, sideCol, ao);
        const c = this.pushVertex(bot[j], sn, sideCol, ao);
        const d = this.pushVertex(bot[i], sn, sideCol, ao);
        this.indices.push(a, b, c, a, c, d);
      }
    }

    toBuffers() {
      return {
        verts: new Float32Array(this.verts),
        indices: new Uint32Array(this.indices),
      };
    }
  }

  function buildGeometry(model, state, helpers) {
    const { residueColor, ELEMENT_COLORS, BASE_COLORS } = helpers;
    const ctx = ensureContext();
    const unit = ctx ? ctx.sphereUnit : buildUnitSphere(14, 10);
    const mb = new MeshBuilder();
    const hiddenChains = state.hiddenChains || new Set();
    const rep = state.rep || 'cartoon';
    const aoStrength = state.ao !== false;

    const aoValues = model.residues.map((r, idx) => {
      if (!aoStrength) return 1.0;
      let neighbors = 0;
      const step = model.residues.length > 450 ? 2 : 1;
      for (let j = 0; j < model.residues.length; j += step) {
        if (j === idx) continue;
        if (vDist(r.pos, model.residues[j].pos) < 8.5) neighbors += step;
      }
      return Math.max(0.74, Math.min(1.06, 1.06 - neighbors * 0.022));
    });

    const colorFor = r => {
      let col = residueColor(r);
      if (state.focusRange) {
        const [fa, fb] = state.focusRange;
        const inA = r.index >= fa[0] && r.index <= fa[1];
        const inB = r.index >= fb[0] && r.index <= fb[1];
        if (!inA && !inB) {
          col = col.map(c => Math.round(c * 0.38 + 135 * 0.62));
        }
      }
      return col;
    };

    if (rep === 'surface' || rep === 'trace') {
      const rSphere = rep === 'surface' ? 2.48 : 0.72;
      for (const ch of model.chains) {
        if (hiddenChains.has(ch.id)) continue;
        for (let k = 0; k < ch.length; k++) {
          const i = ch.start + k;
          const r = model.residues[i];
          const col = colorFor(r);
          mb.pushSphere(r.pos, rSphere, col, aoValues[i], unit);
          if (rep === 'trace' && k < ch.length - 1) {
            const rn = model.residues[i + 1];
            if (vDist(r.xyz, rn.xyz) <= 8.8) {
              mb.pushCylinder(r.pos, rn.pos, 0.34, 0.34, col, colorFor(rn), 8, aoValues[i]);
            }
          }
          if (rep === 'trace' && r.atoms && r.atoms.length) {
            for (const at of r.atoms) {
              const aCol = ELEMENT_COLORS[at.el] || col;
              mb.pushSphere(at.pos, 0.44, aCol, aoValues[i], unit);
              mb.pushCylinder(r.pos, at.pos, 0.18, 0.18, col, aCol, 6, aoValues[i]);
            }
          }
          if (r.tipPos) {
            const bCol = BASE_COLORS[r.resName] || col;
            mb.pushCylinder(r.pos, r.tipPos, 0.36, 0.36, col, bCol, 7, aoValues[i]);
            mb.pushSphere(r.tipPos, rep === 'surface' ? 1.55 : 0.78, bCol, aoValues[i], unit);
          }
        }
      }
    } else {
      const sub = model.residues.length > 420 ? 4 : 6;
      for (const ch of model.chains) {
        if (hiddenChains.has(ch.id)) continue;
        const isNuc = ch.type === 'rna' || ch.type === 'dna';
        const pts = [];
        const meta = [];
        for (let k = 0; k < ch.length; k++) {
          const r = model.residues[ch.start + k];
          pts.push(r.pos);
          meta.push(r);
        }

        let segStart = 0;
        while (segStart < pts.length) {
          let segEnd = segStart + 1;
          while (segEnd < pts.length && vDist(pts[segEnd - 1], pts[segEnd]) <= 8.8) segEnd++;
          const segLen = segEnd - segStart;

          if (segLen >= 2) {
            const spline = [];
            for (let i = segStart; i < segEnd - 1; i++) {
              const p0 = pts[Math.max(segStart, i - 1)];
              const p1 = pts[i];
              const p2 = pts[i + 1];
              const p3 = pts[Math.min(segEnd - 1, i + 2)];
              const r1 = meta[i], r2 = meta[i + 1];
              const isLastSheet = r1.ss === 'E' && (i + 1 === segEnd - 1 || meta[i + 1].ss !== 'E');
              for (let s = 0; s < sub; s++) {
                const t = s / sub;
                const pos = catmullRom(p0, p1, p2, p3, t);
                const owner = t < 0.5 ? r1 : r2;
                spline.push({ pos, owner, ss: r1.ss, isArrow: isLastSheet, arrowT: t });
              }
            }
            spline.push({ pos: pts[segEnd - 1], owner: meta[segEnd - 1], ss: meta[segEnd - 1].ss, isArrow: false, arrowT: 1 });

            let prevBinorm = [0, 1, 0];
            const frames = spline.map((node, idx) => {
              const prev = spline[Math.max(0, idx - 1)].pos;
              const next = spline[Math.min(spline.length - 1, idx + 1)].pos;
              const tang = vNorm(vSub(next, prev));
              let acc = (idx > 0 && idx < spline.length - 1)
                ? vSub(vAdd(prev, next), vScale(node.pos, 2))
                : prevBinorm;
              let binorm = vLen(acc) > 1e-4 ? vNorm(acc) : prevBinorm;
              binorm = vSub(binorm, vScale(tang, vDot(binorm, tang)));
              binorm = vLen(binorm) > 1e-4 ? vNorm(binorm) : vNorm(vCross(tang, [0, 0, 1]));
              if (vDot(binorm, prevBinorm) < 0) binorm = vScale(binorm, -1);
              binorm = vNorm(vAdd(vScale(binorm, 0.36), vScale(prevBinorm, 0.64)));
              prevBinorm = binorm;
              const normal = vNorm(vCross(tang, binorm));
              return { ...node, tang, binorm, normal, innerDark: node.ss === 'H' };
            });

            let rStart = 0;
            while (rStart < frames.length) {
              const isRib0 = rep === 'cartoon' && (frames[rStart].ss === 'H' || frames[rStart].ss === 'E' || isNuc);
              let rEnd = rStart + 1;
              while (rEnd < frames.length) {
                const isRib = rep === 'cartoon' && (frames[rEnd].ss === 'H' || frames[rEnd].ss === 'E' || isNuc);
                if (isRib !== isRib0) break;
                rEnd++;
              }
              const slice = frames.slice(Math.max(0, rStart - 1), Math.min(frames.length, rEnd + 1));
              mb.pushExtrudedSection(
                slice,
                fr => {
                  if (rep === 'tube') return { hw: 0.56, ht: 0.56, square: false };
                  if (isNuc) return { hw: 0.72, ht: 0.34, square: true };
                  if (fr.ss === 'H') return { hw: 1.24, ht: 0.24, square: false };
                  if (fr.ss === 'E') {
                    if (fr.isArrow) {
                      const hw = fr.arrowT < 0.25 ? 1.85 : 1.85 * Math.max(0.08, 1 - (fr.arrowT - 0.25) / 0.75);
                      return { hw, ht: 0.28, square: true };
                    }
                    return { hw: 1.28, ht: 0.26, square: true };
                  }
                  return { hw: 0.34, ht: 0.34, square: false };
                },
                fr => colorFor(fr.owner),
                fr => aoValues[fr.owner.index]
              );
              rStart = rEnd;
            }
          }
          segStart = segEnd;
        }

        if (isNuc) {
          for (let k = 0; k < ch.length; k++) {
            const r = model.residues[ch.start + k];
            if (!r.tipPos) continue;
            const prevR = model.residues[ch.start + Math.max(0, k - 1)];
            const nextR = model.residues[ch.start + Math.min(ch.length - 1, k + 1)];
            const tipVec = vSub(r.tipPos, r.pos);
            const tipLen = vLen(tipVec);
            if (tipLen < 0.8) continue;
            const axis = vScale(tipVec, 1 / tipLen);
            let sTan = vSub(nextR.pos, prevR.pos);
            if (vLen(sTan) < 0.2) sTan = [0, 0, 1];
            sTan = vNorm(sTan);
            let inPlane = vCross(sTan, axis);
            if (vLen(inPlane) < 0.15) inPlane = vCross([1, 0, 0], axis);
            inPlane = vNorm(inPlane);
            const planeNorm = vNorm(vCross(axis, inPlane));
            const baseRgb = BASE_COLORS[r.resName] || colorFor(r);
            const sugarRgb = [218, 228, 224];

            const sugarCenter = vAdd(r.pos, vScale(axis, Math.min(1.4, tipLen * 0.22)));
            const sugarVerts = [];
            for (let s = 0; s < 5; s++) {
              const a = (s * 2 * Math.PI) / 5 + 0.3;
              sugarVerts.push(vAdd(sugarCenter, vAdd(vScale(axis, 0.82 * Math.cos(a)), vScale(inPlane, 0.82 * Math.sin(a)))));
            }
            mb.pushSlab3D(sugarVerts, planeNorm, 0.22, sugarRgb, aoValues[r.index]);

            const baseStart = vAdd(r.pos, vScale(axis, tipLen * 0.38));
            mb.pushCylinder(r.pos, baseStart, 0.28, 0.28, sugarRgb, sugarRgb, 6, aoValues[r.index]);

            const isPurine = ['A', 'DA', 'G', 'DG'].includes(r.resName);
            if (isPurine) {
              const c5 = vAdd(r.pos, vScale(axis, tipLen * 0.54));
              const r5 = Math.min(1.16, tipLen * 0.24);
              const pent = [];
              for (let s = 0; s < 5; s++) {
                const a = (s * 2 * Math.PI) / 5;
                pent.push(vAdd(c5, vAdd(vScale(axis, r5 * Math.cos(a)), vScale(inPlane, r5 * Math.sin(a)))));
              }
              mb.pushSlab3D(pent, planeNorm, 0.26, baseRgb, aoValues[r.index]);

              const c6 = vAdd(r.pos, vScale(axis, tipLen * 0.84));
              const r6 = Math.min(1.40, tipLen * 0.29);
              const hex = [];
              for (let s = 0; s < 6; s++) {
                const a = (s * Math.PI) / 3 + Math.PI / 6;
                hex.push(vAdd(c6, vAdd(vScale(axis, r6 * Math.cos(a)), vScale(inPlane, r6 * Math.sin(a)))));
              }
              mb.pushSlab3D(hex, baseRgb, planeNorm, 0.26, aoValues[r.index]);
            } else {
              const c6 = vAdd(r.pos, vScale(axis, tipLen * 0.72));
              const r6 = Math.min(1.36, tipLen * 0.29);
              const hex = [];
              for (let s = 0; s < 6; s++) {
                const a = (s * Math.PI) / 3 + Math.PI / 6;
                hex.push(vAdd(c6, vAdd(vScale(axis, r6 * Math.cos(a)), vScale(inPlane, r6 * Math.sin(a)))));
              }
              mb.pushSlab3D(hex, baseRgb, planeNorm, 0.26, aoValues[r.index]);
            }
          }
        }
      }

      if (state.showPocket !== false && model.residues.length) {
        const pocketSet = new Set();
        const ra = model.residues[state.selectedA];
        if (ra) {
          for (const r of model.residues) {
            if (vDist(r.pos, ra.pos) < 5.6) pocketSet.add(r.index);
          }
        }
        for (const link of model.ionLinks || []) pocketSet.add(link.resIndex);
        for (const idx of pocketSet) {
          const r = model.residues[idx];
          if (!r || hiddenChains.has(r.chainId)) continue;
          if (r.atoms && r.atoms.length) {
            const col = colorFor(r);
            for (const at of r.atoms) {
              const aCol = ELEMENT_COLORS[at.el] || col;
              mb.pushCylinder(r.pos, at.pos, 0.16, 0.16, col, aCol, 6, 1.0);
              mb.pushSphere(at.pos, 0.36, aCol, 1.0, unit);
            }
          }
        }
      }
    }

    if (state.showLigands !== false) {
      for (const [i, j] of model.ligandBonds || []) {
        const la = model.ligands[i], lb = model.ligands[j];
        if (hiddenChains.has(la.chainId)) continue;
        const cA = ELEMENT_COLORS[la.element] || [140, 150, 160];
        const cB = ELEMENT_COLORS[lb.element] || [140, 150, 160];
        mb.pushCylinder(la.pos, lb.pos, 0.24, 0.24, cA, cB, 7, 1.05);
      }
      for (const lig of model.ligands || []) {
        if (hiddenChains.has(lig.chainId)) continue;
        const isMetal = ['ZN', 'MG', 'CA', 'FE'].includes(lig.element);
        const rgb = ELEMENT_COLORS[lig.element] || [130, 140, 150];
        mb.pushSphere(lig.pos, isMetal ? 1.48 : 0.54, rgb, 1.08, unit);
      }
    }

    return mb.toBuffers();
  }

  function rotationMatrix4(yaw, pitch, roll) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const cr = Math.cos(roll), sr = Math.sin(roll);
    const m00 = cr * cy + sr * sp * sy;
    const m01 = -sr * cp;
    const m02 = cr * sy - sr * sp * cy;
    const m10 = sr * cy - cr * sp * sy;
    const m11 = cr * cp;
    const m12 = sr * sy + cr * sp * cy;
    const m20 = -cp * sy;
    const m21 = sp;
    const m22 = cp * cy;
    return new Float32Array([
      m00, m10, m20, 0,
      m01, m11, m21, 0,
      m02, m12, m22, 0,
      0,   0,   0,   1,
    ]);
  }

  function renderToTarget(targetCtx, w, h, dpr, model, state, helpers) {
    const ctx = ensureContext();
    if (!ctx) return false;
    const { canvas, gl, prog, vao, vbo, ibo, locs } = ctx;
    const pw = Math.max(1, Math.round(w * dpr));
    const ph = Math.max(1, Math.round(h * dpr));
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }

    const key = [
      model.id,
      model.residues.length,
      state.rep,
      state.colorMode,
      state.ao !== false ? 1 : 0,
      state.showPocket !== false ? state.selectedA : -1,
      state.showLigands !== false ? 1 : 0,
      [...(state.hiddenChains || [])].sort().join(','),
      state.focusRange ? state.focusRange.flat().join(',') : '',
      model._rev || 0,
    ].join('|');

    if (state._meshKey !== key || !state._meshBuf) {
      state._meshBuf = buildGeometry(model, state, helpers);
      state._meshKey = key;
    }

    const buf = state._meshBuf;
    if (!buf.indices.length) return true;

    gl.viewport(0, 0, pw, ph);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    gl.useProgram(prog);
    gl.bindVertexArray(vao);

    if (ctx._activeBuf !== buf) {
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, buf.verts, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, buf.indices, gl.STATIC_DRAW);
      ctx._activeBuf = buf;
    }

    const isDark = state.theme === 'dark';
    const bg = isDark ? [13 / 255, 25 / 255, 31 / 255] : [249 / 255, 251 / 255, 250 / 255];
    const baseScale = (Math.min(w, h) * 0.40 / model.radius) * state.zoom;
    const camDist = model.radius * 4.4;

    gl.uniformMatrix4fv(locs.uRot, false, rotationMatrix4(state.yaw, state.pitch, state.roll));
    gl.uniform1f(locs.uScale, baseScale);
    gl.uniform1f(locs.uCamDist, camDist);
    gl.uniform2f(locs.uOffset, w * 0.5 + (state.panX || 0), h * 0.5 + (state.panY || 0));
    gl.uniform2f(locs.uViewport, w, h);
    gl.uniform1f(locs.uRadius, model.radius);
    gl.uniform3fv(locs.uBg, bg);
    gl.uniform1f(locs.uOutline, state.outline !== false ? 0.48 : 0.0);
    gl.uniform1f(locs.uAlpha, 1.0);
    gl.uniform1f(locs.uSpecPow, state.rep === 'surface' ? 18.0 : 28.0);

    gl.drawElements(gl.TRIANGLES, buf.indices.length, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);

    targetCtx.drawImage(canvas, 0, 0, w, h);
    return true;
  }

  return {
    isAvailable: () => Boolean(ensureContext()),
    renderToTarget,
  };
})();
