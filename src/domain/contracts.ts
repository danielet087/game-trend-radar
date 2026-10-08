/** Internal UI contracts. Public backend JSON field names remain unchanged. */
export type PlatformCode = 'Steam' | 'NS' | 'NS2' | 'PS5';
export type Provider = 'Steam' | 'IGDB' | 'Twitch';
export type DatasetSource = 'official' | 'preview' | 'native';
export type GameId = `steam:${number}` | `igdb:${number}`;
export type LanguageStatus = 'traditional' | 'simplified' | 'english' | 'other' | 'unknown' | 'chinese';

/** Date-only values deliberately have no UTC offset and are never shifted. */
export type CalendarDate = string;
/** A timestamp must include Z or an explicit offset at the JSON boundary. */
export type AwareTimestamp = string;

export interface SourceProvenance {
  provider: Provider;
  dataset: DatasetSource;
  datasetUpdatedAt: AwareTimestamp | null;
  checkedAt: AwareTimestamp | null;
  sourceUrl: string | null;
}

export interface MetricObservation {
  kind: 'followers' | 'hypes' | 'viewers';
  provider: Provider;
  providerId: string;
  /** Missing observations are null, while a measured zero remains zero. */
  value: number | null;
  status: 'observed' | 'unknown';
  provenance: SourceProvenance;
}

export interface LanguageBadge {
  label: string;
  status: LanguageStatus;
  title?: string;
}

export interface LanguageSupport {
  status: 'confirmed' | 'partial' | 'unknown';
  region: string | null;
  languages: {
    tchinese: boolean | null;
    schinese: boolean | null;
    english: boolean | null;
    chinese?: boolean | null;
    [language: string]: unknown;
  };
  supported_languages?: ReadonlyArray<{ code: string; name: string }>;
  complete?: boolean;
  source?: string | null;
  source_url?: string | null;
  checked_at?: AwareTimestamp | null;
  evidence_type?: string | null;
  languageBadges: ReadonlyArray<LanguageBadge>;
}

export interface MultiplayerEvidence {
  status: 'multiplayer' | 'single' | 'unknown';
  source: 'Steam' | 'IGDB';
  scope: 'platform' | 'game';
  modes: ReadonlyArray<string>;
}

export interface EditionEvidence {
  type: 'base_plus_expansion' | 'deluxe' | 'base_plus_dlc';
  label: string;
  title: string;
  product_id: string;
  region: string;
  source_url: string;
  checked_at: AwareTimestamp;
}

export interface PlatformVersion {
  id: string;
  gameId: GameId;
  platform: PlatformCode;
  title: string;
  englishTitle: string;
  storefront: { url: string; label: string; region: string | null } | null;
  edition: EditionEvidence | null;
  languageSupport: LanguageSupport;
  multiplayer: MultiplayerEvidence;
  provenance: SourceProvenance;
}

export interface ReleaseEvent {
  id: string;
  gameId: GameId;
  versionId: string;
  platform: PlatformCode;
  date: CalendarDate;
  precision: 'day';
  sourceRegion: string | null;
  /** Source may be a provider name or a reviewed official registry. */
  source: string;
  dateBasis: string | null;
  timeZone: 'Asia/Taipei' | null;
  timestamp: AwareTimestamp | null;
  sourceTimestamp: number | null;
  sourceDate: CalendarDate | null;
  timestampTaipeiDate: CalendarDate | null;
  taiwanConfirmed: boolean | null;
  visibility: { games: boolean; recent: boolean };
  provenance: SourceProvenance;
  /** Preserve complete evidence for diagnostics; do not infer missing facts. */
  audit: Readonly<Record<string, unknown>>;
}

export interface GameEntity {
  id: GameId;
  identity: {
    steamAppid: number | null;
    igdbIds: ReadonlyArray<number>;
    twitchGameIds: ReadonlyArray<string>;
    savedAliases: ReadonlyArray<number | `igdb:${number}`>;
  };
  names: {
    display: string;
    english: string;
    traditional: string;
    simplifiedConverted: string;
    originalTraditional: string;
    originalSimplified: string;
    searchAliases: ReadonlyArray<string>;
  };
  versions: ReadonlyArray<PlatformVersion>;
  releaseEventIds: ReadonlyArray<string>;
  metrics: ReadonlyArray<MetricObservation>;
  artwork: { primary: string; fallbacks: ReadonlyArray<string> };
  sources: ReadonlyArray<SourceProvenance>;
}

export interface PublicPayload {
  games?: ReadonlyArray<Readonly<Record<string, unknown>>>;
  recent_games?: ReadonlyArray<Readonly<Record<string, unknown>>>;
  generated_at?: AwareTimestamp;
  updated_at?: AwareTimestamp;
  schema_version?: number;
  version?: number;
  [field: string]: unknown;
}

export interface BoundaryInput {
  official?: PublicPayload | null;
  preview?: PublicPayload | null;
  native?: PublicPayload | null;
}

export interface BoundaryProjection {
  /** Compatibility dataset is retained during the gradual page migration. */
  dataset: LegacyDataset;
  entities: ReadonlyArray<GameEntity>;
  releaseEvents: ReadonlyArray<ReleaseEvent>;
  sourceUpdates: {
    steam: AwareTimestamp | null;
    native: AwareTimestamp | null;
    latest: AwareTimestamp | null;
  };
}

/** Legacy presentation rows are used by established page modules. */
export interface LegacyGame {
  appid: number | `igdb:${number}`;
  source: 'steam' | 'nintendo';
  identityKey: GameId;
  name: string;
  nameEn: string;
  nameTw: string;
  nameCn: string;
  date: CalendarDate;
  platforms: PlatformCode[];
  releasePlatforms: PlatformCode[];
  releases: Array<Record<string, unknown> & { platform: PlatformCode; date: CalendarDate; precision: 'day'; source: string }>;
  dateReleases: LegacyGame['releases'];
  [field: string]: any;
}

export interface LegacyDataset {
  games: LegacyGame[];
  recent: LegacyGame[];
  updated: AwareTimestamp | null;
  steamUpdated: AwareTimestamp | null;
  nintendoUpdated: AwareTimestamp | null;
  partial: boolean;
  [field: string]: any;
}
