// ============================================================
// skeletal.js — 键线式 (Skeletal Formula) 独立渲染模块
// ============================================================
// Usage:
//   const sf = new SkeletalFormula(molecule);
//   sf.render(canvas, { /* options */ });
//
// Depends on: Molecule class from molecule.js (loaded before this).
// ============================================================

class SkeletalFormula {

  constructor(mol) {
    if (!mol || typeof mol.isEmpty !== 'function') {
      throw new Error('SkeletalFormula: requires a Molecule instance');
    }
    this.mol = mol;
  }

  // ---------- PUBLIC API ----------

  /**
   * Render skeletal formula onto a <canvas>.
   * @param {HTMLCanvasElement} canvas
   * @param {object} opts - rendering options (all optional):
   *   padding        {number}  canvas edge padding (default 44)
   *   bondLen        {number}  target bond length in px (default 40)
   *   doubleGap      {number}  gap between double-bond lines (default 3.5)
   *   tripleGap      {number}  gap between triple-bond lines (default 5.5)
   *   lineWidth      {number}  stroke width for bonds (default 1.8)
   *   wedgeWidth     {number}  max width of stereo wedge bonds (default 5.0)
   *   dashCount      {number}  number of segments in dashed wedge bonds (default 8)
   *   showCarbonH    {boolean} show H count on carbon atoms (default true)
   *   bgColor        {string}  background color (default '#ffffff')
   *   fgColor        {string}  bond color (default '#1a1d23')
   *   highContrast   {boolean} thicker lines for dark backgrounds
   */
  render(canvas, opts = {}) {
    const o = Object.assign({
      padding: 44,
      bondLen: 40,
      doubleGap: 3.5,
      tripleGap: 5.5,
      lineWidth: 1.8,
      wedgeWidth: 5.0,
      dashCount: 8,
      showCarbonH: true,
      bgColor: '#ffffff',
      fgColor: '#1a1d23',
      highContrast: false,
    }, opts);

    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;

    // Clear & fill background
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = o.bgColor;
    ctx.fillRect(0, 0, W, H);

    if (this.mol.isEmpty()) {
      ctx.fillStyle = '#999';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('(empty)', W / 2, H / 2);
      return;
    }

    // ---- Phase 1: Analyse topology ----
    const info = this._analyse();

    // ---- Phase 2: Scale & transform ----
    const { sx, sy } = this._fitTransform(o.padding, W, H);
    const T = { sx, sy };
    const TU = (dx, dy) => {
      return [sx(dx) - sx(0), sy(dy) - sy(0)];
    };

    // ---- Phase 3: Draw bonds (bottom layer) ----
    this._drawBonds(ctx, info, T, TU, o);

    // ---- Phase 3.5: Draw carbonyl =O as real double bonds branching off skeleton ----
    this._drawCarbonyls(ctx, info, T, o);

    // ---- Phase 4: Draw heteroatom labels ----
    this._drawHeteroAtoms(ctx, info, T, o);

    // ---- Phase 5: Draw carbon H counts ----
    if (o.showCarbonH) {
      this._drawCarbonH(ctx, info, T, o);
    }

    // ---- Phase 6: Draw functional-group labels ----
    this._drawFGLabels(ctx, info, T, o);
  }

  // ==================== PHASE 1: TOPOLOGY ANALYSIS ====================

  _analyse() {
    const mol = this.mol;

    const carbons = [];     
    const heteroAtoms = []; 
    const ringAtomSet = new Set();

    // Detect rings
    const rings = mol.findRings();
    const ringCycles = this._uniqueRings(rings);
    for (const cycle of ringCycles) {
      for (const id of cycle) ringAtomSet.add(id);
    }

    // 计算每个环的几何中心（用于辅助优化双键朝向环内侧绘制）
    const ringCenters = ringCycles.map(cycle => {
      let sumX = 0, sumY = 0;
      for (const id of cycle) {
        const a = mol.atoms.get(id);
        if (a) { sumX += a.x; sumY += a.y; }
      }
      return { x: sumX / cycle.length, y: sumY / cycle.length };
    });

    // 建立化学键到环索引的映射
    const bondRingMap = new Map();
    function bondKey(a, b) { return a + '-' + b; }

    for (let ri = 0; ri < ringCycles.length; ri++) {
      const cycle = ringCycles[ri];
      const n = cycle.length;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        bondRingMap.set(bondKey(cycle[i], cycle[j]), ri);
        bondRingMap.set(bondKey(cycle[j], cycle[i]), ri);
      }
    }

    for (const [id, a] of mol.atoms) {
      const nbrs = mol.getNeighbors(id);
      const nBonds = nbrs.length;
      const hCount = mol.getImplicitH(id);
      const isRing = ringAtomSet.has(id);

      if (a.el === 'C') {
        carbons.push({ id, x: a.x, y: a.y, nBonds, hCount, isRing });
      } else {
        heteroAtoms.push({ id, x: a.x, y: a.y, el: a.el, hCount, fgs: a.fgs, isRing, nBonds });
      }
    }

    const ringBonds = [];
    const chainBonds = [];
    for (const b of mol.bonds) {
      const key = bondKey(b.a, b.b);
      const inRing = bondRingMap.has(key);
      const ringIdx = inRing ? bondRingMap.get(key) : -1;

      const entry = {
        a: b.a, b: b.b, 
        type: b.type || 'single',           // 'single', 'double', 'triple', 'hydrogen'
        stereo: b.stereo || 'none',         // 'none', 'wedge_up', 'wedge_down', 'wave'
        aEl: mol.atoms.get(b.a)?.el || 'C',
        bEl: mol.atoms.get(b.b)?.el || 'C',
        ax: mol.atoms.get(b.a)?.x || 0, ay: mol.atoms.get(b.a)?.y || 0,
        bx: mol.atoms.get(b.b)?.x || 0, by: mol.atoms.get(b.b)?.y || 0,
        inRing,
        ringCenter: ringIdx !== -1 ? ringCenters[ringIdx] : null,
        isCH: false,
      };

      if (entry.aEl === 'H' || entry.bEl === 'H') {
        entry.isCH = true;
        continue; // 骨架主线中忽略普通 C-H 显式键线
      }

      if (entry.inRing) ringBonds.push(entry);
      else chainBonds.push(entry);
    }

    return {
      carbons,
      heteroAtoms,
      allBonds: [...ringBonds, ...chainBonds],
      ringBonds,
      chainBonds,
      ringAtomSet,
      ringCycles,
    };
  }

  _uniqueRings(rings) {
    const seen = new Set();
    const result = [];
    for (const cycle of rings) {
      const key = [...cycle].sort().join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(cycle);
    }
    return result;
  }

  // ==================== PHASE 2: COORDINATE TRANSFORM ====================

  _fitTransform(pad, W, H) {
    const mol = this.mol;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (const [, a] of mol.atoms) {
      if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) continue;
      if (a.x < minX) minX = a.x;
      if (a.y < minY) minY = a.y;
      if (a.x > maxX) maxX = a.x;
      if (a.y > maxY) maxY = a.y;
    }

    // Guard against empty or collapsed bounds
    if (!Number.isFinite(minX)) { minX = -1; maxX = 1; }
    if (!Number.isFinite(minY)) { minY = -1; maxY = 1; }

    let rw = maxX - minX;
    let rh = maxY - minY;
    if (rw < 0.1) rw = 1.0;
    if (rh < 0.1) rh = 1.0;

    const scale = Math.min((W - pad * 2) / rw, (H - pad * 2) / rh);
    const cx = W / 2 - (minX + maxX) / 2 * scale;
    const cy = H / 2 - (minY + maxY) / 2 * scale;

    return {
      sx: (x) => Number.isFinite(x) ? x * scale + cx : 0,
      sy: (y) => Number.isFinite(y) ? y * scale + cy : 0,
      scale, cx, cy
    };
  }

  // ==================== PHASE 3: DRAW BONDS ====================

  _drawBonds(ctx, info, T, TU, o) {
    const { allBonds } = info;
    const { sx, sy } = T;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const mainColor = o.highContrast ? '#e0e0e0' : o.fgColor;
    ctx.strokeStyle = mainColor;

    for (const b of allBonds) {
      if (b.isCH) continue;

      const x1 = sx(b.ax), y1 = sy(b.ay);
      const x2 = sx(b.bx), y2 = sy(b.by);
      
      const dx = x2 - x1, dy = y2 - y1;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const ux = -dy / len, uy = dx / len; // 法向单位向量 (垂直于键线)

      // --- 立体化学键处理 (Wedge / Dash / Wave) ---
      if (b.stereo === 'wedge_up') {
        // 实楔形键：从原子 A 到 B 渐宽的实心三角形
        const w = o.wedgeWidth;
        ctx.fillStyle = mainColor;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2 + ux * w, y2 + uy * w);
        ctx.lineTo(x2 - ux * w, y2 - uy * w);
        ctx.closePath();
        ctx.fill();
        continue;
      } 
      
      if (b.stereo === 'wedge_down') {
        // 虚楔形键：一系列逐渐加宽的平行短线段
        const steps = o.dashCount;
        ctx.lineWidth = o.lineWidth;
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const lx = x1 + t * dx;
          const ly = y1 + t * dy;
          const currentW = t * o.wedgeWidth;
          ctx.beginPath();
          ctx.moveTo(lx - ux * currentW, ly - uy * currentW);
          ctx.lineTo(lx + ux * currentW, ly + uy * currentW);
          ctx.stroke();
        }
        continue;
      } 
      
      if (b.stereo === 'wave' || b.type === 'wavy') {
        // 波形键：外消旋体或未知构型，绘制平滑正弦样曲线
        ctx.lineWidth = o.lineWidth;
        ctx.beginPath();
        const waveSegments = Math.max(6, Math.floor(len / 5)) * 2;
        for (let i = 0; i <= waveSegments; i++) {
          const t = i / waveSegments;
          const lx = x1 + t * dx;
          const ly = y1 + t * dy;
          if (i === 0) {
            ctx.moveTo(lx, ly);
          } else {
            const amp = 3.5 * (i % 2 === 0 ? 1 : -1);
            const prevT = (i - 0.5) / waveSegments;
            const cx = x1 + prevT * dx + ux * amp;
            const cy = y1 + prevT * dy + uy * amp;
            ctx.quadraticCurveTo(cx, cy, lx, ly);
          }
        }
        ctx.stroke();
        continue;
      }

      // --- 普通化学键类型处理 (Single / Double / Triple / Hydrogen) ---
      if (b.type === 'hydrogen_bond' || b.type === 'hydrogen') {
        // 氢键：细虚线表示
        ctx.save();
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = o.lineWidth * 0.8;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        ctx.restore();
      } 
      else if (b.type === 'single') {
        ctx.lineWidth = o.lineWidth;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      } 
      else if (b.type === 'double') {
        if (b.inRing && b.ringCenter) {
          // 环内双键优化（凯库勒式）：一条为主骨架线，另一条缩短且偏移绘制于环的内侧
          ctx.lineWidth = o.lineWidth;
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();

          // 测算哪一个法向朝向环几何中心
          const rcX = sx(b.ringCenter.x), rcY = sy(b.ringCenter.y);
          const midX = (x1 + x2) / 2, midY = (y1 + y2) / 2;
          const toCenterDot = (rcX - midX) * ux + (rcY - midY) * uy;
          const side = toCenterDot >= 0 ? 1 : -1;

          const g = o.doubleGap;
          // 将内侧线段两端缩短 15%，防止重合交叉，契合 ChemDraw 视觉规范
          const inset = 0.15;
          const ix1 = x1 + dx * inset + ux * g * side;
          const iy1 = y1 + dy * inset + uy * g * side;
          const ix2 = x2 - dx * inset + ux * g * side;
          const iy2 = y2 - dy * inset + uy * g * side;

          ctx.lineWidth = o.lineWidth * 0.85;
          ctx.beginPath(); ctx.moveTo(ix1, iy1); ctx.lineTo(ix2, iy2); ctx.stroke();
        } else {
          // 链状双键：常规对称双线
          const g = o.doubleGap;
          ctx.lineWidth = o.lineWidth * 0.9;
          ctx.beginPath(); ctx.moveTo(x1 + ux * g, y1 + uy * g); ctx.lineTo(x2 + ux * g, y2 + uy * g); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x1 - ux * g, y1 - uy * g); ctx.lineTo(x2 - ux * g, y2 - uy * g); ctx.stroke();
        }
      } 
      else if (b.type === 'triple') {
        // 三键：中间一条主线，两侧对称分布细线
        const g = o.tripleGap;
        ctx.lineWidth = o.lineWidth;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        
        ctx.lineWidth = o.lineWidth * 0.75;
        ctx.beginPath(); ctx.moveTo(x1 + ux * g, y1 + uy * g); ctx.lineTo(x2 + ux * g, y2 + uy * g); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x1 - ux * g, y1 - uy * g); ctx.lineTo(x2 - ux * g, y2 - uy * g); ctx.stroke();
      }
    }
  }

  // ==================== PHASE 3.5: CARBONYL OXYGEN ====================

  _drawCarbonyls(ctx, info, T, o) {
    const mol = this.mol;
    const { sx, sy } = T;
    const mainColor = o.highContrast ? '#e0e0e0' : o.fgColor;
    const bondLen = o.bondLen || 44;
    const gap = o.doubleGap;

    // Collect carbonyl groups to draw:
    // 1. fg-based (editor-created molecules): carbon marked with 'CO' functional group
    // 2. explicit C=O (SMILES-parsed molecules): carbon double-bonded to a real oxygen atom
    const fgCarbonyls = [];  // {cId, ox, oy} — calculated O position
    const explicitCO = [];   // {cId, oId} — real C-O pair
    const carbonProcessed = new Set();

    for (const [id, a] of mol.atoms) {
      if (a.el !== 'C') continue;
      if (carbonProcessed.has(id)) continue;

      // Check explicit C=O double bond first (SMILES-parsed molecules)
      const nbrs = mol.getNeighbors(id);
      let foundExplicitO = null;
      for (const nb of nbrs) {
        const na = mol.atoms.get(nb);
        if (na && na.el === 'O' && mol.getBondType(id, nb) === 'double') {
          foundExplicitO = nb;
          break;
        }
      }

      if (foundExplicitO) {
        explicitCO.push({ cId: id, oId: foundExplicitO });
        carbonProcessed.add(id);
        continue;
      }

      // fg-based carbonyl (editor-created molecules)
      if (!a.fgs || !a.fgs.includes('CO')) continue;

      const heavyNbrs = nbrs.map(nb => mol.atoms.get(nb)).filter(na => na && na.el !== 'H');
      if (heavyNbrs.length === 0) continue;

      let ox, oy;
      if (heavyNbrs.length === 1) {
        const nb = heavyNbrs[0];
        const dx = a.x - nb.x, dy = a.y - nb.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const dirX = -dy / len, dirY = dx / len;
        ox = a.x + dirX * bondLen;
        oy = a.y + dirY * bondLen;
      } else {
        const n1 = heavyNbrs[0], n2 = heavyNbrs[1];
        const a1 = Math.atan2(n1.y - a.y, n1.x - a.x);
        const a2 = Math.atan2(n2.y - a.y, n2.x - a.x);
        let diff = a2 - a1;
        while (diff <= -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        const bisect = a1 + diff / 2;
        const midDirX = Math.cos(a1) + Math.cos(a2);
        const midDirY = Math.sin(a1) + Math.sin(a2);
        const bisectX = Math.cos(bisect), bisectY = Math.sin(bisect);
        const dot = bisectX * midDirX + bisectY * midDirY;
        const dirX = dot > 0 ? -bisectX : bisectX;
        const dirY = dot > 0 ? -bisectY : bisectY;
        ox = a.x + dirX * bondLen;
        oy = a.y + dirY * bondLen;
      }
      fgCarbonyls.push({ cId: id, ox, oy });
      carbonProcessed.add(id);
    }

    // Draw explicit C=O bonds (SMILES-parsed)
    for (const { cId, oId } of explicitCO) {
      const cAtom = mol.atoms.get(cId);
      const oAtom = mol.atoms.get(oId);
      const x1 = sx(cAtom.x), y1 = sy(cAtom.y);
      const x2 = sx(oAtom.x), y2 = sy(oAtom.y);
      const dx = x2 - x1, dy = y2 - y1;
      const len2 = Math.sqrt(dx * dx + dy * dy) || 1;
      const ux = -dy / len2, uy = dx / len2;

      ctx.lineWidth = o.lineWidth * 0.9;
      ctx.strokeStyle = mainColor;
      ctx.beginPath(); ctx.moveTo(x1 + ux * gap, y1 + uy * gap); ctx.lineTo(x2 + ux * gap, y2 + uy * gap); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x1 - ux * gap, y1 - uy * gap); ctx.lineTo(x2 - ux * gap, y2 - uy * gap); ctx.stroke();

      // Red O label + mask at oxygen position
      ctx.fillStyle = o.bgColor;
      ctx.beginPath(); ctx.arc(x2, y2, 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#EE1010';
      ctx.font = o.font || "bold 12px 'Segoe UI', Arial, sans-serif";
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('O', x2, y2);
    }

    // Draw fg-based carbonyls (editor-created)
    for (const { cId, ox, oy } of fgCarbonyls) {
      const a = mol.atoms.get(cId);
      const x1 = sx(a.x), y1 = sy(a.y);
      const x2 = sx(ox), y2 = sy(oy);
      const dx = x2 - x1, dy = y2 - y1;
      const len2 = Math.sqrt(dx * dx + dy * dy) || 1;
      const ux = -dy / len2, uy = dx / len2;

      ctx.lineWidth = o.lineWidth * 0.9;
      ctx.strokeStyle = mainColor;
      ctx.beginPath(); ctx.moveTo(x1 + ux * gap, y1 + uy * gap); ctx.lineTo(x2 + ux * gap, y2 + uy * gap); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x1 - ux * gap, y1 - uy * gap); ctx.lineTo(x2 - ux * gap, y2 - uy * gap); ctx.stroke();

      ctx.fillStyle = o.bgColor;
      ctx.beginPath(); ctx.arc(x2, y2, 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#EE1010';
      ctx.font = o.font || "bold 12px 'Segoe UI', Arial, sans-serif";
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('O', x2, y2);
    }
  }

  // ==================== PHASE 4: HETEROATOM LABELS ====================

  _drawHeteroAtoms(ctx, info, T, o) {
    const { heteroAtoms } = info;
    const { sx, sy } = T;
    const mol = this.mol;

    const elCol = {
      O: '#EE1010', N: '#1848F0', S: '#A08808',
      F: '#50B840', Cl: '#18B018', Br: '#882222',
      I: '#8B008B', P: '#E07020',
    };

    const mainColor = o.highContrast ? '#e0e0e0' : o.fgColor;

    for (const ha of heteroAtoms) {
      // Skip oxygens that are part of a C=O double bond (carbonyl)
      // — they are already drawn by _drawCarbonyls
      if (ha.el === 'O') {
        const hNbrs = mol.getNeighbors(ha.id);
        let isCarbonylO = false;
        for (const hn of hNbrs) {
          const hna = mol.atoms.get(hn);
          if (hna && hna.el === 'C' && mol.getBondType(ha.id, hn) === 'double') {
            isCarbonylO = true;
            break;
          }
        }
        if (isCarbonylO) continue;
      }

      const x = sx(ha.x), y = sy(ha.y);

      // 自动避让与文本重排：根据邻接键的平均方向判定基团文字排布（避免键线覆盖标签）
      const nbrs = mol.getNeighbors(ha.id);
      let sumDx = 0;
      for (const nb of nbrs) {
        const na = mol.atoms.get(nb);
        if (na) sumDx += na.x - ha.x;
      }

      let label = ha.el;
      let hPart = '';
      if (ha.hCount > 0) {
        hPart = 'H' + (ha.hCount === 1 ? '' : subscripts(ha.hCount));
      }

      // 如果邻接碳骨架都在右侧 (sumDx > 0.1)，将 H 置于左侧 (例如 H₂N- 替换 -NH₂)
      let fullText = label + hPart;
      if (sumDx > 0.1 && hPart) {
        fullText = hPart + label;
      }

      ctx.font = o.font || "bold 12px 'Segoe UI', Arial, sans-serif";

      // 圆形遮罩：用背景色填充以阻断穿过的化学键线
      ctx.fillStyle = o.bgColor;
      ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill();

      // 绘制杂原子标签
      ctx.fillStyle = elCol[ha.el] || mainColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(fullText, x, y);
    }
  }

  // ==================== PHASE 5: CARBON H COUNTS ====================

  _drawCarbonH(ctx, info, T, o) {
    const { carbons } = info;
    const { sx, sy } = T;
    const mol = this.mol;

    if (carbons.length === 0) return;

    for (const c of carbons) {
      const hc = c.hCount;
      if (hc <= 0) continue;

      const x = sx(c.x), y = sy(c.y);

      // 计算所有连带键的合力反方向，将氢原子个数标志推向“空白安全区”
      const nbrs = mol.getNeighbors(c.id);
      let sumDx = 0, sumDy = 0;
      for (const nb of nbrs) {
        const na = mol.atoms.get(nb);
        if (na) {
          sumDx += sx(na.x) - x;
          sumDy += sy(na.y) - y;
        }
      }
      const dlen = Math.sqrt(sumDx * sumDx + sumDy * sumDy) || 1;
      const ndx = -sumDx / dlen, ndy = -sumDy / dlen; 

      // 动态向外平移定位
      const ox = x + ndx * 13;
      const oy = y + ndy * 13;

      const hLabel = 'H' + (hc === 1 ? '' : subscripts(hc));

      ctx.font = "9px 'Segoe UI', Arial, sans-serif";
      const tw = ctx.measureText(hLabel).width + 4;
      
      ctx.fillStyle = 'rgba(255,255,255,0.88)';
      ctx.fillRect(ox - tw / 2, oy - 6, tw, 12);

      ctx.fillStyle = '#555555';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(hLabel, ox, oy);
    }
  }

  // ==================== PHASE 6: FUNCTIONAL GROUP LABELS ====================

  _drawFGLabels(ctx, info, T, o) {
    const { heteroAtoms, carbons } = info;
    const { sx, sy } = T;
    const mol = this.mol;

    const allAtoms = [...heteroAtoms];
    for (const c of carbons) {
      const a = mol.atoms.get(c.id);
      if (a && a.fgs.length > 0) {
        allAtoms.push({ ...c, fgs: a.fgs, el: 'C' });
      }
    }

    const FG_NAMES = {
      OH: 'OH', CHO: 'CHO', COOH: 'COOH',
      'NH2': 'NH\u2082', 'NO2': 'NO\u2082', CN: 'CN',
      Ph: 'Ph',
    };

    for (const a of allAtoms) {
      if (!a.fgs || a.fgs.length === 0) continue;

      const x = sx(a.x), y = sy(a.y);

      const nbrs = mol.getNeighbors(a.id);
      let sumDx = 0, sumDy = 0;
      for (const nb of nbrs) {
        const na = mol.atoms.get(nb);
        if (na) {
          sumDx += sx(na.x) - x;
          sumDy += sy(na.y) - y;
        }
      }
      const dlen = Math.sqrt(sumDx * sumDx + sumDy * sumDy) || 1;
      const ndx = -sumDx / dlen, ndy = -sumDy / dlen;

      for (let fi = 0; fi < a.fgs.length; fi++) {
        const fg = a.fgs[fi];
        if (fg === 'CO') continue; // carbonyl =O is drawn as a real bond in _drawCarbonyls
<<<<<<< HEAD
=======
        if (fg === 'Ph') continue; // Ph is drawn as actual ring atoms, not a label
>>>>>>> de6fd6c (v1.0: OrChem molecular editor with 2D/3D rendering, functional groups, synthesis inference)
        const label = FG_NAMES[fg] || fg;

        const ox = x + ndx * 15;
        const oy = y + ndy * 15 - fi * 12;

        ctx.font = "bold 10px 'Segoe UI', Arial, sans-serif";
        const tw = ctx.measureText(label).width + 4;

        ctx.fillStyle = o.bgColor;
        ctx.fillRect(ox - tw / 2, oy - 6, tw, 12);

        ctx.fillStyle = '#C05515'; // 经典稳重的官能团橙褐色标识
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, ox, oy);
      }
    }
  }
}

// ==================== HELPERS ====================

/** 转换数字为符合化学式排版规范的 Unicode 下标字符 */
function subscripts(n) {
  const subs = ['₀','₁','₂','₃','₄','₅','₆','₇','₈','₉'];
  return String(n).split('').map(c => subs[+c] || c).join('');
}