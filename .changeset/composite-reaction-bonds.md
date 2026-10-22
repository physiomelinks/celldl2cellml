---
'@physiomelinks/bg2cellml': patch
---

Convert an element bonded straight to a composite element, such as a `bgf:ChemicalReaction` bonded to a `bgf:ChemicalStorageNode` with no zero node between them. The reaction's port now takes the store's potential, as it would through the zero node the store acts as; before, the port's potential had no equation and the model was underconstrained. Likewise, an element bonded straight to a composite resistance or reaction node, or to a source, shares its flow or potential. Output for models that already converted is unchanged.
