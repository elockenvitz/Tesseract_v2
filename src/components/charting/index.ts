// Export the custom ProChart engine
export { ProChart } from './engine'
export type { ChartType, TimeFrame, ChartTheme, IndicatorType, CustomDateRange, CompareSymbol, DisplayMode } from './engine'
export { defaultLightTheme, defaultDarkTheme } from './engine'

// Legacy export for backwards compatibility (will be removed)
export { ChartContainer } from './core/ChartContainer'
