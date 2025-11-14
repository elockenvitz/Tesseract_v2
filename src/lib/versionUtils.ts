/**
 * Format a version number for display
 * @param version_number - Legacy version number (major * 100 + minor)
 * @param major_version - Major version number
 * @param minor_version - Minor version number
 * @returns Formatted version string (e.g., "v1.0", "v2.1")
 */
export function formatVersion(
  version_number: number,
  major_version?: number | null,
  minor_version?: number | null
): string {
  // If we have semantic versions, use them
  if (major_version !== null && major_version !== undefined && minor_version !== null && minor_version !== undefined) {
    return `v${major_version}.${minor_version}`
  }

  // Fall back to calculating from legacy version_number
  const major = Math.floor(version_number / 100) || 1
  const minor = version_number % 100
  return `v${major}.${minor}`
}
