/** Every units code in the BG-RDF templates and examples. */
export const BG_RDF_CODES = [
  'mol', 'L', 'mol-1', 'mol/s', 'Ohm', 'F', 'C', 'A', 'm/s', 'L2.s-1.J-1', 'L/mol', 'J/C', 'J',
  'J.s.C-1.m-1', 'J/mol', 'm2.J-1', 'V', 'J.s2.m-2', 'H', 'm', 'J.s.m-2', 'm2/J', 'm/s2', 'L/s',
  'J/m', 'J/L', 'J.s2.C-2', 'J.s.C-2', 'C2/J', 'C/s', 'C/mol', 's',
]

/** Codes that send the Python bg2cellml into recursion, and other codes with prefixes, factors or no symbols. */
export const HARDER_CODES = ['mmol/s', 'mL', 'uF', 'kPa', 'mV', 'kOhm', 'mm[Hg]', 'cm[H2O]', '/min', '10*9/L', '10*-3.mol', '1', '%', 'kg.m-3', 'mmol{Na}/L', 'm/m']
