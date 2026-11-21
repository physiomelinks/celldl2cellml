---
"@physiomelinks/bg2cellml": patch
---

`convert()` solves a transformer that ends at a source for the transformer's own variable.

- bg2cellml: a source's own potential or flow is given, so `convert()` counts it as defined. A transformer on a reaction's reverse side that ends at a voltage source (`R1 -> TF -> V`) was written `u_Se_V = TF * u_TF_0`, which defines the source's potential a second time; it is now `u_TF_0 = u_Se_V / TF`. A membrane potential held by a source can then act on both sides of a reaction, as one held by a capacitor already could.

`celldl2cellml()` gives the same CellML as before for every model.
