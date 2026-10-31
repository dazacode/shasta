// Shapes returned by the Store API (server/src). Kept in one place so the UI and the API cannot drift apart silently.

export type Role = 'owner' | 'contributor' | 'user'

export interface StoreUser {
  id: string
  publicId: string
  displayName: string
  role: Role
  canPublish: boolean
}

export type AppStatus = 'draft' | 'pending' | 'published' | 'unpublished' | 'rejected' | 'removed'
export type VersionState = 'draft' | 'pending' | 'live' | 'archived' | 'rejected'

export interface CategoryRef {
  id: string
  name: string
  isGame: boolean
}

/** The compact storefront reference carried by every app card */
export interface StoreRef {
  id: string
  slug: string
  name: string
  /** colour theme: an oklch hue, 0-360 */
  accent: number
  logoUrl: string | null
  bannerUrl: string | null
  official: boolean
}

export interface StoreCard extends StoreRef {
  tagline: string
  apps: number
  followers: number
}

export interface StoreDetail extends StoreCard {
  description: string
  createdAt: number
  isMine: boolean
  following: boolean
}

export interface MyStore extends StoreDetail {
  configured: boolean
}

/** The card shape used by every list in the Store */
export interface AppCard {
  id: string
  slug: string
  name: string
  developer: string
  store: StoreRef | null
  summary: string
  kind: 'package' | 'linked'
  category: CategoryRef | null
  /** derived from the tags on the server (services/genres.ts); games only. Absent from older servers. */
  genres?: GenreRef[]
  iconUrl: string | null
  bannerUrl: string | null
  featured: boolean
  version: string | null
  releasedAt: number | null
  updatedAt: number | null
  status: AppStatus
}

export type CreditRole = 'developer' | 'publisher' | 'designer' | 'artist' | 'music' | 'port' | 'host' | 'other'

/** A person or organisation behind an app. Original makers come first, whoever hosts it last. */
export interface Credit {
  role: CreditRole
  name: string
  url?: string
}

export const CREDIT_LABEL: Record<CreditRole, string> = { developer: 'Developer', publisher: 'Publisher', designer: 'Design', artist: 'Art', music: 'Music', port: 'Web port', host: 'Hosted by', other: 'Credit' }

export interface RuntimeInfo {
  summary: string
  can: string[]
  cannot: string[]
  compatibility: string
}

export interface AppDetail extends AppCard {
  description: string
  tags: string[]
  screenshots: string[]
  linkedUrl: string | null
  credits: Credit[]
  /** false for web apps and first releases: there is no version number worth showing */
  hasVersionHistory: boolean
  sizeBytes: number
  fileCount: number
  runtime: RuntimeInfo
  storefront: (StoreCard & { isMine: boolean }) | null
  versions: { version: string; notes: string; publishedAt: number | null; current: boolean; kept: boolean }[]
  related: AppCard[]
}

export interface CategoryCount extends CategoryRef {
  count: number
}

export interface GenreRef {
  id: string
  name: string
}

export interface GenreCount extends GenreRef {
  count: number
  /** false for an app topic (AI tools, Productivity, ...); absent from older servers, which only sent game genres */
  isGame?: boolean
}

export interface Home {
  total: number
  /** genres with at least one game, biggest first is up to the page (absent from older servers) */
  genres?: GenreCount[]
  stores: StoreCard[]
  featured: AppCard[]
  trending: AppCard[]
  popular: AppCard[]
  recentlyAdded: AppCard[]
  recentlyUpdated: AppCard[]
  collections: { id: string; title: string; description: string; apps: AppCard[] }[]
  categories: CategoryCount[]
  byCategory: { category: CategoryCount; apps: AppCard[] }[]
  announcement: { id: string; title: string; body: string; appSlug: string | null } | null
}

export interface SearchResult {
  total: number
  items: AppCard[]
}

export interface Suggestions {
  apps: AppCard[]
  categories: { id: string; name: string }[]
  genres?: GenreRef[]
  developers: string[]
}

export interface InstalledApp {
  app: AppCard
  installedVersion: string
  installedAt: number
  lastLaunchedAt: number | null
  launchCount: number
  pinned: boolean
  folderId: string | null
  available: boolean
  unavailableReason: string | null
  clearDataUrl: string
  /** the app's own address: game://click-quest or app://discord */
  address: string
  updateAvailable: boolean
  /** the storefront still keeps the version this device has, so updating is the person's choice */
  canStay: boolean
  /** the version this device has was retired: the next time the app opens it moves to the latest */
  updateRequired: boolean
  latestVersion: string | null
  releaseNotes: string | null
  /** notes of every release after the one this device has, newest first */
  changelog: { version: string; notes: string; publishedAt: number | null }[]
  /** where the kept older version stores its data (cleared on uninstall with "remove app data") */
  stayClearDataUrl: string | null
}

export interface Library {
  installed: InstalledApp[]
  favorites: AppCard[]
  folders: { id: string; name: string }[]
  following: StoreCard[]
}

export interface RuntimeTarget {
  target: { kind: 'package' | 'linked'; url: string }
  id: string
  slug: string
  /** game:// for games, app:// for everything else */
  scheme: 'app' | 'game'
  kind: 'package' | 'linked'
  name: string
  version: string
  latestVersion?: string
  /** running an older release the storefront still keeps available */
  onOlderVersion?: boolean
  /** the version this device asked for was retired, so it got the latest */
  movedUp?: boolean
  /** only true once the app has been updated: until then a version label would just be noise */
  showVersion: boolean
  iconUrl: string | null
  originKey: string
  /** curated controller/phone layout set by the Store owner (lib/gameInput.ts ControlsHint); absent on older servers */
  controls?: unknown
}

// ---- developer / admin ----

export interface PackageReport {
  ok: boolean
  errors: string[]
  warnings: string[]
  fileCount: number
  totalBytes: number
  entry: string
}

export interface DevVersion {
  id: string
  version: string
  state: VersionState
  notes: string
  linkedUrl: string | null
  hasPackage: boolean
  sizeBytes: number
  fileCount: number
  validation: PackageReport | null
  rejectReason: string | null
  createdAt: number
  submittedAt: number | null
  publishedAt: number | null
  current: boolean
  /** set on a new version: when it goes live, keep the release it replaces available */
  keepPrevious: boolean
  /** set on a replaced version: people who are on it may stay on it */
  keepAvailable: boolean
}

export interface AppStats {
  installed: number
  totalInstalls: number
  installsLast7Days: number
  uninstalls: number
  launches: number
  launchesLast7Days: number
  openReports: number
}

export interface DevApp extends AppCard {
  description: string
  tags: string[]
  screenshots: { file: string; url: string }[]
  rejectReason: string | null
  credits: Credit[]
  featured: boolean
  ownerId: string
  ownerName: string
  createdAt: number
  updatedAt: number
  versions: DevVersion[]
  readiness: string[]
  canPublishDirectly: boolean
  stats: AppStats
  pendingVersion?: string | null
}

export interface MetadataProviderInfo {
  id: string
  label: string
  hint: string
  input: 'search' | 'url' | 'package'
}

export interface MetadataCandidate {
  id: string
  name: string
  subtitle?: string
  iconUrl?: string
}

export interface ImportedMetadata {
  provider: string
  name: string
  developer?: string
  credits?: Credit[]
  summary?: string
  description?: string
  tags: string[]
  category?: string
  iconUrl?: string
  screenshotUrls: string[]
  sourceUrl?: string
}

export type MetadataField = 'name' | 'credits' | 'summary' | 'description' | 'tags' | 'category' | 'icon' | 'screenshots'

export interface AdminUser extends StoreUser {
  disabled: boolean
  canPublishFlag: boolean
  createdAt: number
  lastSeenAt: number
  apps: number
}

export interface Invite {
  id: string
  role: string
  canPublish: boolean
  note: string
  createdAt: number
  expiresAt: number
  status: 'open' | 'used' | 'revoked' | 'expired'
  usedBy: { publicId: string | null; name: string | null } | null
}

export type ApplicationStatus = 'pending' | 'approved' | 'declined'

/** what the applicant's device sees (POST /api/apply/status) */
export interface MyApplication {
  id: string
  status: ApplicationStatus
  name: string
  createdAt: number
  decidedAt: number | null
  message: string
  canPublish: boolean
  /** the single-use invite code, only while it can still be redeemed */
  code: string | null
}

/** an application as the owner sees it (GET /api/admin/applications) */
export interface StoreApplication {
  id: string
  name: string
  contact: string
  about: string
  links: string
  status: ApplicationStatus
  message: string
  canPublish: boolean
  /** discord: sent with /apply in the Discord server; the bot DMs them the answer */
  via: 'web' | 'discord'
  createdAt: number
  decidedAt: number | null
  invite: 'open' | 'used' | 'revoked' | 'expired' | 'gone' | null
}

export interface AuditEntry {
  id: number
  at: number
  actor: string
  action: string
  targetType: string
  targetId: string | null
  details: Record<string, unknown>
}

export interface Report {
  id: string
  reason: string
  /** what exactly is wrong, for reason "broken" */
  problem: string | null
  details: string
  /** technical details the person chose to include */
  info: Record<string, string>
  /** open reports about the same app */
  appOpen: number
  status: string
  createdAt: number
  resolution: string | null
  appId: string
  appName: string
  appSlug: string
  appStatus: AppStatus
  reporter: string | null
}

export interface CatalogEvent {
  type: 'app-published' | 'app-updated' | 'app-unpublished' | 'app-removed' | 'catalog-changed' | 'queue-changed'
  appId?: string
  slug?: string
  name?: string
  version?: string
  storeId?: string
}
