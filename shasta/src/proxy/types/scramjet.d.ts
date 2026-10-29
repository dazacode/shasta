// Minimal typings for the parts of Scramjet we use (mapped via tsconfig `paths`).
// Upstream's generated .d.ts files fail to build, and tsc would otherwise type-check
// Scramjet's raw sources under our stricter settings.
export const defaultConfig: unknown
export const versionInfo: { version: string; build: string }
export function rewriteUrl(url: string, context: unknown, meta: { origin: URL; base: URL }): string
export class ScramjetHeaders {
  static fromRawHeaders(headers: [string, string][]): ScramjetHeaders
}
