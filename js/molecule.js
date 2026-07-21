// ==================== CONSTANTS ====================
const ATOMIC_WEIGHTS = {
  H:1.008, C:12.011, N:14.007, O:15.999,
  F:18.998, S:32.065, Cl:35.45, Br:79.904, I:126.90, P:30.974
};
const VALENCES = {
  C:4, N:3, O:2, S:2, F:1, Cl:1, Br:1, I:1, P:3, H:1
};
const FG_CONTRIB = {
  'OH':  { atoms:{O:1,H:1},     v:1 },
  'CHO': { atoms:{O:1},         v:2 },  // =O (2v) on carbon; aldehyde H is implicit
  'COOH':{ atoms:{O:2,H:1},     v:3 },  // =O (2v) + -OH (1v); base C IS carboxyl C
  'NH2': { atoms:{N:1,H:2},     v:1 },
  'NO2': { atoms:{N:1,O:2},     v:1 },
  'CN':  { atoms:{N:1},         v:3 },  // ≡N (3v); base C is cyano C
  'CO':  { atoms:{O:1},         v:2 },  // C=O: the C IS the atom; only extra O
  'Ph':  { atoms:{C:6,H:5},     v:1 },
};

let nextAtomId = 0;
function genId() { return nextAtomId++; }

// ==================== ATOM ====================
class Atom {
  constructor(x, y, el = 'C') {
    this.id = genId();
    this.x = x;
    this.y = y;
    this.el = el;
    this.fgs = [];  // functional groups attached
    this.aromatic = false;  // aromatic ring atom flag
  }
  clone() {
    const a = new Atom(this.x, this.y, this.el);
    a.id = this.id;
    a.fgs = [...this.fgs];
    a.aromatic = this.aromatic;
    return a;
  }
}

// ==================== BOND ====================
class Bond {
  constructor(a, b, type = 'single') {
    this.a = a;
    this.b = b;
    this.type = type; // 'single' | 'double' | 'triple' | 'aromatic'
  }
  clone() { return new Bond(this.a, this.b, this.type); }
  has(id) { return this.a === id || this.b === id; }
  other(id) { return this.a === id ? this.b : this.a; }
}

// ==================== MOLECULE ====================
class Molecule {
  constructor() {
    this.atoms = new Map();
    this.bonds = [];
  }

  clone() {
    const m = new Molecule();
    for (const [id, a] of this.atoms) m.atoms.set(id, a.clone());
    m.bonds = this.bonds.map(b => b.clone());
    return m;
  }

  addAtom(x, y, el = 'C') {
    const a = new Atom(x, y, el);
    this.atoms.set(a.id, a);
    return a;
  }

  removeAtom(id) {
    this.bonds = this.bonds.filter(b => !b.has(id));
    this.atoms.delete(id);
  }

  addBond(aId, bId, type = 'single') {
    if (aId === bId || this.getBond(aId, bId)) return null;
    const b = new Bond(aId, bId, type);
    this.bonds.push(b);
    return b;
  }

  getBond(aId, bId) {
    return this.bonds.find(b => b.has(aId) && b.has(bId));
  }

  removeBond(aId, bId) {
    this.bonds = this.bonds.filter(b => !(b.has(aId) && b.has(bId)));
  }

  getNeighbors(atomId) {
    return this.bonds
      .filter(b => b.has(atomId))
      .map(b => b.other(atomId));
  }

  getBondType(aId, bId) {
    const b = this.getBond(aId, bId);
    return b ? b.type : null;
  }

  setBondType(aId, bId, type) {
    const b = this.getBond(aId, bId);
    if (b) b.type = type;
  }

  getDegree(atomId) {
    return this.bonds.filter(b => b.has(atomId)).length;
  }

  /**
   * Check whether a functional group attached to atomId is already
   * represented by real atoms/bonds. Used to avoid double-counting
   * when the molecule has been migrated from the legacy `atom.fgs`
   * representation to explicit atoms.
   */
  _fgAlreadyReal(atomId, fg) {
    const a = this.atoms.get(atomId);
    if (!a) return false;
    const nbrs = this.getNeighbors(atomId);
    const hasElBond = (el, type) => nbrs.some(id => {
      const na = this.atoms.get(id);
      return na && na.el === el && this.getBondType(atomId, id) === type;
    });
    if (fg === 'OH' || fg === 'NH2') {
      return hasElBond(fg === 'OH' ? 'O' : 'N', 'single');
    }
    if (fg === 'CO' || fg === 'CHO') {
      return hasElBond('O', 'double');
    }
    if (fg === 'COOH') {
      return hasElBond('O', 'double') && hasElBond('O', 'single');
    }
    if (fg === 'CN') {
      return hasElBond('N', 'triple');
    }
    if (fg === 'NO2') {
      return nbrs.some(id => {
        const na = this.atoms.get(id);
        if (!na || na.el !== 'N') return false;
        const oCount = this.getNeighbors(id).filter(oid => {
          const oa = this.atoms.get(oid);
          return oa && oa.el === 'O' && this.getBondType(id, oid) === 'double';
        }).length;
        return oCount >= 2;
      });
    }
    if (fg === 'Ph') {
      return nbrs.some(id => {
        const na = this.atoms.get(id);
        if (!na || na.el !== 'C') return false;
        return this.findRings().some(r => r.length === 6 && r.includes(id));
      });
    }
    return false;
  }

  getOccupiedValence(atomId) {
    const a = this.atoms.get(atomId);
    if (!a) return 0;
    let v = 0;
    for (const b of this.bonds) {
      if (!b.has(atomId)) continue;
      if (b.type === 'single') v += 1;
      else if (b.type === 'double') v += 2;
      else if (b.type === 'triple') v += 3;
    }
    for (const fg of a.fgs) {
      if (this._fgAlreadyReal(atomId, fg)) continue;
      v += FG_CONTRIB[fg] ? FG_CONTRIB[fg].v : 1;
    }
    return v;
  }

  getImplicitH(atomId) {
    const a = this.atoms.get(atomId);
    if (!a) return 0;
    return Math.max(0, (VALENCES[a.el] || 4) - this.getOccupiedValence(atomId));
  }

  getAtomCounts() {
    const counts = {};
    for (const [id, a] of this.atoms) {
      counts[a.el] = (counts[a.el] || 0) + 1;
      for (const fg of a.fgs) {
        if (this._fgAlreadyReal(id, fg)) continue;
        if (!FG_CONTRIB[fg]) continue;
        for (const [el2, n] of Object.entries(FG_CONTRIB[fg].atoms)) {
          counts[el2] = (counts[el2] || 0) + n;
        }
      }
    }
    let totalH = 0;
    for (const [id, a] of this.atoms) {
      totalH += this.getImplicitH(id);
    }
    counts['H'] = (counts['H'] || 0) + totalH;
    return counts;
  }

  getPlainFormula() {
    const c = this.getAtomCounts();
    const o = ['C','H','O','N','S','F','Cl','Br','I','P'];
    let s = '';
    for (const el of o) if (c[el]) s += el + (c[el] > 1 ? c[el] : '');
    return s || '—';
  }

  getFormulaHTML() {
    const c = this.getAtomCounts();
    const o = ['C','H','O','N','S','F','Cl','Br','I','P'];
    let s = '';
    for (const el of o) if (c[el]) s += el + (c[el] > 1 ? '<sub>' + c[el] + '</sub>' : '');
    return s || '—';
  }

  getMolarMass() {
    const c = this.getAtomCounts();
    let m = 0;
    for (const [el, n] of Object.entries(c)) {
      m += n * (ATOMIC_WEIGHTS[el] || 0);
    }
    return m;
  }

  getUnsaturation() {
    const c = this.getAtomCounts();
    const C = c['C'] || 0, H = c['H'] || 0, N = c['N'] || 0;
    const X = (c['F'] || 0) + (c['Cl'] || 0) + (c['Br'] || 0) + (c['I'] || 0);
    // Standard DBE formula: (2C + 2 + N - H - X) / 2
    // Rings are already implicit in the H count via implicit-H calculation,
    // so do NOT add countRings() again.
    const u = (2 * C + 2 + N - H - X) / 2;
    return Math.max(0, Math.round(u));
  }

  countRings() {
    const comps = this.countComponents();
    return Math.max(0, this.bonds.length - this.atoms.size + comps);
  }

  countComponents() {
    const vis = new Set();
    let comps = 0;
    for (const [id] of this.atoms) {
      if (vis.has(id)) continue;
      comps++;
      const stack = [id];
      while (stack.length) {
        const cur = stack.pop();
        if (vis.has(cur)) continue;
        vis.add(cur);
        for (const nb of this.getNeighbors(cur)) {
          if (!vis.has(nb)) stack.push(nb);
        }
      }
    }
    return comps;
  }

  identifyFunctionalGroups() {
    const countMap = new Map(); // key -> count
    const fgSet = new Set();

    function add(key, label) {
      countMap.set(label, (countMap.get(label) || 0) + 1);
      fgSet.add(key);
    }

    // Detect aromatic rings: rings where ALL C-C bonds are conjugated (single/double alternating
    // or all identical in the ring). For now, checks any ring with C=C inside it.
    const rings = this.findRings();
    const aromaticAtoms = new Set();
    for (const cycle of rings) {
      const rSet = new Set(cycle);
      let ringHasCCdouble = false;
      for (const b of this.bonds) {
        if (b.type === 'double' && this.atoms.get(b.a)?.el === 'C' && this.atoms.get(b.b)?.el === 'C') {
          if (rSet.has(b.a) && rSet.has(b.b)) { ringHasCCdouble = true; break; }
        }
      }
      if (ringHasCCdouble) {
        add('aromatic', '芳环');
        for (const id of cycle) aromaticAtoms.add(id);
      }
    }

    // Functional groups are now explicit atoms/bonds.
    // First classify carbonyl carbons (C=O).
    const carbonylCs = new Set();   // any C=O
    const carboxylCs = new Set();   // C(=O)-OH
    const esterCs = new Set();      // C(=O)-O-
    for (const [id, a] of this.atoms) {
      if (a.el !== 'C') continue;
      const nbrs = this.getNeighbors(id);
      let hasDoubleO = false;
      let hasSingleO = false;
      for (const nb of nbrs) {
        const nbA = this.atoms.get(nb);
        const bt = this.getBondType(id, nb);
        if (nbA && nbA.el === 'O' && bt === 'double') hasDoubleO = true;
        if (nbA && nbA.el === 'O' && bt === 'single') hasSingleO = true;
      }
      if (!hasDoubleO) continue;
      carbonylCs.add(id);
      if (hasSingleO) {
        // Carboxyl if the single-bonded O is -OH (not bridging to another C)
        let ohO = false;
        for (const nb of nbrs) {
          const nbA = this.atoms.get(nb);
          if (nbA && nbA.el === 'O' && this.getBondType(id, nb) === 'single') {
            // O is -OH if it has no C neighbor besides this carbonyl C
            const oNbrs = this.getNeighbors(nb).filter(oid => {
              const oa = this.atoms.get(oid);
              return oa && oa.el === 'C' && oid !== id;
            });
            if (oNbrs.length === 0) { ohO = true; break; }
          }
        }
        if (ohO) carboxylCs.add(id);
        else esterCs.add(id);
      }
    }

    for (const id of carboxylCs) add('carboxylic_acid', '羧酸 -COOH');
    for (const id of esterCs) add('ester', '酯 -COO-');
    for (const id of carbonylCs) {
      if (carboxylCs.has(id) || esterCs.has(id)) continue;
      const carbonNbrs = this.getNeighbors(id).filter(nb => this.atoms.get(nb)?.el === 'C').length;
      if (carbonNbrs === 1) add('aldehyde', '醛 -CHO');
      else if (carbonNbrs >= 2) add('ketone', '酮 C=O');
      else add('ketone', '酮 C=O'); // generic carbonyl (e.g. urea, amide)
    }

    // Alcohol: C bonded to -OH (single-bonded O that has no other C neighbor = not bridging)
    for (const [id, a] of this.atoms) {
      if (a.el !== 'C' || carboxylCs.has(id) || esterCs.has(id)) continue;
      for (const nb of this.getNeighbors(id)) {
        const nbA = this.atoms.get(nb);
        if (!nbA || nbA.el !== 'O' || this.getBondType(id, nb) !== 'single') continue;
        // Exclude bridging O (ether/ester oxygen with another C neighbor)
        const otherCs = this.getNeighbors(nb).filter(oid => {
          const oa = this.atoms.get(oid);
          return oa && oa.el === 'C' && oid !== id;
        });
        if (otherCs.length === 0) {
          add('alcohol', '醇 -OH');
          break;
        }
      }
    }

    // Amine: any N atom not part of a nitro or amide-like group.
    // (Urea NH₂ counts as amine; true amides can be added separately later.)
    for (const [id, a] of this.atoms) {
      if (a.el !== 'N') continue;
      // Skip nitro N (has ≥2 double-bonded O)
      const doubleOs = this.getNeighbors(id).filter(nb => {
        const nbA = this.atoms.get(nb);
        return nbA && nbA.el === 'O' && this.getBondType(id, nb) === 'double';
      }).length;
      if (doubleOs >= 2) continue;
      // Skip tertiary/aromatic N with 3 covalent bonds (e.g. pyridine N)
      // that are not attached to any H (no single bonds to non-O/C heavy atoms)
      // — for now accept any non-nitro N as amine
      add('amine', '胺 -NH₂');
    }

    // Nitro: N with at least two double-bonded O
    for (const [id, a] of this.atoms) {
      if (a.el !== 'N') continue;
      const doubleOs = this.getNeighbors(id).filter(nb => {
        const nbA = this.atoms.get(nb);
        return nbA && nbA.el === 'O' && this.getBondType(id, nb) === 'double';
      }).length;
      if (doubleOs >= 2) add('nitro', '硝基 -NO₂');
    }

    // Nitrile: C≡N
    for (const b of this.bonds) {
      if (b.type === 'triple') {
        const aA = this.atoms.get(b.a), aB = this.atoms.get(b.b);
        if ((aA?.el === 'C' && aB?.el === 'N') || (aA?.el === 'N' && aB?.el === 'C')) {
          add('nitrile', '腈 -CN');
        }
      }
    }

    // Halogens
    for (const [id, a] of this.atoms) {
      if (['F','Cl','Br','I'].includes(a.el)) add('halo', '卤代 -' + a.el);
    }

    let hasD = false, hasT = false;
    for (const b of this.bonds) {
      if (b.type === 'double' && this.atoms.get(b.a)?.el === 'C' && this.atoms.get(b.b)?.el === 'C') {
        // Skip aromatic ring C=C: already counted under "芳环"
        if (!aromaticAtoms.has(b.a) || !aromaticAtoms.has(b.b)) hasD = true;
      }
      if (b.type === 'triple' && this.atoms.get(b.a)?.el === 'C' && this.atoms.get(b.b)?.el === 'C') hasT = true;
    }
    if (hasD) { add('alkene', '烯 C=C'); }
    if (hasT) { add('alkyne', '炔 C≡C'); }
    if (this.countRings() > 0) { add('cyclic', '环状结构'); }

    // Build display list with ×n
    const disp = [];
    for (const [label, count] of countMap) {
      disp.push(count > 1 ? `${label} ×${count}` : label);
    }

    return { display: disp, set: fgSet };
  }

  // ---- Hybridization and Structural Analysis ----
  getHybridization(atomId) {
    const a = this.atoms.get(atomId);
    if (!a) return 'sp3';
    const neigh = this.getNeighbors(atomId);
    let hasDouble = false, hasTriple = false;
    for (const nb of neigh) {
      const bt = this.getBondType(atomId, nb);
      if (bt === 'double') hasDouble = true;
      if (bt === 'triple') hasTriple = true;
    }
    if (hasTriple) return 'sp';
    if (hasDouble) return 'sp2';
    if (a.aromatic) return 'sp2'; // aromatic carbon (parsed from lowercase 'c' in SMILES)
    return 'sp3';
  }

  // Detect all cycles (rings) in the molecule
  // Detect all minimal cycles (SSSR - Smallest Set of Smallest Rings)
  findRings() {
    const rings = [];
    const MAX_RING = 8;

    for (const [startId] of this.atoms) {
      const queue = [[startId]];
      while (queue.length > 0) {
        const path = queue.shift();
        const cur = path[path.length - 1];
        if (path.length > MAX_RING) continue;

        for (const nb of this.getNeighbors(cur)) {
          if (path.length > 1 && nb === path[path.length - 2]) continue;
          if (path.includes(nb)) {
            const idx = path.indexOf(nb);
            const cycle = path.slice(idx);
            if (cycle.length >= 3 && cycle.length <= MAX_RING) {
              const key = [...cycle].sort().join(',');
              if (!rings.some(r => r.key === key)) {
                rings.push({ key, cycle });
              }
            }
          } else {
            queue.push([...path, nb]);
          }
        }
      }
    }

    // Filter out pseudo-rings that have chords (cross-bonds)
    const minimalRings = [];
    for (const r of rings) {
      const cycle = r.cycle;
      let hasChord = false;
      for (let i = 0; i < cycle.length; i++) {
        for (let j = i + 2; j < cycle.length; j++) {
          if (i === 0 && j === cycle.length - 1) continue;
          if (this.getBond(cycle[i], cycle[j])) {
            hasChord = true;
            break;
          }
        }
        if (hasChord) break;
      }
      if (!hasChord) minimalRings.push(cycle);
    }
    return minimalRings;
  }

  // Kekulize aromatic rings: set alternating single/double bonds
  kekulize() {
    const rings = this.findRings();
    for (const ring of rings) {
      if (ring.length % 2 !== 0) continue;
      // Only kekulize rings where all atoms are marked aromatic
      const allAromatic = ring.every(id => {
        const a = this.atoms.get(id);
        return a && a.aromatic;
      });
      if (!allAromatic) continue;
      // Skip if already kekulized (has double bonds)
      let hasDouble = false;
      for (let i = 0; i < ring.length; i++) {
        const j = (i + 1) % ring.length;
        if (this.getBondType(ring[i], ring[j]) === 'double') {
          hasDouble = true;
          break;
        }
      }
      if (hasDouble) continue;
      // Set alternating single/double bonds
      for (let i = 0; i < ring.length - 1; i += 2) {
        this.setBondType(ring[i], ring[(i + 1) % ring.length], 'double');
      }
    }
    return this;
  }

  // Normalize molecular structure: uniform bond lengths, proper angles
  normalizeStructure() {
    if (this.atoms.size === 0) return this;
    const BL = 72; // standard bond length in pixels

    // Get all minimal chordless cycles (SSSR), largest first
    const cycles = this.findRings();
    cycles.sort((a, b) => b.length - a.length);

    const placed = new Set();
    const positions = new Map(); // atomId -> {x, y}

    // Phase 1: Smart fused ring placement with shared-edge anchoring
    const placedRings = []; // { cycle, center }
    const remainingCycles = cycles.map(c => this._orderRingAtoms(c));

    if (remainingCycles.length > 0) {
      // Draw the first ring as a regular polygon
      const firstCycle = remainingCycles.shift();
      const n = firstCycle.length;
      const r = BL / (2 * Math.sin(Math.PI / n));
      const cx = 400, cy = 300;

      for (let i = 0; i < n; i++) {
        const angle = (Math.PI * 2 / n) * i - Math.PI / 2;
        positions.set(firstCycle[i], { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
        placed.add(firstCycle[i]);
      }
      placedRings.push({ cycle: firstCycle, center: { x: cx, y: cy } });

      // Iteratively attach remaining rings via shared edges
      let progress = true;
      while (remainingCycles.length > 0 && progress) {
        progress = false;

        for (let idx = 0; idx < remainingCycles.length; idx++) {
          const cycle = remainingCycles[idx];
          const sharedIndices = [];
          for (let i = 0; i < cycle.length; i++) {
            if (placed.has(cycle[i])) sharedIndices.push(i);
          }

          if (sharedIndices.length >= 2) {
            // Find an adjacent pair (shared edge) in the cycle
            let pair = null;
            const clen = cycle.length;
            for (let i = 0; i < sharedIndices.length; i++) {
              for (let j = i + 1; j < sharedIndices.length; j++) {
                const a = sharedIndices[i], b = sharedIndices[j];
                if (Math.abs(a - b) === 1 || Math.abs(a - b) === clen - 1) {
                  pair = [a, b]; break;
                }
              }
              if (pair) break;
            }

            if (pair) {
              const id1 = cycle[pair[0]], id2 = cycle[pair[1]];
              const p1 = positions.get(id1), p2 = positions.get(id2);

              // --- Topological Winding Alignment ---
              // Reorder cycle so shared edge atoms are at indices 0 and 1
              let ordered = [...cycle];
              while (!(ordered[0] === id1 && ordered[1] === id2) &&
                     !(ordered[0] === id2 && ordered[1] === id1)) {
                ordered.push(ordered.shift());
              }
              // Ensure id1 is at index 0, id2 at index 1
              if (ordered[0] !== id1) {
                ordered.reverse();
                while (ordered[0] !== id1) ordered.push(ordered.shift());
              }

              // Find the parent ring that owns this shared edge
              let parentRing = placedRings.find(pr =>
                pr.cycle.includes(id1) && pr.cycle.includes(id2));
              if (!parentRing) parentRing = placedRings[0];

              // Midpoint of shared edge
              const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;

              // Outward normal from parent ring center → edge midpoint
              let ox = mx - parentRing.center.x, oy = my - parentRing.center.y;
              let len = Math.hypot(ox, oy);
              if (len < 0.1) { ox = 1; oy = 0; len = 1; }
              ox /= len; oy /= len;

              const clen = cycle.length;
              const h = (BL / 2) / Math.tan(Math.PI / clen);
              const ncx = mx + ox * h, ncy = my + oy * h;
              const ringRadius = BL / (2 * Math.sin(Math.PI / clen));

              const a1 = Math.atan2(p1.y - ncy, p1.x - ncx);
              const a2 = Math.atan2(p2.y - ncy, p2.x - ncx);
              let diff = a2 - a1;
              while (diff < -Math.PI) diff += Math.PI * 2;
              while (diff > Math.PI) diff -= Math.PI * 2;
              const dirSign = diff > 0 ? 1 : -1;
              const exactStep = dirSign * (Math.PI * 2) / clen;

              // Place unplaced atoms in topological order (i = 2..n-1)
              for (let i = 2; i < clen; i++) {
                const id = ordered[i];
                if (!placed.has(id)) {
                  const angle = a1 + i * exactStep;
                  positions.set(id, {
                    x: ncx + ringRadius * Math.cos(angle),
                    y: ncy + ringRadius * Math.sin(angle)
                  });
                  placed.add(id);
                }
              }

              placedRings.push({ cycle, center: { x: ncx, y: ncy } });
              remainingCycles.splice(idx, 1);
              progress = true;
              break;
            }
          }
        }

        // Fallback for isolated rings (not connected to any placed ring)
        if (!progress && remainingCycles.length > 0) {
          const isoCycle = remainingCycles.shift();
          const n = isoCycle.length;
          const r = BL / (2 * Math.sin(Math.PI / n));
          const cx = 400 + (placedRings.length % 4) * 200;
          const cy = 300 + Math.floor(placedRings.length / 4) * 200;
          for (let i = 0; i < n; i++) {
            const angle = (Math.PI * 2 / n) * i - Math.PI / 2;
            positions.set(isoCycle[i], { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
            placed.add(isoCycle[i]);
          }
          placedRings.push({ cycle: isoCycle, center: { x: cx, y: cy } });
          progress = true;
        }
      }
    }

    // Build ringCenters map (for dirAngle calculation in Phase 2)
    const ringCenters = new Map();
    for (const pr of placedRings) {
      for (const id of pr.cycle) ringCenters.set(id, pr.center);
    }

    const queue = [];
    for (const id of placed) {
      const p = positions.get(id);
      const center = ringCenters.get(id);
      // For ring atoms, dirAngle points from ring center to atom (outward bisector).
      // For overlapping atoms not in a recognized cycle, fall back to 0.
      // dirAngle is the direction this atom "came from" (analogous to parent->current).
      // For ring atoms, use the inward direction (atom -> ring center) so that
      // baseAngle + Math.PI places substituents along the outward bisector (120° geometry).
      const dirAngle = center ? Math.atan2(center.y - p.y, center.x - p.x) : 0;
      queue.push({ id, parent: null, dirAngle, fromRing: true, sign: 1 });
    }

    // If nothing placed yet (no rings), start from first atom
    if (queue.length === 0) {
      const firstId = this.atoms.keys().next().value;
      positions.set(firstId, { x: 400, y: 300 });
      placed.add(firstId);
      queue.push({ id: firstId, parent: null, dirAngle: 0, sign: 1 });
    }

    const visited = new Set();
    // BFS: queue items include the direction FROM parent TO this node
    while (queue.length > 0) {
      const { id, parent: pid, dirAngle, fromRing, sign = 1 } = queue.shift();
      if (visited.has(id)) continue;
      visited.add(id);

      const hyb = this.getHybridization(id);
      // Only consider unplaced neighbors — placed ring atoms should not inflate deg
      const neigh = this.getNeighbors(id).filter(nb => !placed.has(nb));

      if (neigh.length === 0) continue;

      const pos = positions.get(id);
      const baseAngle = (dirAngle !== undefined) ? dirAngle : 0;

      // Determine placement angles based on hybridization
      let angles = [];

      // For ring atoms: compute actual bond directions of already-placed neighbors
      // to ensure precise 120° geometry relative to real ring bonds
      const placedNbrDirs = [];
      const allNbrs = this.getNeighbors(id);
      for (const nb of allNbrs) {
        if (placed.has(nb)) {
          const np = positions.get(nb);
          if (np) {
            placedNbrDirs.push(Math.atan2(np.y - pos.y, np.x - pos.x));
          }
        }
      }

      if (hyb === 'sp') {
        // Linear: place unvisited children on the opposite side
        angles = [baseAngle + Math.PI, baseAngle];
      } else if (hyb === 'sp2') {
        // Trigonal planar: 120° apart
        // If we have existing bond directions, use them to compute exact 120° placement
        if (placedNbrDirs.length > 0 && fromRing) {
          // Sort existing bond directions
          placedNbrDirs.sort((a, b) => a - b);
          // Find the largest gap between consecutive bonds (wrapping around)
          let maxGap = 0, gapStart = placedNbrDirs[0];
          const nDir = placedNbrDirs.length;
          for (let i = 0; i < nDir; i++) {
            const j = (i + 1) % nDir;
            let gap = placedNbrDirs[j] - placedNbrDirs[i];
            if (i === nDir - 1) gap += 2 * Math.PI;
            if (gap > maxGap) { maxGap = gap; gapStart = placedNbrDirs[i]; }
          }
          // Place new substituents evenly in the largest gap at 120° spacing
          const nNew = neigh.length;
          for (let k = 1; k <= nNew; k++) {
            angles.push(gapStart + maxGap * (k / (nNew + 1)));
          }
        } else {
          // Fallback: use baseAngle (ring center direction or parent direction)
          const deg = neigh.length;
          if (deg === 1) {
            angles = [baseAngle + Math.PI];
          } else if (deg === 2) {
            angles = [baseAngle + 2.094, baseAngle - 2.094]; // ±120°
          } else {
            angles = [baseAngle + 2.094, baseAngle - 2.094, baseAngle + Math.PI];
          }
        }
      } else {
        const deg = neigh.length;

        if (fromRing) {
          // Ring-attached sp3: extend along outward bisector (no zigzag)
          if (deg === 1) {
            angles = [baseAngle + Math.PI];
          } else if (deg === 2) {
            angles = [baseAngle + Math.PI + 0.5, baseAngle + Math.PI - 0.5];
          } else if (deg === 3) {
            angles = [baseAngle + Math.PI, baseAngle + Math.PI + 0.8, baseAngle + Math.PI - 0.8];
          } else {
            for (let i = 0; i < neigh.length; i++) {
              angles.push(baseAngle + (Math.PI * 2 / neigh.length) * i);
            }
          }
        } else {
          // Chain sp3: use zigzag pattern with alternating sign
          if (deg === 1) {
            angles = [baseAngle + Math.PI + sign * (Math.PI / 3)];
          } else if (deg === 2) {
            angles = [baseAngle + Math.PI * 0.6, baseAngle - Math.PI * 0.6];
          } else if (deg === 3) {
            angles = [baseAngle + Math.PI * 0.55, baseAngle - Math.PI * 0.55, baseAngle + Math.PI * 0.95];
          } else {
            for (let i = 0; i < neigh.length; i++) {
              angles.push(baseAngle + (Math.PI * 2 / neigh.length) * i);
            }
          }
        }
      }

      // Place unplaced neighbors
      for (let i = 0; i < Math.min(neigh.length, angles.length); i++) {
        const nbId = neigh[i];
        if (placed.has(nbId)) continue;
        const angle = angles[i];
        const nx = pos.x + BL * Math.cos(angle);
        const ny = pos.y + BL * Math.sin(angle);
        positions.set(nbId, { x: nx, y: ny });
        placed.add(nbId);
        // Direction from child back to parent (for next chain segments)
        const backAngle = Math.atan2(pos.y - ny, pos.x - nx);
        queue.push({ id: nbId, parent: id, dirAngle: backAngle, sign: -sign });
      }
    }

    // Handle any leftover unplaced atoms
    for (const [id] of this.atoms) {
      if (!placed.has(id)) {
        const neigh = this.getNeighbors(id);
        if (neigh.length > 0 && positions.has(neigh[0])) {
          const np = positions.get(neigh[0]);
          positions.set(id, { x: np.x + BL, y: np.y });
        } else {
          positions.set(id, { x: 400, y: 300 });
        }
        placed.add(id);
      }
    }

    // Phase 3: Rotate structure so main chain is horizontal
    // Find the longest dimension (principal axis via PCA-like approach on heavy atoms)
    let sumX = 0, sumY = 0, nAtoms = 0;
    for (const [, pos] of positions) { sumX += pos.x; sumY += pos.y; nAtoms++; }
    const cx = sumX / nAtoms, cy = sumY / nAtoms;
    let sxx = 0, syy = 0, sxy = 0;
    for (const [, pos] of positions) {
      const dx = pos.x - cx, dy = pos.y - cy;
      sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
    }
    // Principal axis angle
    const angle = Math.atan2(2 * sxy, sxx - syy) / 2;
    // Rotate all positions by -angle to align principal axis horizontally
    const cosA = Math.cos(-angle), sinA = Math.sin(-angle);
    for (const [id, pos] of positions) {
      const dx = pos.x - cx, dy = pos.y - cy;
      pos.x = cx + dx * cosA - dy * sinA;
      pos.y = cy + dx * sinA + dy * cosA;
    }

    // Apply positions
    for (const [id, pos] of positions) {
      const a = this.atoms.get(id);
      if (a) { a.x = pos.x; a.y = pos.y; }
    }

    // Restore original getHybridization
    if (this._getHyb) {
      this.getHybridization = this._getHyb;
      delete this._getHyb;
    }

    return this;
  }

  // Order ring atoms into a cyclic traversal order.
  _orderRingAtoms(cycle) {
    if (cycle.length <= 2) return [...cycle];
    const set = new Set(cycle);
    const start = cycle[0];
    const ordered = [start];
    const visited = new Set([start]);
    let cur = start;
    while (ordered.length < cycle.length) {
      const nbrs = this.getNeighbors(cur).filter(nb => set.has(nb) && !visited.has(nb));
      if (nbrs.length === 0) break;
      cur = nbrs[0];
      visited.add(cur);
      ordered.push(cur);
    }
    return ordered;
  }

  // Compute 3D positions. Rings are placed as regular polygons in the XY plane.
  // Fused rings are handled by placing the first ring, then attaching subsequent rings
  // via shared-edge outward placement (same approach as normalizeStructure).
  // Non-ring atoms are placed via BFS with proper bond angles from ring anchors.
  compute3DPositions() {
    const pos3d = new Map();
    if (this.atoms.size === 0) return pos3d;

    const rings = this.findRings();

    // Phase 1: Fused ring placement (same algorithm as normalizeStructure)
    const sortedRings = [...rings].sort((a, b) => b.length - a.length);
    const remainingCycles = sortedRings.map(c => this._orderRingAtoms(c));
    const placed3d = new Set(); // atom IDs already placed in 3D
    const placedRings = []; // { cycle, center }

    if (remainingCycles.length > 0) {
      // First ring as regular polygon
      const firstCycle = remainingCycles.shift();
      const n = firstCycle.length;
      let sumBL = 0, cntBL = 0;
      for (let i = 0; i < n; i++) {
        const bl = getBondLength(this, firstCycle[i], firstCycle[(i + 1) % n]);
        if (bl > 0) { sumBL += bl; cntBL++; }
      }
      const RING_BL = cntBL > 0 ? sumBL / cntBL : 1.38;
      const R = RING_BL / (2 * Math.sin(Math.PI / n));
      for (let i = 0; i < n; i++) {
        const a = (2 * Math.PI / n) * i - Math.PI / 2;
        pos3d.set(firstCycle[i], new THREE.Vector3(R * Math.cos(a), R * Math.sin(a), 0));
        placed3d.add(firstCycle[i]);
      }
      placedRings.push({ cycle: firstCycle, center: new THREE.Vector3(0, 0, 0) });

      // Attach remaining rings via shared edges
      let progress = true;
      while (remainingCycles.length > 0 && progress) {
        progress = false;
        for (let idx = 0; idx < remainingCycles.length; idx++) {
          const cycle = remainingCycles[idx];
          const sharedIndices = [];
          for (let i = 0; i < cycle.length; i++) {
            if (placed3d.has(cycle[i])) sharedIndices.push(i);
          }
          if (sharedIndices.length >= 2) {
            let pair = null;
            const clen = cycle.length;
            for (let i = 0; i < sharedIndices.length; i++) {
              for (let j = i + 1; j < sharedIndices.length; j++) {
                const a = sharedIndices[i], b = sharedIndices[j];
                if (Math.abs(a - b) === 1 || Math.abs(a - b) === clen - 1) {
                  pair = [a, b]; break;
                }
              }
              if (pair) break;
            }
            if (!pair) { progress = true; remainingCycles.splice(idx, 1); break; }

            const id1 = cycle[pair[0]], id2 = cycle[pair[1]];
            const p1 = pos3d.get(id1), p2 = pos3d.get(id2);
            if (!p1 || !p2) continue;

            let ordered = [...cycle];
            while (!(ordered[0] === id1 && ordered[1] === id2) &&
                   !(ordered[0] === id2 && ordered[1] === id1)) {
              ordered.push(ordered.shift());
            }
            if (ordered[0] !== id1) {
              ordered.reverse();
              while (ordered[0] !== id1) ordered.push(ordered.shift());
            }

            let parentRing = placedRings.find(pr =>
              pr.cycle.includes(id1) && pr.cycle.includes(id2));
            if (!parentRing) parentRing = placedRings[0];

            const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
            let ox = mx - parentRing.center.x, oy = my - parentRing.center.y;
            let len = Math.hypot(ox, oy);
            if (len < 0.1) { ox = 1; oy = 0; len = 1; }
            ox /= len; oy /= len;

            const h = (RING_BL / 2) / Math.tan(Math.PI / clen);
            const ncx = mx + ox * h, ncy = my + oy * h;
            const ringRadius = RING_BL / (2 * Math.sin(Math.PI / clen));

            const a1 = Math.atan2(p1.y - ncy, p1.x - ncx);
            const a2 = Math.atan2(p2.y - ncy, p2.x - ncx);
            let diff = a2 - a1;
            while (diff < -Math.PI) diff += Math.PI * 2;
            while (diff > Math.PI) diff -= Math.PI * 2;
            const dirSign = diff > 0 ? 1 : -1;
            const exactStep = dirSign * (Math.PI * 2) / clen;

            for (let i = 2; i < clen; i++) {
              const id = ordered[i];
              if (!placed3d.has(id)) {
                const angle = a1 + i * exactStep;
                pos3d.set(id, new THREE.Vector3(ncx + ringRadius * Math.cos(angle), ncy + ringRadius * Math.sin(angle), 0));
                placed3d.add(id);
              }
            }
            placedRings.push({ cycle, center: new THREE.Vector3(ncx, ncy, 0) });
            remainingCycles.splice(idx, 1);
            progress = true;
            break;
          }
        }

        // Fallback for isolated rings
        if (!progress && remainingCycles.length > 0) {
          const isoCycle = remainingCycles.shift();
          const n = isoCycle.length;
          let sumBL2 = 0, cntBL2 = 0;
          for (let i = 0; i < n; i++) {
            const bl = getBondLength(this, isoCycle[i], isoCycle[(i + 1) % n]);
            if (bl > 0) { sumBL2 += bl; cntBL2++; }
          }
          const RING_BL2 = cntBL2 > 0 ? sumBL2 / cntBL2 : 1.38;
          const R2 = RING_BL2 / (2 * Math.sin(Math.PI / n));
          const cx = placedRings.length * 3.5;
          for (let i = 0; i < n; i++) {
            const a = (2 * Math.PI / n) * i - Math.PI / 2;
            pos3d.set(isoCycle[i], new THREE.Vector3(cx + R2 * Math.cos(a), R2 * Math.sin(a), 0));
            placed3d.add(isoCycle[i]);
          }
          placedRings.push({ cycle: isoCycle, center: new THREE.Vector3(cx, 0, 0) });
          progress = true;
        }
      }
    }

    // Phase 2: BFS outward from placed atoms to place non-ring substituents
    const queue = [];
    if (placed3d.size > 0) {
      for (const id of placed3d) {
        const pp = pos3d.get(id);
        if (pp) queue.push({ id, pp, hyb: this.getHybridization(id) });
      }
    } else {
      const rootId = [...this.atoms.keys()][0];
      pos3d.set(rootId, new THREE.Vector3(0, 0, 0));
      placed3d.add(rootId);
      queue.push({ id: rootId, pp: pos3d.get(rootId), hyb: this.getHybridization(rootId) });
    }

    const visited = new Set();

    while (queue.length > 0) {
      const { id, pp, hyb } = queue.shift();
      if (visited.has(id)) continue;
      visited.add(id);

      const allNbrs = this.getNeighbors(id);
      const unplaced = allNbrs.filter(nb => !placed3d.has(nb));
      if (unplaced.length === 0) continue;

      const placedDirs = [];
      for (const nb of allNbrs) {
        if (pos3d.has(nb)) {
          placedDirs.push(new THREE.Vector3().subVectors(pos3d.get(nb), pp).normalize());
        }
      }

      // Generate extra candidates for openness scoring.
      // For sp3 with 1 placed: 3 tet slots. For sp2 with 2 placed: 1 remaining.
      const maxCands = hyb === 'sp3' ? Math.min(Math.max(unplaced.length, (3 - placedDirs.length) || 4), 4)
        : hyb === 'sp2' ? Math.min(Math.max(unplaced.length, (2 - placedDirs.length) || 3), 3)
        : Math.max(unplaced.length, 1);
      const allCands = computeBondDirections(id, hyb, placedDirs, maxCands);

      // Score candidates by openness: prefer positions far from existing atoms (excl. parent).
      // This avoids unrelated branches overlapping in space-fill model.
      let candScored = [];
      if (pos3d.size > 1) {
        const approxBL = getBondLength(this, id, unplaced[0]);
        candScored = allCands.map(dir => {
          const testPos = new THREE.Vector3().copy(pp).addScaledVector(dir, approxBL);
          let minD = Infinity;
          for (const [, ep] of pos3d) {
            const d = testPos.distanceTo(ep);
            if (d < minD) minD = d;
          }
          return { dir, openness: minD };
        });
        candScored.sort((a, b) => b.openness - a.openness);
      }

      const newDirs = candScored.length >= unplaced.length
        ? candScored.slice(0, unplaced.length).map(x => x.dir)
        : computeBondDirections(id, hyb, placedDirs, unplaced.length);

      for (let i = 0; i < unplaced.length && i < newDirs.length; i++) {
        const nbId = unplaced[i];
        const bl = getBondLength(this, id, nbId);
        pos3d.set(nbId, new THREE.Vector3().copy(pp).addScaledVector(newDirs[i], bl));
        placed3d.add(nbId);
        queue.push({ id: nbId, pp: pos3d.get(nbId), hyb: this.getHybridization(nbId) });
      }

      // Overflow: random directions
      for (let i = newDirs.length; i < unplaced.length; i++) {
        let best = null, bestS = Infinity;
        for (let t = 0; t < 20; t++) {
          const rd = new THREE.Vector3(Math.random() - .5, Math.random() - .5, Math.random() - .5).normalize();
          const s = placedDirs.reduce((a, pd) => a + Math.max(0, rd.dot(pd)), 0);
          if (s < bestS) { bestS = s; best = rd; }
        }
        if (best) {
          pos3d.set(unplaced[i], pp.clone().addScaledVector(best, 1.5));
          placed3d.add(unplaced[i]);
          queue.push({ id: unplaced[i], pp: pos3d.get(unplaced[i]), hyb: this.getHybridization(unplaced[i]) });
        }
      }
    }

    // Catch stragglers
    for (const [id] of this.atoms) {
      if (pos3d.has(id)) continue;
      const nbrs = this.getNeighbors(id);
      for (const nb of nbrs) {
        if (pos3d.has(nb)) {
          const np = pos3d.get(nb);
          pos3d.set(id, new THREE.Vector3(np.x + 1.5, np.y, np.z));
          break;
        }
      }
      if (!pos3d.has(id)) pos3d.set(id, new THREE.Vector3(0, 0, 0));
    }

    // Center
    let sx = 0, sy = 0, sz = 0;
    for (const [, p] of pos3d) { sx += p.x; sy += p.y; sz += p.z; }
    const N = Math.max(pos3d.size, 1);
    const cc = new THREE.Vector3(sx / N, sy / N, sz / N);
    for (const [, p] of pos3d) p.sub(cc);

    // Tag with element and hybridization
    for (const [id] of this.atoms) {
      const p = pos3d.get(id);
      if (p) { p.el = this.atoms.get(id)?.el || 'C'; p.hyb = this.getHybridization(id); }
    }
    return pos3d;
  }

  isEmpty() {
    return this.atoms.size === 0;
  }

  /**
   * Export molecule as V2000 MolBlock string.
   * Uses atom (x, y) coords if available, otherwise sets them to 0.
   * RDKit generates its own layout from the connection table so coordinates
   * are mainly placeholders.
   */
  toMolBlock() {
    const atomList = [...this.atoms.values()];
    const nAtoms = atomList.length;
    const nBonds = this.bonds.length;
    if (nAtoms === 0) return '';

    // Find coordinate bounds to normalize to ~10 range
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const a of atomList) {
      if (a.x < minX) minX = a.x;
      if (a.x > maxX) maxX = a.x;
      if (a.y < minY) minY = a.y;
      if (a.y > maxY) maxY = a.y;
    }
    const rangeX = Math.max(maxX - minX, 1);
    const rangeY = Math.max(maxY - minY, 1);
    const scale = 10 / Math.max(rangeX, rangeY);
    const offX = minX, offY = minY;

    const lines = [];
    lines.push(' RDKit MolBlock\n');
    lines.push('  Generated by OrChem\n');
    lines.push('\n');
    lines.push(
      `${String(nAtoms).padStart(3)}${String(nBonds).padStart(3)}  0  0  0  0  0  0  0  0999 V2000\n`
    );

    // Atom block
    const elIdx = {};
    for (let i = 0; i < nAtoms; i++) {
      const a = atomList[i];
      elIdx[a.id] = i + 1; // 1-indexed
      const x = a.x !== undefined ? (a.x - offX) * scale : 0;
      const y = a.y !== undefined ? (a.y - offY) * scale : 0;
      const zs = '    0.0000'; // 10 chars, no decimal ambiguity
      lines.push(
        `${x.toFixed(4).padStart(10)}${y.toFixed(4).padStart(10)}${zs}${a.el.padStart(3)} 0  0  0  0  0  0  0  0  0\n`
      );
    }

    // Bond block
    for (const b of this.bonds) {
      const i = elIdx[b.a], j = elIdx[b.b];
      if (!i || !j) continue;
      const bt = b.type === 'double' ? 2 : b.type === 'triple' ? 3 : 1;
      lines.push(`  ${String(i).padStart(3)}${String(j).padStart(3)}  ${bt}  0  0  0  0\n`);
    }

    lines.push('M  END\n');
    return lines.join('');
  }

  // ==================== SMILES ====================

  /** Expand FGs into explicit atoms on a COPY. Returns the expanded molecule. */
  _expandFG() {
    const m = this.clone();
    const toAdd = []; // {parentId, type, el, bondType}
    for (const [id, a] of m.atoms) {
      for (const fg of a.fgs) {
        const contrib = FG_CONTRIB[fg];
        if (!contrib) continue;
        if (m._fgAlreadyReal(id, fg)) continue;
        if (fg === 'CO') {
          toAdd.push({ parentId: id, type: 'CO', el: 'O', bondType: 'double' });
        } else if (fg === 'OH') {
          toAdd.push({ parentId: id, type: 'OH', el: 'O', bondType: 'single' });
        } else if (fg === 'COOH') {
          toAdd.push({ parentId: id, type: 'CO', el: 'O', bondType: 'double' });
          toAdd.push({ parentId: id, type: 'OH', el: 'O', bondType: 'single' });
        } else if (fg === 'NH2') {
          toAdd.push({ parentId: id, type: 'NH2', el: 'N', bondType: 'single' });
        } else if (fg === 'CN') {
          toAdd.push({ parentId: id, type: 'CN', el: 'N', bondType: 'triple' });
        } else if (fg === 'NO2') {
          const nId = m.addAtom(0, 0, 'N').id;
          m.addBond(id, nId, 'single');
          toAdd.push({ parentId: nId, type: 'NO2', el: 'O', bondType: 'double' });
          toAdd.push({ parentId: nId, type: 'NO2', el: 'O', bondType: 'double' });
        } else if (fg === 'CHO') {
          toAdd.push({ parentId: id, type: 'CO', el: 'O', bondType: 'double' });
        } else if (fg === 'Ph') {
          // Check if ring atoms already exist (added by addFG) or need creation (legacy data)
          const nbrs = m.getNeighbors(id);
          let hasRing = false;
          for (const nb of nbrs) {
            const na = m.atoms.get(nb);
            if (na && na.el === 'C') {
              // Check if this C is part of a 6-cycle
              const rings = m.findRings();
              if (rings.some(r => r.length === 6 && r.includes(nb))) {
                hasRing = true; break;
              }
            }
          }
          if (!hasRing) {
            // Legacy data: create the ring atoms
            const ring = [];
            for (let i = 0; i < 6; i++) ring.push(m.addAtom(0, 0, 'C').id);
            for (let i = 0; i < 6; i++) m.addBond(ring[i], ring[(i + 1) % 6], i % 2 === 0 ? 'double' : 'single');
            m.addBond(id, ring[0], 'single');
          }
        }
      }
      // Clear fgs after expansion (avoid double-expansion)
      a.fgs = [];
    }
    for (const t of toAdd) {
      const newA = m.addAtom(0, 0, t.el);
      m.addBond(t.parentId, newA.id, t.bondType);
    }
    return m;
  }

  /**
   * Export molecule as SMILES string.
   * Uses a spanning-tree approach for reliable fused-ring handling.
   * FGs are expanded to explicit atoms before generating SMILES.
   */
  toSmiles() {
    const mol = this._expandFG();
    if (mol.atoms.size === 0) return '';

    const heavyAtoms = [...mol.atoms.entries()].filter(([, a]) => a.el !== 'H');
    if (heavyAtoms.length === 0) return '';
    const heavyIds = heavyAtoms.map(([id]) => id);
    const heavySet = new Set(heavyIds);

    // Step 1: Find all rings, pick one closure edge per ring.
    // A closure edge is the edge (a,b) of the ring whose sorted pair sorts
    // lexicographically last — this keeps the spanning tree contiguous.
    const rings = (mol.findRings ? mol.findRings() : []);
    const closureEdgeSet = new Set(); // "min,max" strings
    for (const r of rings) {
      const clen = r.length;
      // pick edge that is "farthest" in the atom-ID sense
      let bestKey = '', bestVal = -1;
      for (let i = 0; i < clen; i++) {
        const a = r[i], b = r[(i + 1) % clen];
        const mn = Math.min(a, b), mx = Math.max(a, b);
        const val = mx - mn; // prefer edge with larger gap (will be "far" in DFS order)
        const key = mn + ',' + mx;
        if (val > bestVal) { bestVal = val; bestKey = key; }
      }
      if (bestKey) closureEdgeSet.add(bestKey);
    }

    // Step 2: Build a spanning tree (DFS) using only non-closure edges.
    // At the same time, collect ring-closure info: for each closure edge,
    // note the two atom IDs and the bond type.
    const treeAdj = new Map(); // atomId -> [neighborId]
    for (const id of heavyIds) treeAdj.set(id, []);
    const ringClosures = []; // {a, b, bondType, key}

    const visitedTree = new Set();
    function buildTree(atomId, parentId) {
      if (visitedTree.has(atomId)) return;
      visitedTree.add(atomId);
      for (const nb of mol.getNeighbors(atomId)) {
        if (nb === parentId) continue;
        const na = mol.atoms.get(nb);
        if (!na || na.el === 'H') continue;
        if (!heavySet.has(nb)) continue;
        const mn = Math.min(atomId, nb), mx = Math.max(atomId, nb);
        const key = mn + ',' + mx;
        if (closureEdgeSet.has(key)) continue; // skip closure edges — handled separately
        if (!visitedTree.has(nb)) {
          treeAdj.get(atomId).push(nb);
          treeAdj.get(nb).push(atomId);
          buildTree(nb, atomId);
        }
      }
    }

    // Build tree
    let treeRoot = heavyIds[0];
    for (const id of heavyIds) {
      const a = mol.atoms.get(id);
      if (a && a.el === 'C') { treeRoot = id; break; }
    }
    buildTree(treeRoot, null);
    for (const id of heavyIds) {
      if (!visitedTree.has(id)) buildTree(id, null);
    }

    // Now add ring closures (edges NOT in the spanning tree)
    for (const key of closureEdgeSet) {
      const [mn, mx] = key.split(',').map(Number);
      const bt = mol.getBondType(mn, mx) || 'single';
      ringClosures.push({ a: mn, b: mx, bondType: bt, key });
    }

    // Step 3: Assign ring closure numbers.
    // A closure edge will output its number when visiting the first atom,
    // and output it again (close) when visiting the second atom.
    const ringNumMap = new Map(); // key -> ring num string
    let nextRingNum = 1;
    for (const rc of ringClosures) {
      if (!ringNumMap.has(rc.key)) {
        ringNumMap.set(rc.key, nextRingNum < 10 ? String(nextRingNum) : '%' + nextRingNum);
        nextRingNum++;
      }
    }

    // Step 4: DFS on the spanning tree, outputting SMILES.
    const bareEls = ['C', 'O', 'N', 'S', 'P', 'F', 'I', 'B'];
    const result = [];
    const visited = new Set();

    function dfsSMILES(atomId, parentId) {
      if (visited.has(atomId)) return;
      visited.add(atomId);
      const a = mol.atoms.get(atomId);
      if (!a) return;

      // Atom label
      if (bareEls.includes(a.el)) result.push(a.el);
      else result.push('[' + a.el + ']');

      // Open ring closures whose other atom hasn't been visited yet
      const opens = [], closes = [];
      for (const rc of ringClosures) {
        if (rc.a === atomId || rc.b === atomId) {
          const other = rc.a === atomId ? rc.b : rc.a;
          const rn = ringNumMap.get(rc.key);
          if (!rn) continue;
          if (!visited.has(other)) opens.push({ other, rn, bt: rc.bondType });
          else closes.push({ other, rn, bt: rc.bondType });
        }
      }

      for (const op of opens) {
        if (op.bt === 'double') result.push('=');
        else if (op.bt === 'triple') result.push('#');
        result.push(op.rn);
      }

      // Tree children (spanning tree adjacency minus parent)
      const children = (treeAdj.get(atomId) || []).filter(nb => nb !== parentId);

      // Sort children: by bond type (multiple bonds first), then by atom ID
      children.sort((a, b) => {
        const oa = mol.getBondType(atomId, a), ob = mol.getBondType(atomId, b);
        const order = (bt) => bt === 'triple' ? 3 : bt === 'double' ? 2 : 1;
        const d = order(ob) - order(oa);
        if (d !== 0) return d;
        return a - b;
      });

      // All children except last → branches (parentheses)
      for (let i = 0; i < children.length - 1; i++) {
        const nb = children[i];
        const bt = mol.getBondType(atomId, nb);
        result.push('(');
        if (bt === 'double') result.push('=');
        else if (bt === 'triple') result.push('#');
        dfsSMILES(nb, atomId);
        result.push(')');
      }

      // Last child → main chain
      if (children.length > 0) {
        const nb = children[children.length - 1];
        const bt = mol.getBondType(atomId, nb);
        if (bt === 'double') result.push('=');
        else if (bt === 'triple') result.push('#');
        dfsSMILES(nb, atomId);
      }

      // Close ring closures whose other atom was already visited
      for (const cl of closes) {
        if (cl.bt === 'double') result.push('=');
        else if (cl.bt === 'triple') result.push('#');
        result.push(cl.rn);
      }
    }

    // Launch DFS for each disconnected fragment
    let firstFragment = true;
    for (const id of heavyIds) {
      if (visited.has(id)) continue;
      if (!firstFragment) result.push('.');
      firstFragment = false;
      dfsSMILES(id, null);
    }

    return result.join('');
  }

  /**
   * Create a Molecule from a SMILES string.
   * Simple recursive-descent parser. Handles basic organic SMILES.
   */
  static fromSmiles(smiles) {
    const mol = new Molecule();
    if (!smiles || smiles.length === 0) return mol;

    const atoms = []; // atoms created so far (in order): {id, el, ringNums:Map}
    const ringOpeners = {}; // ringNum -> {atomIdx, bondType}
    let pos = 0;

    function peek() { return pos < smiles.length ? smiles[pos] : ''; }
    function consume() { return smiles[pos++]; }
    function isAtomStart(c) {
      return c === '[' || /[A-Za-z]/.test(c) || c === 'c' || c === 'n' || c === 'o' || c === 's' || c === 'p';
    }

    function readAtom() {
      if (peek() === '[') {
        consume(); // skip [
        let el = '';
        while (pos < smiles.length && /[A-Za-z]/.test(peek())) el += consume();
        // Skip until ]
        while (pos < smiles.length && peek() !== ']') consume();
        if (peek() === ']') consume();
        if (!el) el = 'C';
        return { el, aromatic: false };
      }
      
      // Organic subset atoms
      const c = consume();
      if (c === 'C') {
        const next = peek();
        if (next === 'l') { consume(); return { el: 'Cl', aromatic: false }; }
        return { el: 'C', aromatic: false };
      }
      if (c === 'B') {
        const next = peek();
        if (next === 'r') { consume(); return { el: 'Br', aromatic: false }; }
        return { el: 'B', aromatic: false };
      }
      if (c === 'N') return { el: 'N', aromatic: false };
      if (c === 'O') return { el: 'O', aromatic: false };
      if (c === 'S') return { el: 'S', aromatic: false };
      if (c === 'P') return { el: 'P', aromatic: false };
      if (c === 'F') return { el: 'F', aromatic: false };
      if (c === 'I') return { el: 'I', aromatic: false };
      if (c === 'c') return { el: 'C', aromatic: true };
      if (c === 'n') return { el: 'N', aromatic: true };
      if (c === 'o') return { el: 'O', aromatic: true };
      if (c === 's') return { el: 'S', aromatic: true };
      return { el: 'C', aromatic: false };
    }

    function readBond() {
      const c = peek();
      if (c === '=') { consume(); return 'double'; }
      if (c === '#') { consume(); return 'triple'; }
      if (c === '/') { consume(); return 'single'; }
      if (c === '\\') { consume(); return 'single'; }
      return 'single';
    }

    function parse(prevIdx, initialBond) {
      while (pos < smiles.length) {
        const c = peek();
        if (c === ')' || c === ']' || c === '') return;

        // Read bond between previous atom and next
        let bondType = initialBond || 'single';
        initialBond = null; // consumed — only affects first atom in branch
        if (c === '=' || c === '#' || c === '/' || c === '\\') {
          bondType = readBond();
        }

        // Re-peek the current character after an optional bond symbol has been consumed
        const current = peek();

        // Branch start
        if (current === '(') {
          consume();
          parse(prevIdx, bondType); // pass bond type before '(' into branch
          if (peek() === ')') consume(); // consume matching closing parenthesis
          continue;
        }

        // Ring closure digit
        if (/\d/.test(current) || current === '%') {
          let rn;
          if (current === '%') {
            consume();
            rn = parseInt(consume() + consume(), 10);
          } else {
            rn = parseInt(consume(), 10);
          }

          if (ringOpeners[rn]) {
            // Close ring
            const opener = ringOpeners[rn];
            mol.addBond(atoms[opener.atomIdx].id, atoms[prevIdx].id, bondType);
            delete ringOpeners[rn];
          } else {
            // Open ring from previous atom
            ringOpeners[rn] = { atomIdx: prevIdx, bondType };
          }
          continue;
        }

        // Read atom
        if (!isAtomStart(current)) {
          // End of chain
          return;
        }

        const info = readAtom();
        const a = mol.addAtom(0, 0, info.el);
        a.aromatic = info.aromatic || false;
        atoms.push({ id: a.id, el: info.el });

        if (prevIdx >= 0) {
          mol.addBond(atoms[prevIdx].id, a.id, bondType);
        }

        parse(atoms.length - 1);
      }
    }

    parse(-1);

    // Normalize the structure
    mol.normalizeStructure();
    return mol;
  }
}

// --- Bond lengths & geometry helpers ---

function getBondLength(mol, idA, idB) {
  const elA = mol.atoms.get(idA)?.el || 'C';
  const elB = mol.atoms.get(idB)?.el || 'C';
  const bt = mol.getBondType(idA, idB) || 'single';
  const SC = 0.974;

  if (elA === 'C' && elB === 'C') {
    if (bt === 'triple') return 1.20 * SC;
    if (bt === 'double') return 1.34 * SC;
    return 1.54 * SC;
  }
  if ((elA === 'C' && elB === 'O') || (elA === 'O' && elB === 'C')) {
    if (bt === 'double') return 1.20 * SC;
    return 1.43 * SC;
  }
  if ((elA === 'C' && elB === 'N') || (elA === 'N' && elB === 'C')) {
    if (bt === 'triple') return 1.16 * SC;
    if (bt === 'double') return 1.28 * SC;
    return 1.47 * SC;
  }
  const rA = COV_RADII[elA] || 0.68;
  const rB = COV_RADII[elB] || 0.68;
  return (rA + rB) * 1.05;
}

function computeBondDirections(atomId, hyb, placedDirs, need) {
  if (need <= 0) return [];
  if (hyb === 'sp') {
    if (placedDirs.length === 0) {
      if (need === 1) return [new THREE.Vector3(0, 0, 1)];
      return [new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)];
    }
    if (placedDirs.length === 1) return [placedDirs[0].clone().multiplyScalar(-1)];
    return [];
  }
  if (hyb === 'sp2') {
    if (placedDirs.length === 0) {
      const dirs = [];
      for (let i = 0; i < Math.max(need, 2); i++) {
        const a = (2 * Math.PI / 3) * i;
        dirs.push(new THREE.Vector3(Math.cos(a), Math.sin(a), 0));
      }
      return dirs.slice(0, need);
    }
    const d0 = placedDirs[0];
    let normal;
    if (placedDirs.length >= 2) {
      normal = new THREE.Vector3().crossVectors(d0, placedDirs[1]).normalize();
    } else {
      normal = new THREE.Vector3(-d0.z, 0, d0.x).normalize();
      if (normal.length() < 0.1) normal = new THREE.Vector3(0, 1, 0);
    }
    if (normal.length() < 0.01) normal = new THREE.Vector3(0, 0, 1);
    const dirs = [];
    for (let i = 0; i < 3; i++) {
      const a = (2 * Math.PI / 3) * i;
      dirs.push(new THREE.Vector3().copy(d0).applyAxisAngle(normal, a));
    }
    return pickUnused(dirs, placedDirs, need);
  }
  // sp3
  if (placedDirs.length === 0) {
    if (need === 1) return [new THREE.Vector3(0, 0, 1)];
    const T = [
      new THREE.Vector3( 1,  1,  1).normalize(),
      new THREE.Vector3(-1, -1,  1).normalize(),
      new THREE.Vector3(-1,  1, -1).normalize(),
      new THREE.Vector3( 1, -1, -1).normalize(),
    ];
    return T.slice(0, need);
  }
  const d0 = placedDirs[0].clone();
  let perp = new THREE.Vector3(-d0.z, 0, d0.x).normalize();
  if (perp.length() < 0.1) perp = new THREE.Vector3(0, 1, 0);
  const cosA = -1/3, sinA = Math.sqrt(1 - cosA*cosA);
  const tetO = [];
  for (let i = 0; i < 3; i++) {
    const phi = (2*Math.PI/3)*i;
    const v = d0.clone().multiplyScalar(cosA)
      .add(perp.clone().multiplyScalar(sinA*Math.cos(phi)))
      .add(new THREE.Vector3().crossVectors(d0, perp).normalize().multiplyScalar(sinA*Math.sin(phi)));
    tetO.push(v.normalize());
  }
  return pickUnused([d0, ...tetO], placedDirs, need);
}

function pickUnused(candidates, placed, need) {
  const s = candidates.map(d => ({ d, score: placed.reduce((s, pd) => s + (1 - d.dot(pd)), 0) }));
  s.sort((a, b) => b.score - a.score);
  return s.slice(0, need).map(x => x.d);
}
