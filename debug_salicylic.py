import sys, os
sys.path.insert(0, os.path.dirname(__file__) or '.')

from rdkit import Chem
from rdkit.Chem import AllChem
from reaction_rules import RETRO_RULES, canonical, STARTING_MATERIALS

target = canonical('O=C(O)c1ccccc1O')
print("Target:", target)

mol = Chem.MolFromSmiles(target)
print("Mol:", mol is not None)

# Test each rule against salicylic acid
for rule_name in list(RETRO_RULES.keys()):
    rxn = RETRO_RULES[rule_name]
    if rxn.GetNumReactantTemplates() > 1:
        continue
    try:
        products_list = rxn.RunReactants((mol,))
        for products in products_list:
            frags = []
            for p in products:
                try:
                    Chem.SanitizeMol(p)
                    sm = canonical(Chem.MolToSmiles(p))
                    frags.append(sm)
                except:
                    frags = None
                    break
            if frags:
                print(f"  {rule_name}: {' + '.join(frags)}")
                for frag in frags:
                    print(f"    '{frag}' in start? {frag in STARTING_MATERIALS}")
    except Exception as e:
        pass  # skip problematic rules
