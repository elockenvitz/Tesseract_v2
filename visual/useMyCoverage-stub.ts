/** useMyCoverage, replaced by a fixture, for the visual harness only. */
export function useMyCoverage() {
  return {
    rows: [], personal: [], assigned: [],
    assetIds: new Set<string>(), hasCoverage: false,
    isLoading: false, error: null, isMutating: false,
    add: async () => {}, remove: async () => {}, setNotes: async () => {},
  }
}
