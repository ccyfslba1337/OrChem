// ==================== APP CONTROLLER ====================
class App {
  constructor() {
    this.mol = new Molecule();
    this.renderer2D = null;
    this.renderer3D = null;
    this.engine = new SynthesisEngine();

    // Undo/redo history
    this.history = [];
    this.historyIndex = -1;

    // Tool state
    this.currentTool = 'C';
    this.viewMode = '3d-ball'; // '3d-ball' | '3d-space' | '2d'
    this.selId = null;
    this.hoverId = null;
    this.isDragging = false;
    this.dragAtomId = null;
    this.panStartX = 0;
    this.panStartY = 0;
    this.isPanning = false;
    this.eraseMode = false;

    // Settings
    this.highQuality = true;
    this.showH = true;
    this.showLabels = false;

    this.init();
  }

  // ---- Init ----
  init() {
    const editCanvas = document.getElementById('editCanvas');
    this.renderer2D = new Renderer2D(editCanvas, this.mol);
    this.renderer2D._onAnimFrame = () => this.render2D(); // smooth zoom/pan

    const view3D = document.getElementById('view3D');
    this.renderer3D = new Renderer3D(view3D);

    this.saveState();
    this.setup2DEvents();
    this.setupViewToggle();
    this.setupSettings();
    this.setupToolEvents();
    this.setupButtonEvents();
    this.setupTemplateEvents();
    this.setupResize();

    this.setViewMode('3d-ball');
    this.render();
    this.updateInfoPanel();
  }

  // ---- View Mode ----
  setViewMode(mode) {
    this.viewMode = mode;
    const v3 = document.getElementById('view3D');
    const v2 = document.getElementById('view2D');
    const area = document.getElementById('canvasArea');
    const hint = document.getElementById('canvasHint');
    const toggleBtns = document.querySelectorAll('.view-toggle button');
    toggleBtns.forEach(b => b.classList.toggle('active', b.dataset.view === mode));

    if (mode === '2d') {
      v3.classList.remove('active'); v2.classList.add('active');
      area.classList.add('light-bg');
      hint.style.display = 'block'; hint.style.color = '#c0c5cc';
      hint.querySelectorAll('kbd').forEach(k => {
        k.style.background = '#e8eaed'; k.style.color = '#5f6368';
      });
      this.renderer2D.resize();
      this.render2D();
    } else {
      v3.classList.add('active'); v2.classList.remove('active');
      area.classList.remove('light-bg');
      hint.style.display = 'none';
      this.render3D();
    }
  }

  setupViewToggle() {
    document.querySelectorAll('.view-toggle button').forEach(btn => {
      btn.addEventListener('click', () => this.setViewMode(btn.dataset.view));
    });
  }

  // ---- Settings ----
  setupSettings() {
    document.getElementById('settingsBtn').addEventListener('click', () => {
      document.getElementById('settingsPanel').classList.toggle('show');
    });
    document.addEventListener('click', e => {
      const p = document.getElementById('settingsPanel');
      if (!p.contains(e.target) && e.target !== document.getElementById('settingsBtn')) {
        p.classList.remove('show');
      }
    });
    document.querySelectorAll('input[name="quality"]').forEach(r => {
      r.addEventListener('change', () => {
        this.highQuality = r.value === 'high';
        this.render3D();
      });
    });
    document.getElementById('showHydrogens').addEventListener('change', e => {
      this.showH = e.target.checked; this.render3D();
    });
    document.getElementById('showLabels').addEventListener('change', e => {
      this.showLabels = e.target.checked; this.render3D();
    });
  }

  // ---- 2D Editor Events ----
  setup2DEvents() {
    const canvas = document.getElementById('editCanvas');
    const gp = e => {
      const r = canvas.getBoundingClientRect();
      return {
        sx: e.clientX - r.left,
        sy: e.clientY - r.top,
        mx: this.renderer2D.ix(e.clientX - r.left),
        my: this.renderer2D.iy(e.clientY - r.top),
      };
    };

    // Bond click-to-connect state (no drag)
    this.bondFromId = null;

    canvas.addEventListener('mousedown', e => {
      if (this.viewMode !== '2d') return;
      if (e.button === 1 || (e.button === 0 && e.altKey)) {
        this.isPanning = true; this.panStartX = e.clientX; this.panStartY = e.clientY; return;
      }
      const pos = gp(e);

      // FG hit → select FG (click FG atom/sub-atom)
      const fgHit = this.renderer2D.hitTestFG(pos.sx, pos.sy);
      if (fgHit) {
        this.renderer2D.selFgAtomId = fgHit.atomId;
        this.renderer2D.selFgIndex = fgHit.fgIndex;
        this.selId = fgHit.atomId;
        this.bondFromId = null;
        this.render2D(this.selId, this.hoverId);
        return;
      }
      this.renderer2D.selFgAtomId = null;
      this.renderer2D.selFgIndex = null;

      // FG tool + stub hit → place FG
      if (this.currentTool.startsWith('fg-')) {
        const stubId = this.renderer2D.hitTestStub(pos.sx, pos.sy);
        if (stubId !== null) {
          this.addFG(stubId, this.currentTool.replace('fg-', ''));
          this.bondFromId = null; return;
        }
      }

      const hit = this.hitTest2D(pos.sx, pos.sy);

      // Erase
      if (this.eraseMode && hit !== null) {
        this.mol.removeAtom(hit);
        this.selId = null; this.hoverId = null; this.bondFromId = null;
        this.saveState(); this.renderAll(); this.updateInfoPanel();
        return;
      }

      if (hit !== null) {
        // --- Atom clicked ---
        if (this.currentTool.startsWith('fg-')) {
          this.addFG(hit, this.currentTool.replace('fg-', ''));
          this.bondFromId = null;
        } else if (this.currentTool.startsWith('bond-')) {
          // Click-to-connect: first click = source, second = target
          if (this.bondFromId === null) {
            this.bondFromId = hit; this.selId = hit;
          } else if (this.bondFromId === hit) {
            this.bondFromId = null; this.selId = null;
          } else {
            this.mol.addBond(this.bondFromId, hit, this.currentTool.replace('bond-', ''));
            this.bondFromId = null; this.selId = null;
            this.saveState(); this.updateInfoPanel();
          }
        } else {
          // Element tool: select + enable drag-to-move
          this.bondFromId = null;
          this.selId = hit; this.isDragging = true; this.dragAtomId = hit;
        }
      } else {
        // --- Empty canvas ---
        this.bondFromId = null;
        if (this.currentTool === 'erase') return;
        if (this.currentTool.startsWith('fg-')) {
          this.placeFreeFG(pos.mx, pos.my, this.currentTool.replace('fg-', ''));
          return;
        }
        if (this.currentTool.startsWith('bond-')) return;
        const a = this.mol.addAtom(pos.mx, pos.my, this.currentTool);
        this.selId = a.id;
        this.saveState(); this.renderAll(); this.updateInfoPanel();
      }
    });

    canvas.addEventListener('mousemove', e => {
      if (this.viewMode !== '2d') return;
      if (this.isPanning) {
        const dx = e.clientX - this.panStartX;
        const dy = e.clientY - this.panStartY;
        this.renderer2D.setTarget(this.renderer2D.targetScale,
          this.renderer2D.targetOx + dx, this.renderer2D.targetOy + dy);
        this.panStartX = e.clientX; this.panStartY = e.clientY;
        this.render2D(); return;
      }
      const pos = gp(e);
      if (this.isDragging && this.dragAtomId !== null) {
        const a = this.mol.atoms.get(this.dragAtomId);
        if (a) { a.x = pos.mx; a.y = pos.my; }
        this.render2D(this.selId, this.dragAtomId);
        return;
      }
      const hit = this.hitTest2D(pos.sx, pos.sy);
      if (hit !== this.hoverId) {
        this.hoverId = hit;
        this.render2D(this.selId, this.hoverId);
      }
    });

    canvas.addEventListener('mouseup', e => {
      if (this.viewMode !== '2d') return;
      if (this.isPanning) { this.isPanning = false; return; }
      if (this.isDragging && this.dragAtomId !== null) {
        this.saveState(); this.updateInfoPanel();
      }
      this.isDragging = false; this.dragAtomId = null;
      this.render2D(this.selId, this.hoverId);
    });

    canvas.addEventListener('dblclick', e => {
      if (this.viewMode !== '2d') return;
      const pos = gp(e);
      const hit = this.hitTest2D(pos.sx, pos.sy);
      if (hit !== null) {
        this.mol.removeAtom(hit);
        this.selId = null; this.hoverId = null;
        this.saveState(); this.renderAll(); this.updateInfoPanel();
      }
    });

    canvas.addEventListener('wheel', e => {
      if (this.viewMode !== '2d') return;
      e.preventDefault();
      const d = e.deltaY > 0 ? 0.9 : 1.1;
      const ns = this.renderer2D.targetScale * d;
      if (ns < 0.15 || ns > 6) return;
      const r = canvas.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      this.renderer2D.setTarget(ns,
        mx - (mx - this.renderer2D.targetOx) * d,
        my - (my - this.renderer2D.targetOy) * d);
      this.render2D();
    });

    document.addEventListener('keydown', e => {
      if (this.viewMode !== '2d') return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        // FG selected → remove that FG
        if (this.renderer2D.selFgAtomId !== null && this.renderer2D.selFgIndex !== null) {
          const a = this.mol.atoms.get(this.renderer2D.selFgAtomId);
          if (a && a.fgs[this.renderer2D.selFgIndex] !== undefined) {
            a.fgs.splice(this.renderer2D.selFgIndex, 1);
            this.renderer2D.selFgAtomId = null;
            this.renderer2D.selFgIndex = null;
            this.saveState(); this.renderAll(); this.updateInfoPanel();
            return;
          }
        }
        if (this.selId !== null) {
          const a = this.mol.atoms.get(this.selId);
          if (a && a.fgs.length > 0) {
            a.fgs.pop();
          } else {
            this.mol.removeAtom(this.selId);
            this.selId = null; this.hoverId = null;
          }
          this.saveState(); this.renderAll(); this.updateInfoPanel();
        }
      }
      if (e.ctrlKey && e.key === 'z') { e.preventDefault(); this.undo(); }
      if (e.ctrlKey && e.key === 'y') { e.preventDefault(); this.redo(); }
      if (e.key === 'Escape') {
        this.selId = null;
        this.renderer2D.selFgAtomId = null;
        this.renderer2D.selFgIndex = null;
        this.eraseMode = false;
        document.getElementById('btnErase').classList.remove('active');
        this.currentTool = 'C'; this.updateToolUI(); this.render2D();
      }
    });
  }

  addFG(atomId, fg) {
    const a = this.mol.atoms.get(atomId);
    if (!a || a.fgs.includes(fg)) return;
    const c = FG_CONTRIB[fg];
    if (!c) return;
    if (this.mol.getOccupiedValence(atomId) + c.v > (VALENCES[a.el] || 4)) {
      this.showToast('该原子价态已满');
      return;
    }
    a.fgs.push(fg);
    this.saveState(); this.updateInfoPanel(); this.renderAll();
  }

  placeFreeFG(x, y, fg) {
    if (!FG_CONTRIB[fg] && fg !== 'Ph') return;
    if (fg === 'Ph') {
      // Create actual benzene ring (6 C, alternating single/double bonds)
      const R = 48;
      const atoms = [];
      for (let i = 0; i < 6; i++) {
        const a = Math.PI * 2 / 6 * i - Math.PI / 2;
        atoms.push(this.mol.addAtom(x + R * Math.cos(a), y + R * Math.sin(a), 'C'));
      }
      for (let i = 0; i < 6; i++) {
        this.mol.addBond(atoms[i].id, atoms[(i + 1) % 6].id, i % 2 === 0 ? 'double' : 'single');
      }
    } else {
      // Other FGs: create parent atom with FG tag
      const parentEl = fg === 'NO2' ? 'N' : 'C';
      const a = this.mol.addAtom(x, y, parentEl);
      const c = FG_CONTRIB[fg];
      if (c && this.mol.getOccupiedValence(a.id) + c.v <= (VALENCES[parentEl] || 4)) {
        a.fgs.push(fg);
      }
    }
    this.saveState(); this.renderAll(); this.updateInfoPanel();
  }

  autoFillH() {
    // Remove all existing explicit H atoms first
    const toRemove = [];
    for (const [id, a] of this.mol.atoms) {
      if (a.el === 'H') toRemove.push(id);
    }
    for (const id of toRemove) this.mol.removeAtom(id);

    let added = 0;
    const allIds = [...this.mol.atoms.keys()];
    for (const id of allIds) {
      const a = this.mol.atoms.get(id);
      if (!a) continue;
      const hc = this.mol.getImplicitH(id);
      if (hc <= 0) continue;
      // Build actual bond directions from the parent atom
      const nbrs = this.mol.getNeighbors(id);
      const usedAngles = [];
      for (const nb of nbrs) {
        const na = this.mol.atoms.get(nb);
        if (na) usedAngles.push(Math.atan2(na.y - a.y, na.x - a.x));
      }
      usedAngles.sort((a, b) => a - b);

      const hyb = this.mol.getHybridization(id);
      const total = hyb === 'sp3' ? 4 : hyb === 'sp2' ? 3 : 2;
      const nFree = Math.max(0, total - usedAngles.length);

      // Compute free angles (largest gap method, same as _stubDirections)
      const freeAngles = [];
      if (usedAngles.length === 0) {
        // No bonds: use evenly spaced directions
        for (let i = 0; i < Math.min(hc, total); i++) {
          freeAngles.push((2 * Math.PI * i) / total);
        }
      } else {
        // Find largest angular gap
        let maxGap = 0, gapStart = 0;
        for (let i = 0; i < usedAngles.length; i++) {
          const j = (i + 1) % usedAngles.length;
          let gap = usedAngles[j] - usedAngles[i];
          if (i === usedAngles.length - 1) gap = usedAngles[0] + 2 * Math.PI - usedAngles[i];
          if (gap > maxGap) { maxGap = gap; gapStart = usedAngles[i]; }
        }
        if (usedAngles.length === 1) maxGap = 2 * Math.PI;
        for (let i = 0; i < Math.min(hc, nFree); i++) {
          freeAngles.push(gapStart + maxGap * (i + 1) / (Math.min(hc, nFree) + 1));
        }
      }

      // Place H atoms at proper bond distance from parent
      const hDist = 38; // bond length in editor coords
      for (let i = 0; i < Math.min(hc, freeAngles.length); i++) {
        const ang = freeAngles[i];
        const hAtom = this.mol.addAtom(
          a.x + hDist * Math.cos(ang),
          a.y + hDist * Math.sin(ang),
          'H'
        );
        this.mol.addBond(id, hAtom.id, 'single');
        added++;
      }
    }
    if (added > 0) this.showToast(`已添加 ${added} 个 H 原子`);
    else this.showToast('无需补氢');
    this.mol.normalizeStructure();
    this.saveState(); this.renderAll(); this.updateInfoPanel();
  }

  hitTest2D(sx, sy) {
    const r = this.renderer2D.atomR + 5;
    for (const [id, a] of this.mol.atoms) {
      const ax = this.renderer2D.sx(a.x), ay = this.renderer2D.sy(a.y);
      if ((sx - ax) ** 2 + (sy - ay) ** 2 < r * r) return id;
    }
    return null;
  }

  // ---- Tool Events ----
  setupToolEvents() {
    document.querySelectorAll('.btn-tool').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = btn.dataset.tool;
        if (t === 'erase') {
          this.eraseMode = !this.eraseMode;
          btn.classList.toggle('active', this.eraseMode);
          if (this.eraseMode) {
            this.currentTool = 'erase';
            document.querySelectorAll('.btn-tool:not([data-tool="erase"])')
              .forEach(b => b.classList.remove('active'));
          } else {
            this.currentTool = 'C'; this.updateToolUI();
          }
        } else {
          this.eraseMode = false;
          document.getElementById('btnErase')?.classList.remove('active');
          this.currentTool = t; this.updateToolUI();
        }
        this.bondFromId = null;
        if (this.viewMode === '3d-ball' || this.viewMode === '3d-space') {
          if (!this.eraseMode && t !== 'erase') this.setViewMode('2d');
        }
      });
    });
  }

  updateToolUI() {
    document.querySelectorAll('.btn-tool').forEach(b => {
      if (b.dataset.tool === 'erase') return;
      b.classList.toggle('active', b.dataset.tool === this.currentTool);
    });
  }

  // ---- Button Events ----
  setupButtonEvents() {
    document.getElementById('btnUndo').addEventListener('click', () => this.undo());
    document.getElementById('btnRedo').addEventListener('click', () => this.redo());
    document.getElementById('btnErase').addEventListener('click', () => {
      this.eraseMode = !this.eraseMode;
      const b = document.getElementById('btnErase');
      b.classList.toggle('active', this.eraseMode);
      if (this.eraseMode) {
        this.currentTool = 'erase';
        document.querySelectorAll('.btn-tool:not([data-tool="erase"])')
          .forEach(bb => bb.classList.remove('active'));
      } else {
        this.currentTool = 'C'; this.updateToolUI();
      }
      this.bondFromId = null;
    });
    document.getElementById('btnClear').addEventListener('click', () => {
      if (this.mol.isEmpty()) return;
      this.mol = new Molecule();
      this.renderer2D.mol = this.mol;
      this.selId = null; this.hoverId = null;
      this.history = []; this.historyIndex = -1;
      this.saveState(); this.renderAll(); this.updateInfoPanel();
      document.getElementById('canvasHint').style.opacity = '1';
    });
    document.getElementById('btnNormalize').addEventListener('click', () => {
      if (this.mol.isEmpty()) return;
      this.mol.normalizeStructure();
      this.selId = null; this.hoverId = null;
      if (this.viewMode === '2d' && this.mol.atoms.size > 0) {
        let cx = 0, cy = 0;
        for (const [, a] of this.mol.atoms) { cx += a.x; cy += a.y; }
        cx /= this.mol.atoms.size; cy /= this.mol.atoms.size;
        const w = document.getElementById('editCanvas').parentElement.clientWidth;
        const h = document.getElementById('editCanvas').parentElement.clientHeight;
        this.renderer2D._snapToTarget();
        this.renderer2D.setTarget(1, w / 2 - cx, h / 2 - cy);
        this.renderer2D._snapToTarget();
      }
      this.saveState(); this.renderAll(); this.updateInfoPanel();
      this.showToast('结构已规范化');
    });
    document.getElementById('btnAutoH').addEventListener('click', () => this.autoFillH());
    document.getElementById('btnSynth').addEventListener('click', () => this.showSynthesis());
  }

  // ---- Templates ----
  setupTemplateEvents() {
    document.querySelectorAll('[data-template]').forEach(b => {
      b.addEventListener('click', () => this.loadTemplate(b.dataset.template));
    });
  }

  loadTemplate(name) {
    const mol = new Molecule();
    let atoms = [];
    const cx = 400, cy = 300, s = 60;

    switch (name) {
      case 'ethanol':
        atoms = [mol.addAtom(cx, cy, 'C'), mol.addAtom(cx + s, cy, 'C')];
        atoms[1].fgs.push('OH');
        mol.addBond(atoms[0].id, atoms[1].id, 'single');
        break;
      case 'acetic_acid':
        atoms = [mol.addAtom(cx, cy, 'C'), mol.addAtom(cx + s, cy, 'C')];
        atoms[1].fgs.push('COOH');
        mol.addBond(atoms[0].id, atoms[1].id, 'single');
        break;
      case 'ethyl_acetate':
        // CH3-COO-CH2-CH3: ester -COO- (carbonyl C=O + ether O bridge)
        // C1-C2(=O)-O-C3-C4
        atoms = [
          mol.addAtom(cx - s, cy, 'C'),           // CH3 (acid side)
          mol.addAtom(cx, cy, 'C'),                // carbonyl C (acid side)
          mol.addAtom(cx + s, cy, 'O'),            // ester O bridge
          mol.addAtom(cx + s * 2, cy, 'C'),        // CH2 (alcohol side)
          mol.addAtom(cx + s * 3, cy, 'C'),        // CH3 (alcohol side)
        ];
        atoms[1].fgs.push('CO'); // =O on carbonyl carbon
        mol.addBond(atoms[0].id, atoms[1].id, 'single');
        mol.addBond(atoms[1].id, atoms[2].id, 'single');
        mol.addBond(atoms[2].id, atoms[3].id, 'single');
        mol.addBond(atoms[3].id, atoms[4].id, 'single');
        break;
      case 'benzene': {
        const r = 60;
        for (let i = 0; i < 6; i++) {
          const a = Math.PI * 2 / 6 * i - Math.PI / 2;
          atoms.push(mol.addAtom(cx + r * Math.cos(a), cy + r * Math.sin(a), 'C'));
        }
        for (let i = 0; i < 6; i++) {
          mol.addBond(atoms[i].id, atoms[(i + 1) % 6].id, i % 2 === 0 ? 'double' : 'single');
        }
        break;
      }
      case 'acetone':
        atoms = [mol.addAtom(cx - s, cy, 'C'), mol.addAtom(cx, cy, 'C'), mol.addAtom(cx + s, cy, 'C')];
        atoms[1].fgs.push('CO');
        mol.addBond(atoms[0].id, atoms[1].id, 'single');
        mol.addBond(atoms[1].id, atoms[2].id, 'single');
        break;
      case 'phenol': {
        const r = 55;
        for (let i = 0; i < 6; i++) {
          const a = Math.PI * 2 / 6 * i - Math.PI / 2;
          atoms.push(mol.addAtom(cx + r * Math.cos(a), cy + r * Math.sin(a), 'C'));
        }
        for (let i = 0; i < 6; i++) {
          mol.addBond(atoms[i].id, atoms[(i + 1) % 6].id, i % 2 === 0 ? 'double' : 'single');
        }
        atoms[0].fgs.push('OH');
        break;
      }
      case 'glucose':
        // Open-chain glucose: CHO-CHOH×4-CH2OH (C6H12O6)
        // 6 C atoms in chain
        for (let i = 0; i < 6; i++) {
          atoms.push(mol.addAtom(cx + i * s * 0.75, cy + (i % 2) * 28, 'C'));
        }
        // C1 (aldehyde): add =O via explicit O atom with double bond
        {
          const aldO = mol.addAtom(cx - s * 0.4, cy - s * 0.8, 'O');
          mol.addBond(atoms[0].id, aldO.id, 'double');
        }
        // C2-C5: each has -OH
        for (let i = 1; i <= 4; i++) atoms[i].fgs.push('OH');
        // C6: -CH2OH => add -OH fg (2 implicit H from valence)
        atoms[5].fgs.push('OH');
        // Chain bonds
        for (let i = 0; i < 5; i++) mol.addBond(atoms[i].id, atoms[i + 1].id, 'single');
        break;
      case 'alanine':
        // Alanine: CH3-CH(NH2)-COOH (α-amino acid)
        // COOH has its own carbonyl C, connected to alpha C by single bond
        atoms = [
          mol.addAtom(cx, cy, 'C'),               // CH3
          mol.addAtom(cx + s, cy, 'C'),            // alpha C
          mol.addAtom(cx + s * 2, cy, 'C'),        // COOH carbonyl C
        ];
        atoms[1].fgs.push('NH2');
        atoms[2].fgs.push('CO');                   // =O
        atoms[2].fgs.push('OH');                   // -OH
        mol.addBond(atoms[0].id, atoms[1].id, 'single');
        mol.addBond(atoms[1].id, atoms[2].id, 'single');
        break;
    }

    this.mol = mol;
    this.renderer2D.mol = this.mol;
    this.selId = null; this.hoverId = null;
    this.history = []; this.historyIndex = -1;
    this.mol.normalizeStructure();
    this.saveState(); this.renderAll(); this.updateInfoPanel();
    document.getElementById('canvasHint').style.opacity = '0';
  }

  // ---- Resize ----
  setupResize() {
    const resize = () => {
      this.renderer2D.resize();
      this.renderer3D.resize();
      this.renderAll();
    };
    window.addEventListener('resize', resize);
    setTimeout(resize, 200);
    new ResizeObserver(resize).observe(document.getElementById('canvasArea'));
  }

  // ---- Undo/Redo ----
  saveState() {
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(this.mol.clone());
    this.historyIndex = this.history.length - 1;
    if (this.history.length > 80) { this.history.shift(); this.historyIndex--; }
    document.getElementById('btnUndo').style.opacity = this.historyIndex > 0 ? '1' : '0.4';
    document.getElementById('btnRedo').style.opacity =
      this.historyIndex < this.history.length - 1 ? '1' : '0.4';
  }

  undo() {
    if (this.historyIndex <= 0) return;
    this.historyIndex--;
    this.mol = this.history[this.historyIndex].clone();
    this.renderer2D.mol = this.mol;
    this.selId = null; this.hoverId = null;
    this.renderAll(); this.updateInfoPanel();
    document.getElementById('btnUndo').style.opacity = this.historyIndex > 0 ? '1' : '0.4';
    document.getElementById('btnRedo').style.opacity = '1';
  }

  redo() {
    if (this.historyIndex >= this.history.length - 1) return;
    this.historyIndex++;
    this.mol = this.history[this.historyIndex].clone();
    this.renderer2D.mol = this.mol;
    this.selId = null; this.hoverId = null;
    this.renderAll(); this.updateInfoPanel();
    document.getElementById('btnRedo').style.opacity =
      this.historyIndex < this.history.length - 1 ? '1' : '0.4';
    document.getElementById('btnUndo').style.opacity = '1';
  }

  // ---- Rendering ----
  render2D(sel = null, hover = null) {
    this.renderer2D.render(sel ?? this.selId, hover ?? this.hoverId, this.bondFromId);
  }

  render3D() {
    const mode = this.viewMode === '3d-space' ? 'space-fill' : 'ball-stick';
    this.renderer3D.renderMolecule(
      this.mol, mode,
      this.highQuality ? 'high' : 'low',
      this.showH, this.showLabels
    );
  }

  renderAll() {
    if (this.viewMode === '2d') this.render2D();
    else this.render3D();
    this.updateThumbnail();
  }

  render() {
    const hint = document.getElementById('canvasHint');
    if (this.mol.isEmpty()) hint.style.opacity = '1';
    else hint.style.opacity = '0';
    this.renderAll();
  }

  updateThumbnail() {
    renderThumbnail(this.mol, document.getElementById('thumbCanvas'));
  }

  // ---- Info Panel ----
  updateInfoPanel() {
    const btn = document.getElementById('btnSynth');

    if (this.mol.isEmpty()) {
      btn.disabled = true; btn.style.opacity = '.5';
      document.getElementById('infoFormula').innerHTML = '—';
      document.getElementById('infoMass').textContent = '—';
      document.getElementById('infoAtomCount').textContent = '—';
      document.getElementById('infoUnsaturation').textContent = '—';
      document.getElementById('infoHeavy').textContent = '—';
      document.getElementById('infoFGs').innerHTML =
        '<span style="color:var(--text2)">—</span>';
      this.updateThumbnail();
      return;
    }

    btn.disabled = false; btn.style.opacity = '1';
    document.getElementById('infoFormula').innerHTML = this.mol.getFormulaHTML() || '—';
    const m = this.mol.getMolarMass();
    document.getElementById('infoMass').textContent = m ? m.toFixed(2) + ' g/mol' : '—';
    document.getElementById('infoAtomCount').textContent = this.mol.atoms.size;
    document.getElementById('infoUnsaturation').textContent = this.mol.getUnsaturation();

    const cnt = this.mol.getAtomCounts();
    let heavy = 0;
    for (const [k, v] of Object.entries(cnt)) if (k !== 'H') heavy += v;
    document.getElementById('infoHeavy').textContent = heavy;

    const fi = this.mol.identifyFunctionalGroups();
    const fc = document.getElementById('infoFGs');
    fc.innerHTML = fi.display.length > 0
      ? fi.display.map(f => `<span class="fg-tag">${f}</span>`).join(' ')
      : '<span style="color:var(--text2)">未识别到特定官能团</span>';

    this.updateThumbnail();
  }

  // ---- Synthesis ----
  async showSynthesis() {
    if (this.mol.isEmpty()) return;
    const formula = this.mol.getPlainFormula();
    const targetSmiles = this.mol.toSmiles();
    console.log('[Synth] target SMILES:', targetSmiles, 'formula:', formula, 'atoms:', this.mol.atoms.size);

    this.showModalInner('<div class="spinner"></div><p style="text-align:center;color:var(--text2)">正在通过化学引擎推断合成路径…</p>');

    let paths = null;
    try {
      paths = await this.engine.inferPath(this.mol);
    } catch (e) {
      console.warn("API synthesis failed, trying local engine:", e);
    }

    // Fallback: local feature-based engine (if available)
    if (!paths || paths.length === 0) {
      if (typeof this.engine.findPathway === 'function') {
        const pw = this.engine.findPathway(this.mol);
        if (pw && pw.length > 0) {
          this.renderSynthesisLegacy(pw, formula);
          return;
        }
      }
    }

    if (!paths || paths.length === 0) {
      this.showModalInner(`
        <div class="path-header">
          <div class="target">${formula}</div>
          <div class="summary">未找到合适的合成路径</div>
        </div>
        <p style="color:var(--text2);font-size:12px">
          提示：尝试2-6个碳的简单结构，或使用右侧模板。<br>
          确保合成API已启动：<code>python synthesis_api.py</code>
        </p>
      `);
      return;
    }

    this.renderSynthesisPaths(paths, formula, targetSmiles);
  }

  renderSynthesisPaths(paths, formula, targetSmiles) {
    const path = paths[0];
    let html = `<div class="path-header">
      <div class="target">目标分子：${formula}</div>
      <div class="summary">共 ${path.length} 步反应（找到 ${paths.length} 条路径）</div>
    </div>
    <div class="synthesis-flow">`;

    // First canvas: starting material (first step's precursors)
    html += `<div class="synth-step">
      <div class="synth-canvas-wrap">
        <canvas id="synth-canvas-0" width="200" height="200"></canvas>
      </div>
    </div>`;

    path.forEach((step, idx) => {
      html += `<div class="synth-arrow">
        <span class="arrow-icon">↓</span>
        <span class="arrow-label">${step.rule || '→'}</span>
        ${step.reagent ? `<span class="arrow-reagent">试剂：${step.reagent}</span>` : ''}
        ${step.condition ? `<span class="arrow-condition">${step.condition}</span>` : ''}
      </div>
      <div class="synth-step">
        <div class="synth-canvas-wrap">
          <canvas id="synth-canvas-${idx + 1}" width="200" height="200"></canvas>
        </div>
      </div>`;
    });

    html += `</div>`;

    // ── Text step descriptions (圈一 圈二 ...) ──
    html += this._buildTextSteps(path, path[0].precursors, formula);

    this.showModalInner(html);

    setTimeout(() => {
      // Render starting material
      const c0 = document.getElementById('synth-canvas-0');
      if (c0) {
        try {
          new SkeletalFormula(SynthesisEngine.smilesToMolecule(path[0].precursors)).render(c0, {
            padding: 20, bondLen: 36, lineWidth: 1.8, doubleGap: 2.8,
            tripleGap: 4.5, showCarbonH: false, bgColor: '#f8f9fa',
          });
        } catch(e) { c0.getContext('2d').fillText(path[0].precursors, 10, 100); }
      }

      // Render each step's product
      path.forEach((step, idx) => {
        const canvas = document.getElementById(`synth-canvas-${idx + 1}`);
        if (!canvas) return;
        try {
          new SkeletalFormula(SynthesisEngine.smilesToMolecule(step.product)).render(canvas, {
            padding: 20, bondLen: 36, lineWidth: 1.8, doubleGap: 2.8,
            tripleGap: 4.5, showCarbonH: false, bgColor: '#f8f9fa',
          });
        } catch(e) { canvas.getContext('2d').fillText(step.product, 10, 100); }
      });
    }, 100);
  }

  // ── 文字步骤说明（圈一 圈二 圈三 ...） ──
  _buildTextSteps(path, startSmiles, targetFormula) {
    const circles = ['①','②','③','④','⑤','⑥','⑦','⑧','⑨','⑩','⑪','⑫','⑬','⑭','⑮'];
    
    let html = `<div class="synth-text-steps">
      <div class="section-title">📝 分步文字说明</div>`;

    // ① 起始原料
    html += `<div class="text-step start">
      <span class="step-num">${circles[0]}</span>
      <div class="step-body">
        <div class="step-title">起始原料</div>
        <div class="step-eq">${startSmiles}</div>
      </div>
    </div>`;

    // ②③④... 各步反应
    path.forEach((step, idx) => {
      const num = circles[(idx + 1) % circles.length];
      const isLast = idx === path.length - 1;
      const cls = isLast ? 'text-step target' : 'text-step';
      
      html += `<div class="${cls}">
        <span class="step-num">${num}</span>
        <div class="step-body">
          <div class="step-title">${isLast ? '目标产物：' + targetFormula : step.condition}</div>
          <div class="step-eq">${step.precursors} → ${step.product}</div>
          <div class="step-detail">试剂：${step.reagent || '—'}</div>
        </div>
      </div>`;
    });

    html += `</div>`;
    return html;
  }

  renderSynthesisLegacy(pw, formula) {
    const fcHtml = `<div class="flowchart-section">
      <div class="fc-label">📊 合成路径流程图</div>
      <canvas id="flowChart"></canvas>
    </div>`;

    let stepsHtml = `<div class="detail-section">
      <button class="detail-toggle expanded" id="detailToggle">
        <span class="arrow">▶</span> 📝 查看详细步骤说明
      </button>
      <div class="detail-content show" id="detailContent">`;

    pw.forEach((step, i) => {
      if (i === 0) {
        stepsHtml += `<div class="step-card" style="border-left-color:var(--green)">
          <span class="step-num" style="background:var(--green)">S</span>
          <span class="step-title">起始原料</span>
          <div class="step-eq">${step.desc}</div>
          <div class="step-detail">常见化工原料</div>
        </div>`;
      } else {
        stepsHtml += `<div class="step-card">
          <span class="step-num">${i}</span>
          <span class="step-title">${step.rule}</span>
          <div class="step-eq">${step.desc}</div>
          <div class="step-detail">
            <strong>试剂：</strong>${step.reagent || '—'}<br>
            <strong>条件：</strong>${step.condition || '—'}
          </div>
        </div>`;
      }
      if (i < pw.length - 1) stepsHtml += '<div class="path-arrow">↓</div>';
    });

    stepsHtml += `<div class="path-arrow" style="font-size:22px">→</div>
      <div class="step-card" style="border-left-color:var(--red)">
        <span class="step-num" style="background:var(--red)">★</span>
        <span class="step-title">目标产物</span>
        <div class="step-eq" style="font-size:15px;text-align:center;color:var(--accent)">${formula}</div>
        <div class="step-detail">合成完毕</div>
      </div></div></div>`;

    const content = `<div class="path-header">
      <div class="target">目标分子：${formula}</div>
      <div class="summary">共 ${pw.length} 步反应</div>
    </div>${fcHtml}${stepsHtml}`;

    this.showModalInner(content);

    setTimeout(() => renderFlowchart(pw, formula, 'flowChart'), 50);

    setTimeout(() => {
      const tl = document.getElementById('detailToggle');
      const dc = document.getElementById('detailContent');
      if (tl && dc) {
        tl.addEventListener('click', () => {
          tl.classList.toggle('expanded');
          dc.classList.toggle('show');
        });
      }
    }, 100);
  }

  showModalInner(content) {
    const exist = document.querySelector('.modal-overlay');
    if (exist) exist.remove();

    const ov = document.createElement('div');
    ov.className = 'modal-overlay';
    ov.innerHTML = `<div class="modal">
      <div class="modal-header">
        <h3>⚗ 合成路径推断</h3>
        <button class="modal-close">✕</button>
      </div>
      <div class="modal-body">${content}</div>
    </div>`;
    document.body.appendChild(ov);

    const cl = () => ov.remove();
    ov.querySelector('.modal-close').addEventListener('click', cl);
    ov.addEventListener('click', e => { if (e.target === ov) cl(); });
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape') { cl(); document.removeEventListener('keydown', esc); }
    });
  }

  showToast(msg) {
    const ex = document.querySelector('.toast');
    if (ex) ex.remove();
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2500);
  }
}

// ==================== BOOT ====================
document.addEventListener('DOMContentLoaded', () => new App());
