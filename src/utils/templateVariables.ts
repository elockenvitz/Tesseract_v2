/**
 * Template Variable Parsing Utilities
 *
 * Supports three types of variables:
 * 1. Standard: {{variableName}} - User-provided values
 * 2. Dynamic Context: {{.price}} - Uses current asset context
 * 3. Dynamic Explicit: {{.price:AAPL}} - Specifies exact symbol
 */

// Standard variable: {{name}} or {{ name }}
const STANDARD_VAR_REGEX = /\{\{\s*(\w+)\s*\}\}/g

// Dynamic variable: {{.command}} or {{.command:SYMBOL}} or {{.command.subcommand:SYMBOL}}
const DYNAMIC_VAR_REGEX = /\{\{\.(\w+(?:\.\w+)?)(?::([A-Z0-9.]+))?\}\}/g

export interface StandardVariable {
  type: 'standard'
  name: string
  fullMatch: string
}

export interface DynamicVariable {
  type: 'dynamic'
  command: string        // e.g., 'price', 'chart', 'chart.price'
  symbol?: string        // e.g., 'AAPL' if explicit, undefined if context
  useContext: boolean    // true if no explicit symbol provided
  fullMatch: string
}

export type TemplateVariable = StandardVariable | DynamicVariable

/**
 * Extract all variables from template content
 */
export function extractVariables(content: string): TemplateVariable[] {
  const variables: TemplateVariable[] = []
  const seen = new Set<string>()

  // Extract standard variables
  let match: RegExpExecArray | null
  const standardRegex = new RegExp(STANDARD_VAR_REGEX.source, 'g')
  while ((match = standardRegex.exec(content)) !== null) {
    const key = `standard:${match[1]}`
    if (!seen.has(key)) {
      seen.add(key)
      variables.push({
        type: 'standard',
        name: match[1],
        fullMatch: match[0]
      })
    }
  }

  // Extract dynamic variables
  const dynamicRegex = new RegExp(DYNAMIC_VAR_REGEX.source, 'g')
  while ((match = dynamicRegex.exec(content)) !== null) {
    const key = `dynamic:${match[1]}:${match[2] || 'context'}`
    if (!seen.has(key)) {
      seen.add(key)
      variables.push({
        type: 'dynamic',
        command: match[1],
        symbol: match[2] || undefined,
        useContext: !match[2],
        fullMatch: match[0]
      })
    }
  }

  return variables
}

/**
 * Get only standard variables (for user input prompts)
 */
export function getStandardVariables(content: string): string[] {
  return extractVariables(content)
    .filter((v): v is StandardVariable => v.type === 'standard')
    .map(v => v.name)
}

/**
 * Get only dynamic variables
 */
export function getDynamicVariables(content: string): DynamicVariable[] {
  return extractVariables(content)
    .filter((v): v is DynamicVariable => v.type === 'dynamic')
}

/**
 * Check if template has any context-dependent dynamic variables
 */
export function hasContextVariables(content: string): boolean {
  return getDynamicVariables(content).some(v => v.useContext)
}

/**
 * Replace standard variables with provided values
 */
export function replaceStandardVariables(
  content: string,
  values: Record<string, string>
): string {
  return content.replace(STANDARD_VAR_REGEX, (match, name) => {
    return values[name] !== undefined ? values[name] : match
  })
}

/**
 * Dynamic variable command mappings
 * Maps command names to data types for the rich text editor nodes
 */
export const DYNAMIC_COMMANDS: Record<string, {
  nodeType: string
  dataType?: string
  description: string
}> = {
  // Price data
  'price': {
    nodeType: 'dataValue',
    dataType: 'price',
    description: 'Current stock price'
  },
  'price.change': {
    nodeType: 'dataValue',
    dataType: 'priceChange',
    description: 'Price change (absolute)'
  },
  'price.changePct': {
    nodeType: 'dataValue',
    dataType: 'priceChangePct',
    description: 'Price change (percentage)'
  },

  // Market data
  'marketCap': {
    nodeType: 'dataValue',
    dataType: 'marketCap',
    description: 'Market capitalization'
  },
  'volume': {
    nodeType: 'dataValue',
    dataType: 'volume',
    description: 'Trading volume'
  },

  // Valuation
  'pe': {
    nodeType: 'dataValue',
    dataType: 'peRatio',
    description: 'P/E ratio'
  },
  'eps': {
    nodeType: 'dataValue',
    dataType: 'eps',
    description: 'Earnings per share'
  },

  // Charts
  'chart': {
    nodeType: 'priceChart',
    description: 'Price chart'
  },
  'chart.price': {
    nodeType: 'priceChart',
    description: 'Price chart'
  },

  // Asset reference
  'ticker': {
    nodeType: 'assetMention',
    description: 'Asset ticker symbol'
  },
  'company': {
    nodeType: 'text',
    description: 'Company name'
  }
}

/**
 * Convert dynamic variable to rich text editor HTML node
 */
export function dynamicVarToHtml(
  variable: DynamicVariable,
  contextSymbol?: string
): string {
  const command = DYNAMIC_COMMANDS[variable.command]
  const symbol = variable.symbol || contextSymbol

  if (!command || !symbol) {
    // Return placeholder if command unknown or no symbol available
    return `<span class="template-var-unresolved">${variable.fullMatch}</span>`
  }

  switch (command.nodeType) {
    case 'dataValue':
      return `<span data-type="dataValue" data-symbol="${symbol}" data-metric="${command.dataType}"></span>`

    case 'priceChart':
      return `<div data-type="priceChart" data-symbol="${symbol}"></div>`

    case 'assetMention':
      return `<span data-type="assetMention" data-symbol="${symbol}">$${symbol}</span>`

    case 'text':
      // For company name, we'd need to look it up - return placeholder
      return `<span data-type="companyName" data-symbol="${symbol}"></span>`

    default:
      return variable.fullMatch
  }
}

/**
 * Process template content, replacing all variables
 *
 * @param content - Template HTML content
 * @param standardValues - Values for standard {{variables}}
 * @param contextSymbol - Symbol to use for context-dependent dynamic vars
 */
export function processTemplate(
  content: string,
  standardValues: Record<string, string> = {},
  contextSymbol?: string
): string {
  let result = content

  // Replace standard variables first
  result = replaceStandardVariables(result, standardValues)

  // Replace dynamic variables
  result = result.replace(DYNAMIC_VAR_REGEX, (match, command, explicitSymbol) => {
    const variable: DynamicVariable = {
      type: 'dynamic',
      command,
      symbol: explicitSymbol,
      useContext: !explicitSymbol,
      fullMatch: match
    }
    return dynamicVarToHtml(variable, contextSymbol)
  })

  return result
}

/**
 * Highlight variables in content for preview/editing
 * Wraps variables in styled spans
 */
export function highlightVariables(content: string): string {
  let result = content

  // Highlight standard variables
  result = result.replace(STANDARD_VAR_REGEX, (match, name) => {
    return `<span class="template-var template-var-standard" title="Variable: ${name}">${match}</span>`
  })

  // Highlight dynamic variables
  result = result.replace(DYNAMIC_VAR_REGEX, (match, command, symbol) => {
    const cmd = DYNAMIC_COMMANDS[command]
    const desc = cmd?.description || command
    const symbolInfo = symbol ? ` (${symbol})` : ' (context)'
    return `<span class="template-var template-var-dynamic" title="${desc}${symbolInfo}">${match}</span>`
  })

  return result
}

/**
 * Validate template content
 * Returns list of issues found
 */
export function validateTemplate(content: string): string[] {
  const issues: string[] = []
  const variables = extractVariables(content)

  // Check for unknown dynamic commands
  const dynamicVars = variables.filter((v): v is DynamicVariable => v.type === 'dynamic')
  for (const v of dynamicVars) {
    if (!DYNAMIC_COMMANDS[v.command]) {
      issues.push(`Unknown dynamic command: .${v.command}`)
    }
  }

  // Check for empty variable names
  const standardVars = variables.filter((v): v is StandardVariable => v.type === 'standard')
  for (const v of standardVars) {
    if (!v.name || v.name.trim() === '') {
      issues.push('Empty variable name found')
    }
  }

  return issues
}

/**
 * Get available dynamic commands for autocomplete
 */
export function getAvailableCommands(): Array<{
  command: string
  description: string
  example: string
}> {
  return Object.entries(DYNAMIC_COMMANDS).map(([command, info]) => ({
    command: `.${command}`,
    description: info.description,
    example: `{{.${command}}}` + (command !== 'chart' ? ` or {{.${command}:AAPL}}` : '')
  }))
}
