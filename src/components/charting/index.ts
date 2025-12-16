// Export the custom ProChart engine
export { ProChart } from './engine'
export type { ChartType, TimeFrame, ChartTheme, IndicatorType, CustomDateRange } from './engine'
export { defaultLightTheme, defaultDarkTheme } from './engine'

// Legacy export for backwards compatibility (will be removed)
export { ChartContainer } from './core/ChartContainer'
