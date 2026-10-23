/**
 * The SPARQL queries from the Python bg2cellml, unchanged apart from how IRIs
 * are filled in. Python used `%NAME%` string replacement; here each IRI is
 * checked before it goes into a query.
 */

/** Write an IRI as `<...>`, rejecting characters that could break out of it. */
export function iri(value: string): string {
  if (/[<>"{}|^`\\\s]/.test(value)) throw new TypeError(`Invalid IRI for a SPARQL query: ${value}`)
  return `<${value}>`
}

//==============================================================================
// Framework: from bondgraph/framework.py and framework_support.py

export const DOMAIN_QUERY = `
    SELECT DISTINCT ?domain ?label
                    ?flowName ?flowUnits
                    ?potentialName ?potentialUnits
                    ?quantityName ?quantityUnits
    WHERE {
        ?domain
            a bgf:PhysicalDomain ;
            bgf:hasFlow [
                bgf:varName ?flowName ;
                bgf:hasUnits ?flowUnits
            ] ;
            bgf:hasPotential [
                bgf:varName ?potentialName ;
                bgf:hasUnits ?potentialUnits
            ] ;
            bgf:hasQuantity [
                bgf:varName ?quantityName ;
                bgf:hasUnits ?quantityUnits
            ] .
        OPTIONAL { ?domain rdfs:label ?label }
    } ORDER BY ?domain`

/** Every declared domain, to report those `DOMAIN_QUERY` misses. Not in the Python version. */
export const DECLARED_DOMAINS = `
    SELECT DISTINCT ?domain
    WHERE { ?domain a bgf:PhysicalDomain }
    ORDER BY ?domain`

/** Python's query has no ORDER BY, so the order of constants depends on the oxigraph build; here they are sorted by name. */
export const domainConstantsQuery = (domain: string): string => `
    SELECT DISTINCT ?name ?value
    WHERE {
        ${iri(domain)}
            a bgf:PhysicalDomain ;
            bgf:hasConstant [
                bgf:varName ?name ;
                bgf:hasValue ?value
            ] .
    } ORDER BY ?name`

export const ELEMENT_TEMPLATE_DEFINITIONS = `
    SELECT DISTINCT ?uri ?element_class ?label ?domain ?relation
    WHERE {
        ?uri
            a bgf:ElementTemplate ;
            rdfs:subClassOf ?element_class ;
            rdfs:subClassOf* bgf:BondElement ;
            bgf:hasDomain ?domain .
        OPTIONAL { ?uri bgf:constitutiveRelation ?relation }
        OPTIONAL { ?uri rdfs:label ?label }
    } ORDER BY ?uri`

export const JUNCTION_STRUCTURES = `
    SELECT DISTINCT ?junction ?label
    WHERE {
        ?junction rdfs:subClassOf* bgf:JunctionStructure .
        OPTIONAL { ?junction rdfs:label ?label }
    } ORDER BY ?junction`

/** The BG-RDF ontology's `owl:versionInfo`, such as `2026-04-12`. Not in Python. */
export const FRAMEWORK_VERSION = `
    SELECT ?version
    WHERE {
        <https://bg-rdf.org/ontologies/bondgraph-framework> owl:versionInfo ?version .
    } ORDER BY ?version`

export const COMPOSITE_TEMPLATE_DEFINITIONS = `
    SELECT DISTINCT ?uri ?template ?label
    WHERE {
        ?uri
            a bgf:CompositeTemplate ;
            rdfs:subClassOf* ?template .
        ?template
            a bgf:ElementTemplate .
        OPTIONAL { ?uri rdfs:label ?label }
    } ORDER BY ?uri`

/** Sorted by name, as Python's order depends on how its store orders blank nodes. */
export const templateParametersQuery = (template: string): string => `
    SELECT DISTINCT ?name ?units ?value
    WHERE {
        ${iri(template)} bgf:hasParameter ?variable .
        ?variable bgf:varName ?name .
        OPTIONAL { ?variable bgf:hasUnits ?units }
        OPTIONAL { ?variable bgf:hasValue ?value }
    } ORDER BY ?name`

/** Sorted by name, as Python's order depends on how its store orders blank nodes. */
export const templateVariablesQuery = (template: string): string => `
    SELECT DISTINCT ?name ?units ?value
    WHERE {
        ${iri(template)} bgf:hasVariable ?variable .
        ?variable bgf:varName ?name .
        OPTIONAL { ?variable bgf:hasUnits ?units }
        OPTIONAL { ?variable bgf:hasValue ?value }
    } ORDER BY ?name`

export const templatePortBondsQuery = (template: string): string => `
    SELECT DISTINCT ?portId ?direction ?bondCount
    WHERE {
        {
            { ${iri(template)} bgf:hasPort ?portId .
            }
        UNION {
            ${iri(template)} bgf:hasPort ?port .
            ?port
                bgf:portId ?portId ;
                bgf:direction ?direction .
            OPTIONAL { ?port bgf:bondCount ?bondCount }
            }
        }
    } ORDER BY ?portId`

//==============================================================================
// Model: from bondgraph/model.py and model_support.py

export const BONDGRAPH_MODEL = `
    SELECT DISTINCT ?uri ?label
    WHERE {
        ?uri a bgf:BondgraphModel .
        OPTIONAL { ?uri rdfs:label ?label }
    }`

/** A model's unit system, `pml:unitSystem`, which isn't part of BG-RDF. */
export const modelUnitSystemQuery = (model: string): string => `
    SELECT DISTINCT ?system
    WHERE {
        <${model}> pml:unitSystem ?system .
    }`

export const BONDGRAPH_BONDS = `
    SELECT DISTINCT ?uri ?source ?target
    WHERE {
        ?uri
            bgf:hasSource ?source ;
            bgf:hasTarget ?target .
    }`

export const modelElementsQuery = (model: string): string => `
    SELECT DISTINCT ?uri ?type ?label ?domain ?symbol ?species ?location
    WHERE {
        ${iri(model)} bgf:hasBondElement ?uri .
        ?uri a ?type .
        OPTIONAL { ?uri bgf:hasDomain ?domain }
        OPTIONAL { ?uri bgf:hasSymbol ?symbol }
        OPTIONAL { ?uri bgf:hasSpecies ?species }
        OPTIONAL { ?uri bgf:hasLocation ?location }
        OPTIONAL { ?uri rdfs:label ?label }
    } ORDER BY ?uri`

export const modelJunctionsQuery = (model: string): string => `
    SELECT DISTINCT ?uri ?type ?label ?value ?symbol ?species ?location
    WHERE {
        ${iri(model)} bgf:hasJunctionStructure ?uri .
        ?uri a ?type .
        OPTIONAL { ?uri bgf:hasValue ?value }
        OPTIONAL { ?uri bgf:hasSymbol ?symbol }
        OPTIONAL { ?uri bgf:hasSpecies ?species }
        OPTIONAL { ?uri bgf:hasLocation ?location }
        OPTIONAL { ?uri rdfs:label ?label }
    }`

export const modelBondsQuery = (model: string): string => `
    SELECT DISTINCT ?powerBond ?source ?target ?label ?bondCount
    WHERE {
        ${iri(model)} bgf:hasPowerBond ?powerBond .
        OPTIONAL { ?powerBond bgf:hasSource ?source }
        OPTIONAL { ?powerBond bgf:hasTarget ?target }
        OPTIONAL { ?powerBond rdfs:label ?label }
        OPTIONAL { ?powerBond bgf:bondCount ?bondCount }
    }`

export const elementParameterValuesQuery = (element: string): string => `
    SELECT DISTINCT ?name ?value ?symbol
    WHERE {
        ${iri(element)} bgf:parameterValue ?variable .
        ?variable
            bgf:varName ?name ;
            bgf:hasValue ?value .
        OPTIONAL { ?variable bgf:hasSymbol ?symbol }
    }`

export const elementVariableValuesQuery = (element: string): string => `
    SELECT DISTINCT ?name ?value ?symbol
    WHERE {
        ${iri(element)} bgf:variableValue ?variable .
        ?variable
            bgf:varName ?name ;
            bgf:hasValue ?value .
        OPTIONAL { ?variable bgf:hasSymbol ?symbol }
    }`

export const elementStateValueQuery = (element: string): string => `
    SELECT DISTINCT ?value
    WHERE {
        ${iri(element)} bgf:hasValue ?value .
    }`
