---
'@physiomelinks/bg2cellml': minor
---

Convert reactions as the CellDL editor's Reactions panel draws them: a composite `bgf:ChemicalReactionNode` bonded straight to its species, with each coefficient as the bond's `bgf:bondCount`, and a copy of a chemostat beside each reaction using it.

- Drawn copies of an element (same symbol, species and location) are now separate elements with names of their own, as in Finbar Argus's BG-Tools: the first in IRI order keeps the name and a later copy is named from its IRI's fragment, such as `u_ID_00000007`. Before, the copies shared their variables, so the model was over- or underconstrained. Copies of a store are separate pools, and are reported as a warning.
- A port bonded straight to a junction or a composite element now carries `n` times its flow or potential for a bond count `n`, and a flow is negated when the bond runs against the port, so a store bonded from itself to a reaction loses what the reaction carries away. Before, such a store gained it, whatever the count.

Every BG-RDF example gives the same CellML. Other models change only if they have drawn copies, a bond count on a port bonded to a junction or composite element, or a port bonded against its direction.
