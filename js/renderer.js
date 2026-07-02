// ==================== RENDERER CONSTANTS ====================
const CPK = {
  H:0xFFFFFF, C:0x404040, N:0x1848F0, O:0xEE1010,
  F:0x70D040, S:0xE8E820, Cl:0x18C818, Br:0x882222,
  I:0x8B008B, P:0xEE7020
};
const COV_RADII = {
  H:0.31, C:0.76, N:0.71, O:0.66,
  F:0.57, S:1.05, Cl:1.02, Br:1.20, I:1.39, P:1.07
};
const VDW_RADII = {
  H:1.10, C:1.70, N:1.55, O:1.52,
  F:1.47, S:1.80, Cl:1.75, Br:1.85, I:1.98, P:1.80
};

// ==================== 2D THUMBNAIL (TRUE SKELETAL FORMULA) ====================
// Delegates to the standalone SkeletalFormula renderer.
function renderThumbnail(mol, canvas) {
  if (!mol || mol.isEmpty()) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#888';
    ctx.font = '14px "Times New Roman", serif';
    ctx.textAlign = 'center';
    ctx.fillText('无分子', canvas.width / 2, canvas.height / 2);
    return;
  }
  try {
    new SkeletalFormula(mol).render(canvas, {
      padding: 28,
      lineWidth: 1.6,
      doubleGap: 2.8,
      tripleGap: 4.5,
      showCarbonH: false,
      bgColor: '#f8f9fa',
    });
  } catch (e) {
    console.error('SkeletalFormula render failed:', e);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#888';
    ctx.font = '12px "Times New Roman", serif';
    ctx.textAlign = 'center';
    ctx.fillText('渲染错误', canvas.width / 2, canvas.height / 2);
  }
}

// ==================== 3D RENDERER (Three.js) ====================
class Renderer3D {
  constructor(container) {
    this.container = container;
    this.w = container.clientWidth;
    this.h = container.clientHeight;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1d23);

    this.camera = new THREE.PerspectiveCamera(45, this.w / this.h, 0.1, 200);
    this.camera.position.set(0, 4, 12);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(this.w, this.h);
    this.renderer.shadowMap.enabled = true;
    container.appendChild(this.renderer.domElement);

    // Label overlay canvas
    this.labelCanvas = document.createElement('canvas');
    this.labelCanvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;';
    container.appendChild(this.labelCanvas);
    this.labelCtx = this.labelCanvas.getContext('2d');

    // Lights
    this.scene.add(new THREE.AmbientLight(0x606080, 2.0));
    const d1 = new THREE.DirectionalLight(0xffffff, 3.5);
    d1.position.set(5, 10, 7); this.scene.add(d1);
    const d2 = new THREE.DirectionalLight(0x8090ff, 1.5);
    d2.position.set(-5, -2, -3); this.scene.add(d2);

    // Ground grid
    const grid = new THREE.GridHelper(20, 20, 0x333340, 0x222230);
    grid.position.y = -3; this.scene.add(grid);

    this.molGroup = new THREE.Group(); this.scene.add(this.molGroup);
    this.bondGroup = new THREE.Group(); this.molGroup.add(this.bondGroup);
    this.atomGroup = new THREE.Group(); this.molGroup.add(this.atomGroup);

    // Orbit state
    this.isDragging = false;
    this.prevMouse = { x: 0, y: 0 };
    this.rotX = 0; this.rotY = 0;
    this.targetRotX = 0; this.targetRotY = 0;
    this.zoom = 1; this.targetZoom = 1;

    // Label data for overlay
    this._labelData = [];
    this._showLabels = false;
    this._currentMode = 'ball-stick';

    this.setupOrbit();
    this.animate();
  }

  setupOrbit() {
    const el = this.renderer.domElement;

    el.addEventListener('mousedown', e => {
      if (e.button === 0) {
        this.isDragging = true;
        this.prevMouse = { x: e.clientX, y: e.clientY };
      }
    });

    window.addEventListener('mousemove', e => {
      if (!this.isDragging) return;
      const dx = e.clientX - this.prevMouse.x;
      const dy = e.clientY - this.prevMouse.y;
      this.targetRotY += dx * 0.005;
      this.targetRotX += dy * 0.005;
      this.targetRotX = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, this.targetRotX));
      this.prevMouse = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener('mouseup', () => { this.isDragging = false; });

    el.addEventListener('wheel', e => {
      e.preventDefault();
      this.targetZoom *= e.deltaY > 0 ? 0.9 : 1.1;
      this.targetZoom = Math.max(0.3, Math.min(4, this.targetZoom));
    });

    el.addEventListener('touchstart', e => {
      if (e.touches.length === 1) {
        this.isDragging = true;
        this.prevMouse = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    });
    el.addEventListener('touchmove', e => {
      if (!this.isDragging) return;
      const dx = e.touches[0].clientX - this.prevMouse.x;
      const dy = e.touches[0].clientY - this.prevMouse.y;
      this.targetRotY += dx * 0.005;
      this.targetRotX += dy * 0.005;
      this.targetRotX = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, this.targetRotX));
      this.prevMouse = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    });
    el.addEventListener('touchend', () => { this.isDragging = false; });
  }

  projectToScreen(pos3D) {
    const v = pos3D.clone().project(this.camera);
    const x = (v.x * 0.5 + 0.5) * this.w;
    const y = (-v.y * 0.5 + 0.5) * this.h;
    return { x, y, z: v.z };
  }

  drawLabels() {
    const lc = this.labelCanvas;
    const ctx = this.labelCtx;
    lc.width = this.w * window.devicePixelRatio;
    lc.height = this.h * window.devicePixelRatio;
    ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    if (!this._showLabels || this._labelData.length === 0) return;

    ctx.font = 'bold 12px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const { pos, el } of this._labelData) {
      const s = this.projectToScreen(pos);
      if (s.z > 1) continue; // behind camera
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      const tw = ctx.measureText(el).width;
      ctx.fillRect(s.x - tw/2 - 3, s.y - 8, tw + 6, 16);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(el, s.x, s.y);
    }
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    this.rotX += (this.targetRotX - this.rotX) * 0.15;
    this.rotY += (this.targetRotY - this.rotY) * 0.15;
    this.zoom += (this.targetZoom - this.zoom) * 0.15;

    const d = 8 * this.zoom;
    this.camera.position.x = d * Math.sin(this.rotY) * Math.cos(this.rotX);
    this.camera.position.y = d * Math.sin(this.rotX);
    this.camera.position.z = d * Math.cos(this.rotY) * Math.cos(this.rotX);
    this.camera.lookAt(0, 0, 0);
    this.renderer.render(this.scene, this.camera);
    if (this._showLabels) this.drawLabels();
  }

  resize() {
    this.w = this.container.clientWidth;
    this.h = this.container.clientHeight;
    this.camera.aspect = this.w / this.h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.w, this.h);
  }

  clear() {
    while (this.atomGroup.children.length > 0) this.atomGroup.remove(this.atomGroup.children[0]);
    while (this.bondGroup.children.length > 0) this.bondGroup.remove(this.bondGroup.children[0]);
    this._labelData = [];
    if (this.labelCtx) this.labelCtx.clearRect(0, 0, this.labelCanvas.width, this.labelCanvas.height);
  }

  renderMolecule(mol, mode = 'ball-stick', quality = 'high', showH = true, showLabels = false) {
    this.clear();
    this._showLabels = showLabels;
    this._currentMode = mode;
    if (mol.isEmpty()) return;

    const segs = quality === 'high' ? 32 : 12;
    const cylSegs = quality === 'high' ? 16 : 8;
    const matCache = {};

    function atomMat(el) {
      if (!matCache[el]) {
        matCache[el] = new THREE.MeshPhongMaterial({
          color: CPK[el] || 0xff69b4,
          specular: 0x444444,
          shininess: quality === 'high' ? 60 : 30,
        });
      }
      return matCache[el];
    }

    const bondMat = new THREE.MeshPhongMaterial({
      color: 0xb0b0b8, specular: 0x222222, shininess: 30,
    });
    const bondMatDark = new THREE.MeshPhongMaterial({
      color: 0x8888a0, specular: 0x222222, shininess: 30,
    });
    const bondMatH = new THREE.MeshPhongMaterial({
      color: 0xc8c8d0, specular: 0x111111, shininess: 15,
    });

    // --- Radii ---
    const isBallStick = (mode !== 'space-fill');
    function sfRadius(el) { return 0.72*((VDW_RADII[el]||1.5)/(VDW_RADII['C']||1.7)); }

    // Ball-stick atom radius: same VDW-based proportion as space-fill, scaled to C=0.38
    function bsRadius(el) {
      return 0.38 * ((VDW_RADII[el] || 1.5) / (VDW_RADII['C'] || 1.7));
      // C=0.38  N=0.35  O=0.34  H=0.25  S=0.40
    }
    const bondR = isBallStick ? 0.12 : 0;

    // --- Clyinder helper ---
    const axis = new THREE.Vector3(0,1,0);
    function mkCyl(r, f, t, mat) {
      const d=new THREE.Vector3().subVectors(t,f), l=d.length();
      if(l<0.01) return null;
      const m=new THREE.Vector3().addVectors(f,t).multiplyScalar(0.5);
      const g=new THREE.CylinderGeometry(r,r,l,cylSegs);
      const me=new THREE.Mesh(g,mat); me.position.copy(m);
      me.setRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(axis,d.normalize()));
      return me;
    }

    // --- Build fullMol with expanded FGs ---
    const fullMol = new Molecule();
    const idMap = new Map();
    for(const [id,a] of mol.atoms) idMap.set(id, fullMol.addAtom(a.x,a.y,a.el));
    for(const b of mol.bonds) { 
      const na=idMap.get(b.a), nb=idMap.get(b.b);
      if(na&&nb) fullMol.addBond(na.id, nb.id, b.type);
    }
    for(const [oid,newAtom] of idMap) { 
      const oa=mol.atoms.get(oid); 
      if(oa){newAtom.x=oa.x; newAtom.y=oa.y;} 
    }

    const fgBonds=[];
    for(const [oid,a] of mol.atoms) {
      const pn=idMap.get(oid); if(pn===undefined) continue;
      for(const fg of a.fgs) {
        if(fg==='OH'){ const o=fullMol.addAtom(0,0,'O'); fgBonds.push({a:pn,b:o,type:'single'}); }
        else if(fg==='CHO'||fg==='CO'){ fgBonds.push({a:pn,b:fullMol.addAtom(0,0,'O'),type:'double'}); }
        else if(fg==='COOH'){ fgBonds.push({a:pn,b:fullMol.addAtom(0,0,'O'),type:'double'}); fgBonds.push({a:pn,b:fullMol.addAtom(0,0,'O'),type:'single'}); }
        else if(fg==='NH2'){ fgBonds.push({a:pn,b:fullMol.addAtom(0,0,'N'),type:'single'}); }
        else if(fg==='CN'){ fgBonds.push({a:pn,b:fullMol.addAtom(0,0,'N'),type:'triple'}); }
        else if(fg==='NO2'){ const n=fullMol.addAtom(0,0,'N'); fgBonds.push({a:pn,b:n,type:'single'}); fgBonds.push({a:n,b:fullMol.addAtom(0,0,'O'),type:'double'}); fgBonds.push({a:n,b:fullMol.addAtom(0,0,'O'),type:'double'}); }
      }
    }
    for(const fb of fgBonds) fullMol.addBond(fb.a.id, fb.b.id, fb.type);

    // --- 3D positions ---
    const pos3d = fullMol.compute3DPositions();

    // --- H direction helpers ---
    function getCandDirs(hyb, bDirs, cn) {
      if(hyb==='sp') return bDirs.length===0?[new THREE.Vector3(0,1,0)]:[bDirs[0].clone().multiplyScalar(-1)];
      if(hyb==='sp2'){ const d=[]; for(let i=0;i<cn;i++){const a=(2*Math.PI/cn)*i; d.push(new THREE.Vector3(Math.cos(a),Math.sin(a),0));} return d; }
      return [
        new THREE.Vector3( 1, 1, 1).normalize(), new THREE.Vector3(-1,-1, 1).normalize(),
        new THREE.Vector3(-1, 1,-1).normalize(), new THREE.Vector3( 1,-1,-1).normalize(),
      ].slice(0,cn||4);
    }

    // --- SF relaxation ---
    let sfPos=null;
    if(!isBallStick){
      try{
        const IP=0.82; sfPos=new Map();
        for(const[id]of fullMol.atoms){const p=pos3d.get(id);if(p)sfPos.set(id,new THREE.Vector3(p.x,p.y,p.z));}
        for(let iter=0;iter<40;iter++){let mx=0;
          for(const b of fullMol.bonds){
            const pa=sfPos.get(b.a),pb=sfPos.get(b.b); if(!pa||!pb)continue;
            const ea=fullMol.atoms.get(b.a), eb=fullMol.atoms.get(b.b);
            const tgt=IP*(sfRadius(ea?ea.el:'C')+sfRadius(eb?eb.el:'C'));
            const dr=new THREE.Vector3().subVectors(pb,pa); const cur=Math.max(dr.length(),0.0001); dr.normalize();
            const delta=(cur-tgt)*0.5; pa.add(dr.clone().multiplyScalar(delta)); pb.add(dr.clone().multiplyScalar(-delta));
            mx=Math.max(mx,Math.abs(delta));
          }
          if(mx<0.0005)break;
        }
      }catch(e){sfPos=null;}
    }
    const activePos = (sfPos&&sfPos.size>0)?sfPos:pos3d;

    // --- Place H's ---
    const hList=[];
    if(showH){
      for(const[id,a] of fullMol.atoms){
        const hC=fullMol.getImplicitH(id); if(hC<=0)continue;
        const p3=activePos.get(id); if(!p3)continue;
        const hyb=fullMol.getHybridization(id), el=a.el, nbrs=fullMol.getNeighbors(id);
        const bD=[]; for(const nb of nbrs){const np=activePos.get(nb);if(np)bD.push(new THREE.Vector3().subVectors(np,p3).normalize());}

        // Compute ideal H directions based on hybridization:
        // sp2 with 2 bonds (ring C): radial = -(n1+n2).normalize() — correct at 120° from both.
        // sp3: use computeBondDirections for proper tetrahedral (109.5°) H placement.
        let cand;
        if (el === 'O' && bD.length === 1) {
          const outDir = bD[0].clone().multiplyScalar(-1);  // point away from parent C
          const perp = new THREE.Vector3(-outDir.z, 0, outDir.x).normalize();
          if (perp.length() < 0.1) perp.set(1, 0, 0);
          const ang = 104.5 * Math.PI / 180;
          const m = outDir.clone().multiplyScalar(Math.cos(ang / 2));
          const s = perp.clone().multiplyScalar(Math.sin(ang / 2));
          cand = [m.clone().add(s).normalize(), m.clone().add(s.clone().multiplyScalar(-1)).normalize()];
        } else if (el === 'N' && bD.length <= 2) {
          cand = [new THREE.Vector3(1, 1, 1).normalize(), new THREE.Vector3(-1, -1, 1).normalize(),
                  new THREE.Vector3(-1, 1, -1).normalize(), new THREE.Vector3(1, -1, -1).normalize()];
        } else if (hyb === 'sp2' && bD.length === 2 && el === 'C') {
          // Ring sp2 carbon: H points radially outward, 120° from both ring bonds.
          const sum = new THREE.Vector3();
          for (const bd of bD) sum.add(bd);
          if (sum.length() > 0.01) {
            const ideal = sum.normalize().multiplyScalar(-1);
            const fallback = getCandDirs(hyb, bD, nbrs.length + hC);
            cand = [ideal, ...fallback.filter(d => d.dot(ideal) < 0.7)];
          } else {
            cand = getCandDirs(hyb, bD, nbrs.length + hC);
          }
        } else if (hyb === 'sp3' && bD.length > 0) {
          // Tetrahedral H placement: use computeBondDirections for proper 109.5° geometry.
          cand = computeBondDirections(id, 'sp3', bD, hC);
        } else {
          cand = getCandDirs(hyb, bD, nbrs.length + hC);
        }

        const sc = cand.map(d => ({ d, score: bD.reduce((s, bd) => s + (1 - d.dot(bd)), 0) }));
        sc.sort((a, b) => b.score - a.score);
        const us = new Set();
        const H_BL = { C: 1.06, O: 0.94, N: 0.98 };
        const hDist = isBallStick ? (H_BL[el] || 1.06) : (0.82 * (sfRadius(el) + sfRadius('H')));
        for (let i = 0; i < hC && i < sc.length; i++) {
          let bj = -1;
          for (let j = 0; j < sc.length; j++) {
            if (us.has(j)) continue;
            if (![...us].some(u => sc[j].d.dot(sc[u].d) > 0.5)) { bj = j; break; }
          }
          if (bj < 0) bj = sc.findIndex((_, j) => !us.has(j));
          if (bj >= 0) { us.add(bj); hList.push({ pos: p3.clone().addScaledVector(sc[bj].d, hDist), parentId: id, el: 'H' }); }
        }
      }
    }

    // --- Collect all atoms ---
    const allAtoms=[];
    for(const[id,a] of fullMol.atoms){const p=activePos.get(id);if(p)allAtoms.push({pos:new THREE.Vector3(p.x,p.y,p.z),el:a.el,id,isHeavy:true});}
    for(const h of hList) allAtoms.push({pos:h.pos.clone(),el:'H',id:-1,isHeavy:false,parentId:h.parentId});

    // --- Draw atoms ---
    for (const a of allAtoms) {
      let r;
      if (isBallStick) {
        r = bsRadius(a.el);
      } else {
        r = sfRadius(a.el);
      }
      const geo = new THREE.SphereGeometry(r, segs, segs);
      const mesh = new THREE.Mesh(geo, atomMat(a.el));
      mesh.position.copy(a.pos);
      this.atomGroup.add(mesh);
      if (a.isHeavy) this._labelData.push({ pos: a.pos.clone(), el: a.el });
    }

    // --- Draw bonds (ball-stick only) ---
    if (isBallStick) {
      for (const b of fullMol.bonds) {
        const p1 = activePos.get(b.a), p2 = activePos.get(b.b);
        if (!p1 || !p2) continue;
        const dir = new THREE.Vector3().subVectors(p2, p1);
        const len = dir.length();
        const mid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
        const quat = new THREE.Quaternion().setFromUnitVectors(axis, dir.clone().normalize());

        if (b.type === 'single') {
          const geo = new THREE.CylinderGeometry(bondR, bondR, len, cylSegs);
          const mesh = new THREE.Mesh(geo, bondMat);
          mesh.position.copy(mid);
          mesh.setRotationFromQuaternion(quat);
          this.bondGroup.add(mesh);
        } else if (b.type === 'double') {
          const off = 0.18;
          const perp = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
          const m1 = mkCyl(bondR * 0.9, p1.clone().addScaledVector(perp,  off), p2.clone().addScaledVector(perp,  off), bondMat);
          const m2 = mkCyl(bondR * 0.9, p1.clone().addScaledVector(perp, -off), p2.clone().addScaledVector(perp, -off), bondMat);
          if (m1) this.bondGroup.add(m1);
          if (m2) this.bondGroup.add(m2);
        } else if (b.type === 'triple') {
          const off = 0.24;
          const perp = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
          for (const s of [-off, 0, off]) {
            const m = mkCyl(bondR * 0.75, p1.clone().addScaledVector(perp, s), p2.clone().addScaledVector(perp, s), bondMatDark);
            if (m) this.bondGroup.add(m);
          }
        }
      }

      // C-H / O-H / N-H bonds
      for (const h of hList) {
        if (h.parentId === undefined) continue;
        const pp = activePos.get(h.parentId);
        if (!pp) continue;
        const m = mkCyl(bondR * 0.8, pp, h.pos, bondMatH);
        if (m) this.bondGroup.add(m);
      }
    }
  }
}

// ==================== 2D EDITOR RENDERER ====================
class Renderer2D {
  constructor(canvas, mol) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.mol = mol;
    this.scale = 1;
    this.ox = 0;
    this.oy = 0;
    this.targetScale = 1;
    this.targetOx = 0;
    this.targetOy = 0;
    this.atomR = 22;      // uniform atom circle radius
    this.fgAtomR = 14;    // FG sub-atom radius
    this.lw = 3.0;        // bond line width
    this.bondLen = 38;    // FG and H bond length in editor coords
    this._animFrame = null;
    this.selFgAtomId = null;
    this.selFgIndex = null;
    this._fgDisplay = [];
    this._startAnimLoop();
  }

  resize() {
    const p = this.canvas.parentElement;
    const r = p.getBoundingClientRect();
    this.canvas.width = r.width * window.devicePixelRatio;
    this.canvas.height = r.height * window.devicePixelRatio;
    this.canvas.style.width = r.width + 'px';
    this.canvas.style.height = r.height + 'px';
    this.ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
  }

  _startAnimLoop() {
    this._onAnimFrame = null;
    const tick = () => {
      this._animFrame = requestAnimationFrame(tick);
      let dirty = false;
      const lerp = 0.18;
      if (Math.abs(this.targetScale - this.scale) > 0.001) { this.scale += (this.targetScale - this.scale) * lerp; dirty = true; }
      if (Math.abs(this.targetOx - this.ox) > 0.5) { this.ox += (this.targetOx - this.ox) * lerp; dirty = true; }
      if (Math.abs(this.targetOy - this.oy) > 0.5) { this.oy += (this.targetOy - this.oy) * lerp; dirty = true; }
      if (dirty && this._onAnimFrame) this._onAnimFrame();
    };
    requestAnimationFrame(tick);
  }

  _snapToTarget() {
    this.scale = this.targetScale;
    this.ox = this.targetOx;
    this.oy = this.targetOy;
  }

  _elementRadius(el) {
    return this.atomR; // all atoms same size
  }

  setTarget(scale, ox, oy) {
    this.targetScale = Math.max(0.15, Math.min(6, scale));
    this.targetOx = ox;
    this.targetOy = oy;
  }

  sx(x) { return x * this.scale + this.ox; }
  sy(y) { return y * this.scale + this.oy; }
  ix(sx) { return (sx - this.ox) / this.scale; }
  iy(sy) { return (sy - this.oy) / this.scale; }

  clear() {
    const dpr = window.devicePixelRatio || 1;
    // Reset transform to identity for full-buffer clear
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Fill solid background to prevent transparency stacking
    this.ctx.fillStyle = '#f8f9fa';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    // Re-apply DPR transform for subsequent drawing
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = this.canvas.parentElement.clientWidth;
    const h = this.canvas.parentElement.clientHeight;
    this.ctx.strokeStyle = '#e4e8ec';
    this.ctx.lineWidth = 0.5;
    const gs = 30 * this.scale;
    const sx = this.ox % gs, sy = this.oy % gs;
    for (let x = sx; x < w; x += gs) {
      this.ctx.beginPath(); this.ctx.moveTo(x, 0); this.ctx.lineTo(x, h); this.ctx.stroke();
    }
    for (let y = sy; y < h; y += gs) {
      this.ctx.beginPath(); this.ctx.moveTo(0, y); this.ctx.lineTo(w, y); this.ctx.stroke();
    }
  }

  /** Compute stub directions (2D angles) for an atom's empty bond slots. */
  _stubDirections(atomId) {
    const nbrs = this.mol.getNeighbors(atomId);
    const a = this.mol.atoms.get(atomId);
    if (!a) return { used: [], free: [] };

    // Get existing bond angles (world-space directions from this atom)
    const used = [];
    for (const nb of nbrs) {
      const na = this.mol.atoms.get(nb);
      if (na) {
        const ang = Math.atan2(na.y - a.y, na.x - a.x);
        used.push(ang);
      }
    }
    used.sort((a, b) => a - b);

    const hyb = this.mol.getHybridization(atomId);
    const total = hyb === 'sp3' ? 4 : hyb === 'sp2' ? 3 : 2;
    const nUsed = used.length;
    const nFree = Math.max(0, total - nUsed);

    if (nFree === 0) return { used, free: [] };

    // Compute free slot directions at even angles from the largest gap
    const free = [];
    let baseAngle;
    if (nUsed === 0) {
      baseAngle = 0;
    } else if (nUsed === 1) {
      // One bond: distribute free slots opposite
      const opp = used[0] + Math.PI;
      baseAngle = opp - (Math.PI * (nFree - 1)) / (nFree + 1) * 0.5;
    } else {
      // Find largest angular gap and place free slots there
      let maxGap = 0, gapStart = 0;
      for (let i = 0; i < nUsed; i++) {
        const j = (i + 1) % nUsed;
        let gap = used[j] - used[i];
        if (i === nUsed - 1) gap = used[0] + 2 * Math.PI - used[i];
        if (gap > maxGap) { maxGap = gap; gapStart = used[i]; }
      }
      baseAngle = gapStart + maxGap / (nFree + 1);
    }

    for (let i = 0; i < nFree; i++) {
      free.push(baseAngle + (2 * Math.PI * i) / (nFree || 1));
    }

    return { used, free };
  }

  /** Render a full-structure FG at a given stub direction from the parent atom.
   *  Returns display data for hit testing: { fgIndex, pos: {x,y}, subAtoms: [{x,y,el}] }. */
  _renderFGStructure(atomX, atomY, freeAng, fgType, fgIndex, isSelected) {
    const ctx = this.ctx;
    const d = this.bondLen * this.scale * 1.0;
    const cosA = Math.cos(freeAng), sinA = Math.sin(freeAng);
    const ox = atomX + d * cosA, oy = atomY + d * sinA;
    const sel = isSelected;
    const hl = sel ? '#e74c3c' : null;

    // FG structure definitions — bonds FIRST, then atoms on top
    const fgs = {
      OH: () => {
        // C — O — H  (bent)
        const hAng1 = freeAng + 0.9; // ~52° bend
        const hx = ox + d * 0.6 * Math.cos(hAng1), hy = oy + d * 0.6 * Math.sin(hAng1);
        this._drawBondLine(atomX, atomY, ox, oy, 'single', hl);
        this._drawBondLine(ox, oy, hx, hy, 'single', hl);
        this._drawAtomAt(ox, oy, 'O', sel);
        this._drawAtomAt(hx, hy, 'H', sel);
        return { pos: { x: ox, y: oy }, subAtoms: [{ x: hx, y: hy, el: 'H' }], el: 'O' };
      },
      NH2: () => {
        // C — N  with H H
        this._drawBondLine(atomX, atomY, ox, oy, 'single', hl);
        const subAtoms = [];
        for (const ha of [freeAng + 1.1, freeAng - 1.1]) {
          const hx = ox + d * 0.55 * Math.cos(ha), hy = oy + d * 0.55 * Math.sin(ha);
          this._drawBondLine(ox, oy, hx, hy, 'single', hl);
          subAtoms.push({ x: hx, y: hy, el: 'H' });
        }
        this._drawAtomAt(ox, oy, 'N', sel);
        for (const ha of [freeAng + 1.1, freeAng - 1.1]) {
          const hx = ox + d * 0.55 * Math.cos(ha), hy = oy + d * 0.55 * Math.sin(ha);
          this._drawAtomAt(hx, hy, 'H', sel);
        }
        return { pos: { x: ox, y: oy }, subAtoms, el: 'N' };
      },
      CO: () => {
        // C == O  (double bond)
        this._drawBondLine(atomX, atomY, ox, oy, 'double', hl);
        this._drawAtomAt(ox, oy, 'O', sel);
        return { pos: { x: ox, y: oy }, subAtoms: [], el: 'O' };
      },
      CHO: () => {
        // C == O   and   C — H
        const hAng2 = freeAng + Math.PI * 0.7;
        const hx2 = atomX + d * 0.55 * Math.cos(hAng2), hy2 = atomY + d * 0.55 * Math.sin(hAng2);
        this._drawBondLine(atomX, atomY, ox, oy, 'double', hl);
        this._drawBondLine(atomX, atomY, hx2, hy2, 'single', hl);
        this._drawAtomAt(ox, oy, 'O', sel);
        this._drawAtomAt(hx2, hy2, 'H', sel);
        return { pos: { x: ox, y: oy }, subAtoms: [{ x: hx2, y: hy2, el: 'H' }], el: 'O' };
      },
      COOH: () => {
        // C == O  and  C — O — H
        const oAng2 = freeAng + Math.PI * 0.7;
        const ox2 = atomX + d * Math.cos(oAng2), oy2 = atomY + d * Math.sin(oAng2);
        const hx2 = ox2 + d * 0.55 * Math.cos(oAng2 + 0.9);
        const hy2 = oy2 + d * 0.55 * Math.sin(oAng2 + 0.9);
        this._drawBondLine(atomX, atomY, ox, oy, 'double', hl);
        this._drawBondLine(atomX, atomY, ox2, oy2, 'single', hl);
        this._drawBondLine(ox2, oy2, hx2, hy2, 'single', hl);
        this._drawAtomAt(ox, oy, 'O', sel);
        this._drawAtomAt(ox2, oy2, 'O', sel);
        this._drawAtomAt(hx2, hy2, 'H', sel);
        return { pos: { x: ox, y: oy }, subAtoms: [{ x: ox2, y: oy2, el: 'O' }, { x: hx2, y: hy2, el: 'H' }], el: 'O' };
      },
      CN: () => {
        // C ≡ N
        this._drawBondLine(atomX, atomY, ox, oy, 'triple', hl);
        this._drawAtomAt(ox, oy, 'N', sel);
        return { pos: { x: ox, y: oy }, subAtoms: [], el: 'N' };
      },
      NO2: () => {
        // C — N  with two =O
        this._drawBondLine(atomX, atomY, ox, oy, 'single', hl);
        const subAtoms = [];
        for (const ha of [freeAng + 0.8, freeAng - 0.8]) {
          const nox = ox + d * 0.55 * Math.cos(ha), noy = oy + d * 0.55 * Math.sin(ha);
          this._drawBondLine(ox, oy, nox, noy, 'double', hl);
          subAtoms.push({ x: nox, y: noy, el: 'O' });
        }
        this._drawAtomAt(ox, oy, 'N', sel);
        for (const ha of [freeAng + 0.8, freeAng - 0.8]) {
          const nox = ox + d * 0.55 * Math.cos(ha), noy = oy + d * 0.55 * Math.sin(ha);
          this._drawAtomAt(nox, noy, 'O', sel);
        }
        return { pos: { x: ox, y: oy }, subAtoms, el: 'N' };
      },
      Ph: () => {
        // Draw small phenyl icon: a regular hexagon
        this._drawBondLine(atomX, atomY, ox, oy, 'single', hl);
        const R = this.fgAtomR * 1.2;
        ctx.strokeStyle = hl || '#2d3436';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = Math.PI * 2 / 6 * i;
          const px = ox + R * Math.cos(a), py = oy + R * Math.sin(a);
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath(); ctx.stroke();
        return { pos: { x: ox, y: oy }, subAtoms: [], el: 'Ph' };
      },
    };

    const fn = fgs[fgType];
    if (fn) return fn();
    // Unknown FG: just draw label
    const label = fgType;
    ctx.font = "bold 10px \"Times New Roman\", serif";
    ctx.fillStyle = hl || '#c05515';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, ox, oy);
    this._drawBondLine(atomX, atomY, ox, oy, 'single', hl);
    return { pos: { x: ox, y: oy }, subAtoms: [], el: '?' };
  }

  _drawAtomAt(x, y, el, sel) {
    const ctx = this.ctx;
    const r = el === 'H' ? this.fgAtomR * 0.7 : this.fgAtomR;
    const elCol = {
      C: '#404040', H: '#aaa', N: '#1848F0', O: '#EE1010',
      S: '#c8a800', F: '#50b840', Cl: '#18b018', Br: '#882222',
      I: '#8B008B', P: '#e07020',
    };

    ctx.fillStyle = elCol[el] || '#666';
    if (sel) {
      ctx.strokeStyle = '#e74c3c'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(x, y, r + 2, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();

    // Element label
    if (el !== 'H') {
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${el === 'Ph' ? 9 : 10}px "Times New Roman", serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(el === 'Ph' ? 'Ph' : el, x, y);
    }
  }

  _drawBondLine(x1, y1, x2, y2, type, hlColor) {
    const ctx = this.ctx;
    const dx = x2 - x1, dy = y2 - y1, len = Math.sqrt(dx * dx + dy * dy) || 1;
    const ux = -dy / len, uy = dx / len;
    ctx.strokeStyle = hlColor || '#2d3436';
    ctx.lineCap = 'round';
    ctx.lineWidth = this.lw;

    if (type === 'single') {
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    } else if (type === 'double') {
      const off = 3.5;
      ctx.beginPath(); ctx.moveTo(x1 + ux * off, y1 + uy * off); ctx.lineTo(x2 + ux * off, y2 + uy * off); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x1 - ux * off, y1 - uy * off); ctx.lineTo(x2 - ux * off, y2 - uy * off); ctx.stroke();
    } else if (type === 'triple') {
      const off = 4.5;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x1 + ux * off, y1 + uy * off); ctx.lineTo(x2 + ux * off, y2 + uy * off); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x1 - ux * off, y1 - uy * off); ctx.lineTo(x2 - ux * off, y2 - uy * off); ctx.stroke();
    }
  }

  render(selId = null, hoverId = null, bondFromId = null) {
    this.clear();
    this._fgDisplay = [];

    const ctx = this.ctx;
    if (this.mol.isEmpty()) return;

    // ====== 1. Draw ALL bonds (X-X and X-H) BEFORE atoms ======
    const drawn = new Set();
    for (const b of this.mol.bonds) {
      const f = this.mol.atoms.get(b.a), t = this.mol.atoms.get(b.b);
      if (!f || !t) continue;
      // X-H bonds: compute H position dynamically from parent direction
      if (f.el === 'H' || t.el === 'H') {
        const parent = f.el === 'H' ? t : f;
        const hAtom = f.el === 'H' ? f : t;
        const ang = Math.atan2(hAtom.y - parent.y, hAtom.x - parent.x);
        const hDist = this.bondLen;
        const hx = parent.x + hDist * Math.cos(ang);
        const hy = parent.y + hDist * Math.sin(ang);
        const pSx = this.sx(parent.x), pSy = this.sy(parent.y);
        const hSx = this.sx(hx), hSy = this.sy(hy);
        // Start from parent circle edge
        const sxAdj = pSx + this.atomR * Math.cos(ang);
        const syAdj = pSy + this.atomR * Math.sin(ang);
        const hRx = this.fgAtomR * 0.75; // H circle radius
        ctx.strokeStyle = '#2d3436'; ctx.lineWidth = this.lw * 0.7; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(sxAdj, syAdj); ctx.lineTo(hSx - hRx * Math.cos(ang), hSy - hRx * Math.sin(ang)); ctx.stroke();
        continue;
      }
      // X-X bonds: draw from circle edge to circle edge (tight, no gap)
      const fR = this._elementRadius(f.el), tR = this._elementRadius(t.el);
      const fSx = this.sx(f.x), fSy = this.sy(f.y);
      const tSx = this.sx(t.x), tSy = this.sy(t.y);
      const dx = tSx - fSx, dy = tSy - fSy, len = Math.sqrt(dx * dx + dy * dy) || 1;
      const ux = dx / len, uy = dy / len;
      this._drawBondLine(
        fSx + ux * fR, fSy + uy * fR,
        tSx - ux * tR, tSy - uy * tR,
        b.type, null);
      drawn.add(b.a + '-' + b.b); drawn.add(b.b + '-' + b.a);
    }

    // ====== 1.5. Draw FG bonds/lines BEFORE atoms (so circles cover bond ends) ======
    for (const [id, a] of this.mol.atoms) {
      if (a.el === 'H' || a.fgs.length === 0) continue;
      const sx = this.sx(a.x), sy = this.sy(a.y);
      const stubs = this._stubDirections(id);
      const isSel = id === selId;
      for (let fi = 0; fi < a.fgs.length && fi < stubs.free.length; fi++) {
        const selFg = isSel && this.selFgAtomId === id && this.selFgIndex === fi;
        const disp = this._renderFGStructure(sx, sy, stubs.free[fi], a.fgs[fi], fi, selFg);
        this._fgDisplay.push({ atomId: id, fgIndex: fi, type: a.fgs[fi], ...disp });
      }
    }

    // ====== 2. Draw atoms: C with stubs, heteroatoms with labels ======
    for (const [id, a] of this.mol.atoms) {
      const sx = this.sx(a.x), sy = this.sy(a.y);
      const isSel = id === selId, isHov = id === hoverId;
      const isBondSrc = id === bondFromId;
      const isC = (a.el === 'C' && a.fgs.length === 0);
      if (a.el === 'H') continue; // H rendered dynamically below

      if (isC) {
        // --- Carbon: draw stub bonds ---
        const stubs = this._stubDirections(id);

        // Draw used stub lines from the circle edge outward
        const stubStart = this.atomR;
        const stubEnd = this.atomR + 10;
        for (let i = 0; i < stubs.used.length; i++) {
          const ang = stubs.used[i];
          const ex1 = sx + stubStart * Math.cos(ang);
          const ey1 = sy + stubStart * Math.sin(ang);
          const ex2 = sx + stubEnd * Math.cos(ang);
          const ey2 = sy + stubEnd * Math.sin(ang);
          ctx.strokeStyle = '#2d3436'; ctx.lineWidth = this.lw; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(ex1, ey1); ctx.lineTo(ex2, ey2); ctx.stroke();
        }
        // Draw free stub lines (dashed) — only when carbon is selected
        if (isSel) {
          for (let i = 0; i < stubs.free.length; i++) {
            const ang = stubs.free[i];
            const ex1 = sx + stubStart * Math.cos(ang);
            const ey1 = sy + stubStart * Math.sin(ang);
            const ex2 = sx + stubEnd * Math.cos(ang);
            const ey2 = sy + stubEnd * Math.sin(ang);
            ctx.strokeStyle = '#c0c5cc';
            ctx.lineWidth = 1.4;
            ctx.setLineDash([3, 4]);
            ctx.beginPath(); ctx.moveTo(ex1, ey1); ctx.lineTo(ex2, ey2); ctx.stroke();
            ctx.setLineDash([]);
          }
        }

        // Draw C circle — same size as heteroatoms for uniform look
        const cr = this.atomR;
        const elColC = '#404040';
        ctx.fillStyle = isBondSrc ? '#4f46e5' : (isSel ? '#e74c3c' : elColC);
        ctx.beginPath(); ctx.arc(sx, sy, cr, 0, Math.PI * 2); ctx.fill();

        // Bond-source indicator ring
        if (isBondSrc) {
          ctx.strokeStyle = '#818cf8'; ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.arc(sx, sy, cr + 5, 0, Math.PI * 2); ctx.setLineDash([4, 2]); ctx.stroke();
          ctx.setLineDash([]);
        } else if (isSel) {
          ctx.strokeStyle = '#e74c3c'; ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.arc(sx, sy, cr + 3, 0, Math.PI * 2); ctx.stroke();
        }

        // Label
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 16px "Times New Roman", serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('C', sx, sy);

      } else {
        // --- Heteroatom ---
        const elCol = {
          C: '#404040', N: '#1848F0', O: '#EE1010', S: '#c8a800',
          F: '#50b840', Cl: '#18b018', Br: '#882222', I: '#8B008B', P: '#e07020',
        };
        const r = this.atomR;

        ctx.fillStyle = elCol[a.el] || '#666';
        ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();

        if (isSel) {
          ctx.strokeStyle = '#e74c3c'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(sx, sy, r + 2, 0, Math.PI * 2); ctx.stroke();
        } else if (isHov) {
          ctx.strokeStyle = '#4f46e5'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(sx, sy, r + 2, 0, Math.PI * 2); ctx.stroke();
        }

        ctx.fillStyle = '#fff';
        ctx.font = 'bold 16px "Times New Roman", serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(a.el, sx, sy);
      }

      // ====== 2b. Draw H circles (bonds already drawn in section 1) ======
      const hNbrIds = this.mol.getNeighbors(id).filter(nb => { const nbA = this.mol.atoms.get(nb); return nbA && nbA.el === 'H'; });
      if (hNbrIds.length > 0) {
        // Recompute free-slot position for each H (same logic as section 1)
        const usedAngles = [];
        for (const nbId of this.mol.getNeighbors(id)) {
          const nb = this.mol.atoms.get(nbId);
          if (nb && nb.el !== 'H') usedAngles.push(Math.atan2(nb.y - a.y, nb.x - a.x));
        }
        usedAngles.sort((a, b) => a - b);
        const hyb = this.mol.getHybridization(id);
        const totalSlots = hyb === 'sp3' ? 4 : hyb === 'sp2' ? 3 : 2;
        const freeAngles = [];
        if (usedAngles.length === 0) {
          for (let i = 0; i < Math.min(hNbrIds.length, totalSlots); i++)
            freeAngles.push((2 * Math.PI * i) / totalSlots);
        } else {
          let maxGap = 0, gapStart = usedAngles[0];
          for (let i = 0; i < usedAngles.length; i++) {
            const j = (i + 1) % usedAngles.length;
            let gap = usedAngles[j] - usedAngles[i];
            if (i === usedAngles.length - 1) gap = usedAngles[0] + 2 * Math.PI - usedAngles[i];
            if (gap > maxGap) { maxGap = gap; gapStart = usedAngles[i]; }
          }
          if (usedAngles.length === 1) maxGap = 2 * Math.PI;
          const need = Math.min(hNbrIds.length, totalSlots - usedAngles.length);
          for (let i = 0; i < need; i++)
            freeAngles.push(gapStart + maxGap * (i + 1) / (need + 1));
        }
        for (let i = 0; i < Math.min(hNbrIds.length, freeAngles.length); i++) {
          const ang = freeAngles[i];
          const hx = a.x + this.bondLen * Math.cos(ang);
          const hy = a.y + this.bondLen * Math.sin(ang);
          const hSx = this.sx(hx), hSy = this.sy(hy);
          const hr = this.fgAtomR * 0.75;
          ctx.fillStyle = '#aaa';
          ctx.beginPath(); ctx.arc(hSx, hSy, hr, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#fff'; ctx.font = 'bold 9px "Times New Roman", serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText('H', hSx, hSy);
        }
      }
    }
  }

  /** Hit test for FG display elements. Returns { atomId, fgIndex } or null. */
  hitTestFG(sx, sy) {
    const r = this.fgAtomR + 4;
    for (const fd of this._fgDisplay) {
      const p = fd.pos;
      if ((sx - p.x) ** 2 + (sy - p.y) ** 2 < r * r) return { atomId: fd.atomId, fgIndex: fd.fgIndex };
      for (const sa of fd.subAtoms) {
        if ((sx - sa.x) ** 2 + (sy - sa.y) ** 2 < r * r) return { atomId: fd.atomId, fgIndex: fd.fgIndex };
      }
    }
    return null;
  }

  /** Hit test for stub (dashed) lines. Returns { atomId } or null. */
  hitTestStub(sx, sy) {
    const threshold = 14;
    const stubStart = this.atomR;
    const stubEnd = this.atomR + 10;
    for (const [id, a] of this.mol.atoms) {
      const ax = this.sx(a.x), ay = this.sy(a.y);
      const stubs = this._stubDirections(id);

      for (const ang of stubs.free) {
        const ex1 = ax + stubStart * Math.cos(ang), ey1 = ay + stubStart * Math.sin(ang);
        const ex2 = ax + stubEnd   * Math.cos(ang), ey2 = ay + stubEnd   * Math.sin(ang);
        const dx = ex2 - ex1, dy = ey2 - ey1;
        const lenSq = dx * dx + dy * dy;
        let t = ((sx - ex1) * dx + (sy - ey1) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
        const cx = ex1 + t * dx, cy = ey1 + t * dy;
        const dist = Math.sqrt((sx - cx) ** 2 + (sy - cy) ** 2);
        if (dist < threshold) return id;
      }
    }
    return null;
  }
}

// ==================== SYNTHESIS FLOWCHART RENDERER ====================
function renderFlowchart(pathway, targetFormula, canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const stepH = 100, padding = 30, w = 860;
  const totalH = pathway.length * stepH + 80;
  canvas.width = w; canvas.height = totalH;
  canvas.style.width = '100%'; canvas.style.height = 'auto';
  ctx.clearRect(0, 0, w, totalH);

  ctx.fillStyle = '#f8f9fa';
  ctx.beginPath(); ctx.roundRect(0, 0, w, totalH, 12); ctx.fill();

  const cx = w / 2;

  for (let i = 0; i < pathway.length; i++) {
    const y = padding + i * stepH + 20;
    const boxW = Math.min(ctx.measureText(pathway[i].desc).width + 40, 300);

    // Molecule box
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#d0d5dd'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(cx - boxW / 2, y, boxW, 40, 6); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#1a1d23'; ctx.font = '600 13px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(pathway[i].desc, cx, y + 20);

    // Step number
    if (i === 0) {
      ctx.fillStyle = '#10b981';
      ctx.beginPath(); ctx.arc(cx - boxW / 2 - 16, y + 20, 12, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 11px sans-serif';
      ctx.fillText('S', cx - boxW / 2 - 16, y + 22);
    } else {
      ctx.fillStyle = '#4f46e5';
      ctx.beginPath(); ctx.arc(cx - boxW / 2 - 16, y + 20, 12, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 11px sans-serif';
      ctx.fillText(i, cx - boxW / 2 - 16, y + 22);
    }

    // Arrow and conditions
    if (i < pathway.length - 1) {
      const ay = y + 50;
      ctx.strokeStyle = '#4f46e5'; ctx.lineWidth = 2; ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(cx, ay - 10); ctx.lineTo(cx, ay + 22); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - 6, ay + 15); ctx.lineTo(cx, ay + 25); ctx.lineTo(cx + 6, ay + 15); ctx.stroke();
      ctx.fillStyle = '#4f46e5'; ctx.font = '12px sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(pathway[i + 1].reagent || '', cx + 12, ay + 4);
      ctx.fillStyle = '#888'; ctx.font = '11px sans-serif';
      ctx.fillText(pathway[i + 1].condition || '', cx + 12, ay + 20);
    }
  }

  // Target product
  const lastY = padding + pathway.length * stepH + 20;
  ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 3; ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(cx, lastY - 10); ctx.lineTo(cx, lastY + 20); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx - 8, lastY + 12); ctx.lineTo(cx, lastY + 25); ctx.lineTo(cx + 8, lastY + 12); ctx.stroke();

  const tW = Math.min(ctx.measureText('目标: ' + targetFormula).width + 50, 320);
  const grad = ctx.createLinearGradient(cx - tW / 2, lastY + 25, cx + tW / 2, lastY + 65);
  grad.addColorStop(0, '#4f46e5'); grad.addColorStop(1, '#7c3aed');
  ctx.fillStyle = grad; ctx.strokeStyle = '#4338ca'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(cx - tW / 2, lastY + 25, tW, 40, 8); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('★ ' + targetFormula, cx, lastY + 45);

  ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
}

// ==================== POLYFILL ====================
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    if (typeof r === 'number') r = { tl: r, tr: r, br: r, bl: r };
    this.beginPath();
    this.moveTo(x + r.tl, y);
    this.lineTo(x + w - r.tr, y);
    this.quadraticCurveTo(x + w, y, x + w, y + r.tr);
    this.lineTo(x + w, y + h - r.br);
    this.quadraticCurveTo(x + w, y + h, x + w - r.br, y + h);
    this.lineTo(x + r.bl, y + h);
    this.quadraticCurveTo(x, y + h, x, y + h - r.bl);
    this.lineTo(x, y + r.tl);
    this.quadraticCurveTo(x, y, x + r.tl, y);
    this.closePath();
  };
}
