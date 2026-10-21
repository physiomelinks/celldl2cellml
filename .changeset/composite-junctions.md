---
'@physiomelinks/bg2cellml': patch
---

Convert composite elements, such as `bgf:ChemicalStorageNode`, `bgf:ChemicalReactionNode` and `bgf:ElectricalCapacitiveNode`, that a model also lists under `bgf:hasJunctionStructure`, as the CellDL editor writes them. Such a node is read as the element and not as a junction, which gives Python's CellML; before, it was reported as a junction that isn't a one, zero or transform node, so no diagram with storage, resistance or reaction nodes converted. A node of another junction class that isn't also an element is still reported. Output for other models is unchanged.
