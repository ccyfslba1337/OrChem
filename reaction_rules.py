"""
reaction_rules.py — 高中有机化学逆向合成反应规则库
===========================================================================
独立的规则文件，集中管理所有反应 SMIRKS、试剂、条件、基础原料。
修改或新增反应机理时只需编辑此文件，synthesis_api.py 无需变更。
所有规则均为逆向(Retrosynthetic)方向：产物(复杂分子) >> 前体(简单分子)。
===========================================================================
"""
import warnings
from rdkit.Chem import AllChem

# ---- 工具函数 ----

def make_rxn(smarts: str):
    """从 SMARTS 字符串创建反应规则（静默映射警告）"""
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return AllChem.ReactionFromSmarts(smarts)

# ===========================================================================
# 1. 逆向反应规则  (SMIRKS:  target(产物) >> precursor(前体) )
#    规则命名：正向反应名称（从实验室角度描述从前体到产物的转变）
#    但 SMIRKS 写法是逆向的（从产物推到前体）
# ===========================================================================

RETRO_RULES = {

    # ─── 酯化 & 酯水解 (Esterification & Hydrolysis) ───
    "Esterification": make_rxn(
        "[#6:1](=[O:2])[O:3][#6:4]>>[#6:1](=[O:2])[OH].[HO:3][#6:4]"
    ),

    # ─── 氧化还原 (Oxidation/Reduction) ───
    "Aldehyde_Oxidation": make_rxn(
        "[CX3:1](=[O:2])[OH]>>[CH1:1]=[O:2]"
    ),
    "Pri_Alcohol_Oxidation": make_rxn(
        "[CH1:1]=[O]>>[CH2:1]-[OH]"
    ),
    "Sec_Alcohol_Oxidation": make_rxn(
        "[#6:3]-[C:1](=[O])-[#6:4]>>[#6:3]-[CH1:1](-[OH])-[#6:4]"
    ),

    # ─── 烯烃水化与消去 (Alkene Hydration & Elimination) ───
    "Alkene_Hydration": make_rxn(
        "[#6:1]-[C:2]-[OH]>>[C:1]=[C:2]"
    ),
    "Alkene_Dehydration": make_rxn(
        "[C:1]=[C:2]>>[C:1]-[C:2]-[OH]"
    ),

    # ─── 炔烃系列 ───
    "Alkyne_Hydration": make_rxn(
        "[#6:1]=[C:2]-[OH]>>[C:1]#[C:2]"
    ),
    "Alkyne_Reduction": make_rxn(
        "[#6:1]#[#6:2]>>[#6:1]=[#6:2]"
    ),

    # ─── 卤代烃系列 (Halogen Chemistry) ───
    # 正向：R-X + NaOH/H₂O → R-OH + NaX
    "Haloalkane_Hydrolysis": make_rxn(
        "[C:1]-[OH]>>[C:1]-[Cl,Br,I]"
    ),
    # 正向：R-H + X₂ → R-X + HX  (光/热，取代)
    "Alkane_Halogenation": make_rxn(
        "[C:1]-[Cl,Br]>>[C:1]"
    ),
    # 正向：C=C + X₂ → X-C-C-X  (加成)
    "Alkene_Dihalogenation": make_rxn(
        "[C:1]-[C:2]>>[C:1]=[C:2]"
    ),
    # 正向：R-CH₂-CH₂-X + NaOH/醇 → R-CH=CH₂ + NaX + H₂O
    "Haloalkane_Elimination": make_rxn(
        "[C:1]=[C:2]>>[C:1]-[C:2]-[Cl,Br,I]"
    ),
    # 正向：醇 + HX → 卤代烃 + H₂O (Lucas试剂)
    "Alcohol_Halogenation": make_rxn(
        "[C:1]-[Cl,Br,I]>>[C:1]-[OH]"
    ),

    # ─── 氰化物系列 (Nitrile/Cyanohydrin Chemistry) ───
    # 正向：R-C≡N + 2H₂O → R-COOH + NH₃ (腈的水解)
    "Nitrile_Hydrolysis": make_rxn(
        "[C:1](=[O])[OH]>>[C:1]#[N]"
    ),
    # 正向：醛/酮 + HCN → 氰醇 (醛酮的亲核加成)
    # Retro: 氰醇(cyanohydrin) → 醛/酮 + HCN
    "Cyanohydrin_Formation": make_rxn(
        "[#6:1]-[C:2](-[OH])-[C:3]#[N]>>[#6:1]-[C:2]=[O].[C:3]#[N]"
    ),
    # α-羟基酸 → 氰醇+水解 → 扩大反应链
    # 正向：腈 + 2H₂O + H⁺ → α-羟基酸 + NH₄⁺ (乳腈法总反应)
    "Alpha_Hydroxyacid_Nitrile": make_rxn(
        "[#6:1]-[C:2](-[OH])-[C:3](=[O])[OH]>>[#6:1]-[C:2](-[OH])-[C:3]#[N]"
    ),

    # ─── 内酯/交酯 (Lactone/Lactide) ───
    # 正向：γ-羟基酸 → γ-内酯 + H₂O  (分子内酯化)
    "Gamma_Lactone": make_rxn(
        "O1[C:1](=[O])[#6:2][#6:3][#6:4]1>>[C:1](=[O])[OH].[OH]-[#6:4]-[#6:3]-[#6:2]"
    ),
    # 正向：δ-羟基酸 → δ-内酯 + H₂O
    "Delta_Lactone": make_rxn(
        "O1[C:1](=[O])[#6:2][#6:3][#6:4][#6:5]1>>[C:1](=[O])[OH].[OH]-[#6:5]-[#6:4]-[#6:3]-[#6:2]"
    ),
    # 正向：β-羟基酸 → α,β-不饱和酸   (分子内脱水)
    "Beta_Hydroxyacid_Dehydration": make_rxn(
        "[#6:3]-[C:4]=[C:1]-[C:2](=[O])[OH]>>[#6:3]-[CH:4](-[OH])-[CH2:1]-[C:2](=[O])[OH]"
    ),
    # 正向：2分子α-羟基酸 → 交酯(六元环) + 2H₂O  (分子间酯化)
    "Dilactide_Formation": make_rxn(
        "O1[C:1](=[O])[#6:3]([CH3])[O:4][C:2](=[O])[#6:5]([CH3])1>>"
        "[#6:3]-[C:1](=[O])[OH].[HO:4]-[C:2](=[O])-[#6:5]"
    ),

    # ─── 醇的性质 (Alcohol Properties) ───
    # 正向：R-OH + Na → R-ONa + ½H₂  (醇与金属钠)
    "Alcohol_Sodium": make_rxn(
        "[C:1]-[OH]>>[C:1]-[O-].[Na+]"
    ),
    # 正向：二醇脱水成环醚 (e.g. 乙二醇→环氧乙烷)
    "Diol_CyclicEther": make_rxn(
        "[O:1]1[#6:2][#6:3]1>>[OH:1]-[#6:2]-[#6:3]-[OH]"
    ),

    # ─── 醚的合成 (Ether Synthesis) ───
    # 正向：R-ONa + R'-X → R-O-R' + NaX  (Williamson合成)
    "Williamson_Ether": make_rxn(
        "[#6:1]-[O:2]-[#6:3]>>[#6:1]-[O:2].[#6:3]-[Cl,Br,I]"
    ),
    # 正向：2R-OH → R-O-R + H₂O  (醇分子间脱水成醚)
    "Ether_From_Alcohol": make_rxn(
        "[#6:1]-[O:2]-[#6:3]>>[#6:1]-[OH:2].[OH]-[#6:3]"
    ),

    # ─── 苯环取代 (Aromatic Substitution) ───
    # 正向：Ar-H + X₂/FeX₃ → Ar-X + HX  (苯环卤代)
    "Aromatic_Halogenation": make_rxn(
        "[c:1]-[Cl,Br]>>[c:1]"
    ),
    # 正向：Ar-H + HNO₃/H₂SO₄ → Ar-NO₂ + H₂O  (硝化)
    "Nitration": make_rxn(
        "[c:1]-[N+:2](=[O])=[O-]>>[c:1]"
    ),
    # 正向：Ar-H + H₂SO₄/SO₃ → Ar-SO₃H  (磺化)
    "Sulfonation": make_rxn(
        "[c:1]-S(=O)(=O)[OH]>>[c:1]"
    ),
    # 正向：Ar-NO₂ + 6[H] → Ar-NH₂ + 2H₂O  (硝基还原)
    "Nitro_Reduction": make_rxn(
        "[c:1]-[NH2:2]>>[c:1]-[N+:2](=[O])=[O-]"
    ),

    # ─── 酚的性质 (Phenol Properties) ───
    # 正向：Ar-OH + NaOH → Ar-ONa + H₂O
    "Phenol_Base": make_rxn(
        "[c:1]-[OH]>>[c:1]-[O-].[Na+]"
    ),
    # 正向：苯酚 → 苯 (酚羟基还原脱氧)
    "Phenol_Deoxygenation": make_rxn(
        "[c:1]-[OH]>>[c:1][H]"
    ),
    # 正向：酚 → 氯苯 (酚羟基被Cl取代，PCl₃/PCl₅)
    "Phenol_To_Chlorobenzene": make_rxn(
        "[c:1]-[Cl]>>[c:1]-[OH]"
    ),
    # 正向：芳香酸脱羧 → 芳烃 + CO₂
    # 逆向：芳香羧酸 → 芳烃 + CO₂
    # 简化模式：匹配任何芳香羧酸
    "Aromatic_Decarboxylation": make_rxn(
        "[c:1]-[C:2](=[O:3])[OH]>>[c:1].[O:3]=[C:2]=O"
    ),

    # ─── Kolbe-Schmitt 逆推 ───
    # 正向：苯酚钠 + CO₂ → 水杨酸
    # 逆向：水杨酸 → 苯酚 + CO₂
    # 使用简化模式：直接使用SMILES匹配
    "Kolbe_Schmitt": make_rxn(
        "O=C(O)c1ccccc1O>>Oc1ccccc1.O=C=O"
    ),

    # ─── Friedel-Crafts 烷基化 (逆推) ───
    # 正向：苯 + R-X → 烷基苯 + HX
    # 逆向：烷基苯 → 苯 + 卤代烷
    "Friedel_Crafts_Alkylation": make_rxn(
        "[c:1]-[C;!a:2]>>[c:1].[Cl,Br,I][C;!a:2]"
    ),

    # ─── Friedel-Crafts 酰基化 (逆推) ───
    # 正向：苯 + R-CO-X → 芳基酮 + HX
    # 逆向：芳基酮 → 苯 + 酰卤
    "Friedel_Crafts_Acylation": make_rxn(
        "[c:1]-[C:2](=[O:3])[C;!a:4]>>[c:1].[Cl,Br,I][C:2](=[O:3])[C;!a:4]"
    ),

    # ─── 苯环侧链卤代 (逆推) ───
    # 正向：烷基苯 + X₂ → 苄基卤 + HX
    # 逆向：苄基卤 → 烷基苯 + X₂
    "Sidechain_Halogenation": make_rxn(
        "[c:1]-[C;!a:2]-[Cl,Br,I]>>[c:1]-[C;!a:2]"
    ),

    # ─── 苯酚溴化 (逆推) ───
    # 正向：苯酚 + Br₂ → 2,4,6-三溴苯酚
    # 逆向：三溴苯酚 → 苯酚 + Br₂
    "Phenol_Bromination": make_rxn(
        "[c:1]([OH])(-[Br])(-[Br])(-[Br])>>[c:1]-[OH]"
    ),

    # ─── 重氮化 (逆推) ───
    # 正向：苯胺 + HNO₂ → 重氮盐
    # 逆向：重氮盐 → 苯胺 + HNO₂
    "Diazotization": make_rxn(
        "[c:1]-[N+]#[N:2]>>[c:1]-[NH2:2]"
    ),

    # ─── 烷基苯氧化 (Side-chain Oxidation) ───
    # 正向：甲苯 + KMnO₄/H⁺ → 苯甲酸
    # 逆向：苯甲酸 → 甲苯 + [O]
    "Alkylbenzene_Oxidation": make_rxn(
        "[c:1]C(=O)O>>[c:1]C"
    ),

    # ─── 醛酮的特殊反应 ───
    # 正向：醛 + 2Ag(NH₃)₂OH → RCOONH₄ + 2Ag↓ + 3NH₃ + H₂O  (银镜反应)
    "Silver_Mirror": make_rxn(
        "[C:1](=[O])[O-]>>[CH1:1]=[O]"
    ),
    # 正向：R-CHO + 2Cu(OH)₂ → R-COOH + Cu₂O↓ + 2H₂O  (斐林反应)
    # 醛 + H₂/Ni → 伯醇  (醛催化加氢)
    "Aldehyde_Hydrogenation": make_rxn(
        "[CH2:1]-[OH]>>[CH1:1]=[O]"
    ),
    # 酮 + H₂/Ni → 仲醇
    "Ketone_Hydrogenation": make_rxn(
        "[#6:3]-[CH1:1](-[OH])-[#6:4]>>[#6:3]-[C:1](=[O])-[#6:4]"
    ),
    # 正向：羟醛缩合 (Aldol Condensation)
    # 2 R-CH₂-CHO → R-CH₂-CH(OH)-CH(R)-CHO → R-CH₂-CH=CR-CHO + H₂O
    "Aldol_Condensation": make_rxn(
        "[#6:1]-[C:2]=[C:3]-[C:4]=[O]>>[#6:1]-[CH2:2]-[C:3](=[O])-[#6]"
    ),
    # 正向：Cannizzaro 反应 (无α-H的醛在浓碱中歧化)
    "Cannizzaro": make_rxn(
        "[CH3:1]-[OH].[C:2](=[O])[O-]>>[CH3:1]=[O].[CH1:2]=[O]"
    ),

    # ─── 胺与酰胺 (Amine & Amide) ───
    # 正向：R-C≡N + 2H₂/Ni → R-CH₂-NH₂
    "Nitrile_Reduction": make_rxn(
        "[#6:1]-[CH2:2]-[NH2]>>[#6:1]-[C:2]#[N]"
    ),
    # 正向：R-COOH + NH₃ → R-CONH₂ + H₂O →(Δ)→ R-CN + H₂O
    "Amide_Dehydration": make_rxn(
        "[C:1]#[N]>>[C:1](=[O])[NH2]"
    ),

    # ─── 脱羧反应 (Decarboxylation) ───
    # 正向：R-COONa + NaOH/CaO → R-H + Na₂CO₃
    # α-酮酸脱羧 (如丙酮酸→乙醛)
    "Alpha_Ketoacid_Decarboxylation": make_rxn(
        "[#6:1]-[C:2]=[O]>>[#6:1]-[C:2](=[O])-C(=O)[OH]"
    ),
}

# ===========================================================================
# 2. 试剂映射表 (正向合成视角的试剂/条件文本)
# ===========================================================================

REAGENTS = {
    "Esterification":            "浓H₂SO₄ / Δ",
    "Ester_Hydrolysis_Base":     "NaOH/H₂O / Δ",
    "Aldehyde_Oxidation":        "O₂ / 催化剂 / Δ",
    "Pri_Alcohol_Oxidation":     "O₂ / Cu / Δ",
    "Sec_Alcohol_Oxidation":     "O₂ / Cu / Δ",
    "Alkene_Hydration":          "H₂O / 催化剂 / 加压",
    "Alkene_Dehydration":        "浓H₂SO₄ / 170°C",
    "Alkyne_Hydration":          "HgSO₄ / H₂SO₄ / H₂O",
    "Alkyne_Reduction":          "H₂ / Lindlar催化剂",
    "Haloalkane_Hydrolysis":     "NaOH水溶液 / Δ",
    "Alkane_Halogenation":       "Cl₂ / 光照 (或 Br₂ / 光照)",
    "Alkene_Dihalogenation":     "Br₂ / CCl₄",
    "Haloalkane_Elimination":    "NaOH/醇 / Δ",
    "Alcohol_Halogenation":      "浓HCl / ZnCl₂ (或PBr₃)",
    "Nitrile_Hydrolysis":        "H₂O / H⁺ / Δ",
    "Cyanohydrin_Formation":     "HCN / 碱催化",
    "Alpha_Hydroxyacid_Nitrile": "H₂O / H⁺ / Δ (氰醇水解)",
    "Gamma_Lactone":             "浓H₂SO₄ / Δ (分子内酯化)",
    "Delta_Lactone":             "浓H₂SO₄ / Δ (分子内酯化)",
    "Dilactide_Formation":       "浓H₂SO₄ / Δ (分子间酯化)",
    "Beta_Hydroxyacid_Dehydration": "浓H₂SO₄ / Δ",
    "Alcohol_Sodium":            "金属Na",
    "Diol_CyclicEther":          "浓H₂SO₄ / Δ",
    "Williamson_Ether":          "NaOH + R'-X / Δ",
    "Ether_From_Alcohol":        "浓H₂SO₄ / 140°C",
    "Aromatic_Halogenation":     "Br₂ / FeBr₃ (或Cl₂/FeCl₃)",
    "Nitration":                 "浓HNO₃ / 浓H₂SO₄ / 50-60°C",
    "Sulfonation":               "浓H₂SO₄ / SO₃",
    "Nitro_Reduction":           "Fe / HCl (或 H₂ / Ni)",
    "Phenol_Base":               "NaOH溶液",
    "Phenol_Deoxygenation":      "Zn粉 / Δ (还原脱氧)",
    "Phenol_To_Chlorobenzene":   "PCl₅ / Δ (或PCl₃)",
    "Aromatic_Decarboxylation":  "NaOH/CaO / Δ (碱石灰脱羧)",
    "Kolbe_Schmitt":             "CO₂ / 加压 / 加热",
    "Friedel_Crafts_Alkylation": "R-X / AlCl₃ (Friedel-Crafts烷基化)",
    "Friedel_Crafts_Acylation":  "R-CO-X / AlCl₃ (Friedel-Crafts酰基化)",
    "Sidechain_Halogenation":    "X₂ / 光照 (侧链卤代)",
    "Phenol_Bromination":        "Br₂ / H₂O (苯酚溴化)",
    "Diazotization":             "NaNO₂ / HCl / 低温 (重氮化)",
    "Alkylbenzene_Oxidation":    "KMnO₄ / H⁺ / Δ (烷基苯氧化)",
    "Silver_Mirror":             "Ag(NH₃)₂OH / 水浴",
    "Aldehyde_Hydrogenation":    "H₂ / Ni / Δ",
    "Ketone_Hydrogenation":      "H₂ / Ni / Δ",
    "Aldol_Condensation":        "稀NaOH / Δ",
    "Cannizzaro":                "浓NaOH",
    "Nitrile_Reduction":         "H₂ / Ni (或LiAlH₄)",
    "Amide_Dehydration":         "P₂O₅ / Δ",
    "Alpha_Ketoacid_Decarboxylation": "浓H₂SO₄ / Δ",
}

CONDITIONS = {
    "Esterification":            "酯化反应 (酸催化的可逆酯化)",
    "Ester_Hydrolysis_Base":     "酯的碱性水解 (皂化)",
    "Aldehyde_Oxidation":        "醛催化氧化为羧酸",
    "Pri_Alcohol_Oxidation":     "伯醇催化氧化为醛",
    "Sec_Alcohol_Oxidation":     "仲醇催化氧化为酮",
    "Alkene_Hydration":          "烯烃水化加成制醇",
    "Alkene_Dehydration":        "醇分子内脱水制烯烃",
    "Alkyne_Hydration":          "炔烃水化 (烯醇式→酮式互变)",
    "Alkyne_Reduction":          "炔烃选择性加氢为烯烃",
    "Haloalkane_Hydrolysis":     "卤代烃的碱性水解",
    "Alkane_Halogenation":       "烷烃的自由基取代卤化",
    "Alkene_Dihalogenation":     "烯烃的亲电加成 (X₂加成)",
    "Haloalkane_Elimination":    "卤代烃的消去反应 (扎伊采夫规则)",
    "Alcohol_Halogenation":      "醇与氢卤酸的亲核取代",
    "Nitrile_Hydrolysis":        "腈的酸性水解制羧酸",
    "Cyanohydrin_Formation":     "醛酮与HCN的加成 (亲核加成)",
    "Alpha_Hydroxyacid_Nitrile": "α-羟基腈水解为α-羟基酸 (乳腈法)",
    "Gamma_Lactone":             "γ-羟基酸分子内酯化 (γ-内酯)",
    "Delta_Lactone":             "δ-羟基酸分子内酯化 (δ-内酯)",
    "Dilactide_Formation":       "两分子α-羟基酸酯化成环 (交酯)",
    "Beta_Hydroxyacid_Dehydration": "β-羟基酸分子内脱水",
    "Alcohol_Sodium":            "醇与金属钠反应",
    "Diol_CyclicEther":          "二醇分子内脱水成环醚",
    "Williamson_Ether":          "Williamson醚合成法 (醇钠+卤代烃)",
    "Ether_From_Alcohol":        "醇分子间脱水成醚",
    "Aromatic_Halogenation":     "苯环的亲电取代卤化",
    "Nitration":                 "苯环的硝化反应 (亲电取代)",
    "Sulfonation":               "苯环的磺化反应",
    "Nitro_Reduction":           "硝基还原为氨基",
    "Phenol_Base":               "酚的弱酸性 (与NaOH反应)",
    "Phenol_Deoxygenation":      "苯酚还原脱氧制苯",
    "Phenol_To_Chlorobenzene":   "苯酚与PCl₅反应制氯苯",
    "Aromatic_Decarboxylation":  "芳香酸脱羧反应",
    "Kolbe_Schmitt":             "Kolbe-Schmitt反应 (酚钠+CO₂→水杨酸)",
    "Friedel_Crafts_Alkylation": "Friedel-Crafts烷基化反应 (苯环烷基化)",
    "Friedel_Crafts_Acylation":  "Friedel-Crafts酰基化反应 (苯环酰基化)",
    "Sidechain_Halogenation":    "烷基苯侧链卤代反应 (光照自由基取代)",
    "Phenol_Bromination":        "苯酚溴化反应 (亲电取代)",
    "Diazotization":             "重氮化反应 (芳香胺→重氮盐)",
    "Alkylbenzene_Oxidation":    "烷基苯氧化为苯甲酸 (KMnO₄/H⁺/Δ)",
    "Silver_Mirror":             "银镜反应 (醛基的氧化)",
    "Aldehyde_Hydrogenation":    "醛的催化加氢 (还原为伯醇)",
    "Ketone_Hydrogenation":      "酮的催化加氢 (还原为仲醇)",
    "Aldol_Condensation":        "羟醛缩合反应 (增长碳链)",
    "Cannizzaro":                "Cannizzaro反应 (无α-H醛的歧化)",
    "Nitrile_Reduction":         "腈的催化加氢还原制胺",
    "Amide_Dehydration":         "酰胺脱水制腈",
    "Alpha_Ketoacid_Decarboxylation": "α-酮酸脱羧反应",
}

# ===========================================================================
# 3. 基础原料集合  (高中阶段可作为直接原料的简单分子)
# ===========================================================================
def canonical(smiles: str) -> str:
    """返回 SMILES 的 canonical 形式"""
    from rdkit import Chem
    mol = Chem.MolFromSmiles(smiles)
    if mol:
        mol = Chem.RemoveHs(mol)
        return Chem.MolToSmiles(mol, canonical=True)
    return smiles

STARTING_MATERIALS = {canonical(s) for s in [
    # 单质 & 简单无机物
    "C",            # 甲烷 (CH₄)
    "C=C",          # 乙烯
    "C#C",          # 乙炔
    "CC",           # 乙烷
    "C=CC",         # 丙烯
    "c1ccccc1",     # 苯
    "ClCl",         # 氯气
    "BrBr",         # 溴单质
    "C#N",          # 氰化氢 HCN
    # 简单小分子（1-2个碳，高中学段基础原料）
    "CO",           # 甲醇
    "C=O",          # 甲醛
    # 无机试剂 (直接可得)
    "O",            # H₂O
    "N#N",          # N₂
    "O=C=O",        # CO₂
    # 离子 (为酸碱/盐反应提供离子源)
    "[Na+]",
    "[OH-]",
    "[Cl-]",
    "[Br-]",
]}

# ===========================================================================
# 4. 便捷查询函数
# ===========================================================================
def get_reagent(rule_name: str) -> str:
    return REAGENTS.get(rule_name, "—")

def get_condition(rule_name: str) -> str:
    return CONDITIONS.get(rule_name, "—")

def is_starting_material(smiles: str) -> bool:
    """判断 SMILES 是否为基础原料"""
    return canonical(smiles) in STARTING_MATERIALS
