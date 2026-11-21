---
"@physiomelinks/bg2cellml": minor
---

A model can give its own value of a domain constant, such as `RT` at its temperature.

- bg2cellml: `bgf:constantValue [ bgf:varName "RT" ; bgf:hasValue "2560.712 J/mol"^^cdt:ucum ]` on a `bgf:BondgraphModel` replaces the template's value of that constant in the CellML, converted to the constant's units and rescaled with the unit system. `bgf:forDomain` names the domain where more than one has the constant. A constant no domain of the model's elements has, units that are not the constant's, and two values of one constant are errors. `BondgraphModel.constantValues` lists them.

A model without one gives the same CellML as before.
