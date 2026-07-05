// ==================== RDKit.js Renderer Wrapper ====================
// Professional chemical structure rendering via RDKit WebAssembly.
// Only used for the thumbnail panel; synthesis paths still use SkeletalFormula.

let rdkitModule = null;
let rdkitReady = false;
let rdkitInitPromise = null;
let rdkitInitDone = false;
const pendingRenders = [];

// Async WASM initialization
window.initRdkit = async function initRdkit() {
  if (rdkitInitDone) return;
  if (rdkitInitPromise) return rdkitInitPromise;

  rdkitInitPromise = new Promise((resolve, reject) => {
    const check = setInterval(() => {
      if (typeof initRDKitModule !== 'undefined') {
        clearInterval(check);
        finishInit(resolve, reject);
      }
    }, 100);
    setTimeout(() => {
      clearInterval(check);
      reject(new Error('RDKit.js load timeout'));
    }, 30000);
  });
  return rdkitInitPromise;
};

function finishInit(resolve, reject) {
  initRDKitModule({
    locateFile: (path) => {
      // Point to local wasm file
      if (path.endsWith('.wasm')) return 'rdkit/' + path;
      return path;
    },
  })
    .then(mod => {
      rdkitModule = mod;
      rdkitReady = true;
      rdkitInitDone = true;
      // Replay any pending renders
      const copy = pendingRenders.slice();
      pendingRenders.length = 0;
      copy.forEach(fn => { try { fn(); } catch(e) { console.warn('Pending render:', e); } });
      resolve();
    })
    .catch(err => {
      console.error('RDKit init failed:', err);
      reject(err);
    });
}

// Render a SMILES string to a Canvas element using draw_to_canvas
window.rdkitRenderSmiles = function rdkitRenderSmiles(smiles, canvas, options = {}) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!smiles || smiles.trim() === '') {
    ctx.fillStyle = '#888';
    ctx.font = '14px "Times New Roman", serif';
    ctx.textAlign = 'center';
    ctx.fillText('无分子', canvas.width / 2, canvas.height / 2);
    return;
  }

  if (!rdkitReady) {
    // Queue for replay when RDKit finishes loading
    const fn = () => window.rdkitRenderSmiles(smiles, canvas, options);
    pendingRenders.push(fn);
    ctx.fillStyle = '#888';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('RDKit 加载中…', canvas.width / 2, canvas.height / 2);
    return;
  }

  let mol = null;
  try {
    mol = rdkitModule.get_mol(smiles);
    if (!mol || !mol.is_valid()) throw new Error('Invalid SMILES: ' + smiles);

    // Direct canvas rendering — simple and reliable
    mol.draw_to_canvas(canvas, -1, -1);
  } catch (e) {
    console.error('RDKit render error:', e);
    ctx.fillStyle = '#999';
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(smiles, canvas.width / 2, canvas.height / 2);
  } finally {
    if (mol) mol.delete();
  }
};

// Render a Molecule instance to a Canvas (used by renderThumbnail)
window.rdkitRenderMol = function rdkitRenderMol(mol, canvas, options = {}) {
  const smiles = mol.toSmiles ? mol.toSmiles() : null;
  if (smiles) {
    window.rdkitRenderSmiles(smiles, canvas, options);
  } else {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#888';
    ctx.font = '14px "Times New Roman", serif';
    ctx.textAlign = 'center';
    ctx.fillText('无分子', canvas.width / 2, canvas.height / 2);
  }
};
