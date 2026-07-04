// ==================== SYNTHESIS ENGINE (Client) ====================

class SynthesisEngine {
  constructor(apiEndpoint = "http://localhost:18002/synthesize") {
    this.apiEndpoint = apiEndpoint;
  }

  async inferPath(targetMol) {
    const targetSmiles = targetMol.toSmiles();
    if (!targetSmiles) { console.warn("Cannot generate SMILES"); return null; }
    console.log('[Synth] Sending SMILES:', targetSmiles);

    try {
      const resp = await fetch(this.apiEndpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_smiles: targetSmiles, max_steps: 6 }),
      });
      if (!resp.ok) { console.error("API error:", resp.status); return null; }
      const data = await resp.json();
      console.log('[Synth] API response:', data.status, 'paths:', data.paths?.length || 0);
      if (data.status === "success" && data.paths && data.paths.length > 0) {
        // New API already returns paths in forward chronological order
        return data.paths;
      }
      return null;
    } catch (e) { console.error("Synthesis failed:", e); return null; }
  }

  static smilesToMolecule(smiles) {
    if (!smiles) return new Molecule();
    const mol = Molecule.fromSmiles(smiles.replace(/\./g, ""));
    mol.kekulize();
    return mol;
  }
}
