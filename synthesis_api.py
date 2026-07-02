"""
OrChem Synthesis API
Retrosynthetic analysis using RDKit SMARTS/SMIRKS and Recursive AND/OR search.
Reaction rules, reagents, conditions, and starting materials are in reaction_rules.py.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from rdkit import Chem
from rdkit.Chem import AllChem
import logging

# Suppress RDKit warnings
logging.getLogger("rdkit").setLevel(logging.ERROR)

from reaction_rules import (
    RETRO_RULES, STARTING_MATERIALS, CONDITIONS,
    get_reagent, get_condition, canonical, is_starting_material
)

app = FastAPI(title="OrChem Synthesis API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


class SynthesisRequest(BaseModel):
    target_smiles: str
    max_steps: int = 6


class TestRuleRequest(BaseModel):
    rule_name: str
    test_smiles: str


@app.post("/test_rule")
def test_rule(req: TestRuleRequest):
    """测试单个反应规则是否匹配给定分子"""
    mol = Chem.MolFromSmiles(req.test_smiles)
    if not mol:
        return {"status": "error", "message": "Invalid SMILES"}

    rxn = RETRO_RULES.get(req.rule_name)
    if not rxn:
        return {"status": "error", "message": f"Rule not found: {req.rule_name}"}

    try:
        products_list = rxn.RunReactants((mol,))
        if products_list and len(products_list) > 0:
            results = []
            for i, products in enumerate(products_list):
                frags = []
                for p in products:
                    try:
                        Chem.SanitizeMol(p)
                        sm = canonical(Chem.MolToSmiles(p))
                        frags.append(sm)
                    except Exception as e:
                        frags.append(f"invalid: {e}")
                results.append(frags)
            return {"status": "success", "matches": len(products_list), "products": results[:5]}
        else:
            return {"status": "success", "matches": 0, "products": []}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.post("/debug_synthesis")
def debug_synthesis(req: SynthesisRequest):
    """调试模式：返回单步逆向合成的所有可能前体"""
    target_mol = Chem.MolFromSmiles(req.target_smiles)
    if not target_mol:
        return {"status": "error", "message": "Invalid SMILES"}

    target_canon = canonical(req.target_smiles)
    precursors = get_precursors(target_canon, max_results=10, debug=True)

    return {"status": "success", "target": target_canon, "precursors": precursors}


@app.get("/list_rules")
def list_rules():
    """列出所有可用的反应规则"""
    rules_info = []
    for name in RETRO_RULES:
        rule_info = CONDITIONS.get(name, "未知反应")
        rules_info.append({"name": name, "description": rule_info})
    return {"status": "success", "rules": rules_info}


@app.get("/list_starting_materials")
def list_starting_materials():
    """列出所有基础原料"""
    return {"status": "success", "materials": STARTING_MATERIALS}


@app.post("/synthesize")
def synthesize(req: SynthesisRequest):
    target_mol = Chem.MolFromSmiles(req.target_smiles)
    if not target_mol:
        return {"status": "error", "message": "Invalid SMILES"}

    target_canon = canonical(req.target_smiles)

    # Time-bounded search (增加超时时间到30秒)
    from concurrent.futures import ThreadPoolExecutor, TimeoutError
    paths = []
    with ThreadPoolExecutor(max_workers=1) as ex:
        fut = ex.submit(find_synthesis_paths, target_canon, 0, req.max_steps, set())
        try:
            paths = fut.result(timeout=30)  # 从15秒增加到30秒
        except TimeoutError:
            paths = []

    if paths:
        paths.sort(key=len)
        return {"status": "success", "paths": paths[:3]}

    return {"status": "success", "paths": []}


def get_precursors(target_smiles: str, max_results: int = 4, debug: bool = False):
    """安全地获取单步逆向反应的所有可能前体，最多返回 max_results 个唯一结果"""
    mol = Chem.MolFromSmiles(target_smiles)
    if not mol:
        return []

    results = []
    # Prioritize: oxidation/reduction/hydration first (core rules), then others
    priority_rules = [
        "Esterification", "Aldehyde_Oxidation", "Pri_Alcohol_Oxidation",
        "Sec_Alcohol_Oxidation", "Alkene_Hydration", "Alkane_Halogenation",
        "Alkene_Dihalogenation", "Cyanohydrin_Formation",
        "Alpha_Hydroxyacid_Nitrile", "Nitrile_Hydrolysis",
        "Aromatic_Halogenation", "Nitration", "Nitro_Reduction",
        "Phenol_Deoxygenation", "Aromatic_Decarboxylation",
        "Friedel_Crafts_Alkylation", "Friedel_Crafts_Acylation",
        "Kolbe_Schmitt", "Sidechain_Halogenation",
        "Alkylbenzene_Oxidation",
    ]
    remaining_rules = [k for k in RETRO_RULES if k not in priority_rules]
    ordered_rules = priority_rules + remaining_rules

    if debug:
        print(f"[DEBUG] 目标分子: {target_smiles}")
        print(f"[DEBUG] 尝试 {len(ordered_rules)} 个规则")

    for rule_name in ordered_rules:
        rxn = RETRO_RULES.get(rule_name)
        if not rxn:
            continue
        if rxn.GetNumReactantTemplates() > 1:
            continue
        try:
            products_list = rxn.RunReactants((mol,))
        except Exception as e:
            if debug:
                print(f"[DEBUG] 规则 {rule_name} 执行出错: {e}")
            continue

        if products_list and len(products_list) > 0:
            if debug:
                print(f"[DEBUG] 规则 {rule_name} 匹配成功，找到 {len(products_list)} 个产物组合")

            for products in products_list:
                # Early exit: don't let one molecule spawn too many options
                if len(results) >= max_results + 5:
                    break
                valid = True
                frags = []
                for p in products:
                    try:
                        Chem.SanitizeMol(p)
                        sm = canonical(Chem.MolToSmiles(p))
                        if not sm:
                            valid = False
                            break
                        frags.append(sm)
                    except Exception:
                        valid = False
                        break
                if valid:
                    results.append({"rule": rule_name, "precursors": frags})
                    if debug:
                        print(f"[DEBUG]   添加前体: {frags}")
        else:
            if debug:
                print(f"[DEBUG] 规则 {rule_name} 无匹配")

    # 结果去重
    unique_results, seen = [], set()
    for r in results:
        key = tuple(sorted(r["precursors"]))
        if key not in seen:
            seen.add(key)
            unique_results.append(r)
            if len(unique_results) >= max_results:
                break

    if debug:
        print(f"[DEBUG] 返回 {len(unique_results)} 个唯一结果")

    return unique_results


def find_synthesis_paths(target_smiles: str, depth: int, max_depth: int, visited: set) -> list:
    """递归 DFS 搜索，按【时间正向】组装路径"""
    target_smiles = canonical(target_smiles)
    if is_starting_material(target_smiles):
        return [[]]
    if depth >= max_depth or target_smiles in visited:
        return []

    visited.add(target_smiles)
    valid_paths = []

    for rxn in get_precursors(target_smiles):
        # Stop early once we found enough paths
        if len(valid_paths) >= 2:
            break
        rule_name = rxn["rule"]
        precursors = rxn["precursors"]

        all_frags_solvable = True
        branch_paths = []

        for frag in precursors:
            frag_paths = find_synthesis_paths(frag, depth + 1, max_depth, visited.copy())
            if not frag_paths:
                all_frags_solvable = False
                break
            branch_paths.extend(frag_paths[0])

        if all_frags_solvable:
            step = {
                "precursors": ".".join(precursors),
                "product": target_smiles,
                "rule": rule_name,
                "reagent": get_reagent(rule_name),
                "condition": get_condition(rule_name),
            }
            full_path = branch_paths + [step]
            valid_paths.append(full_path)

    return valid_paths

from fastapi.staticfiles import StaticFiles
from pathlib import Path
STATIC_DIR = Path(__file__).parent
app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=18002)
