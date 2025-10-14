/**
 * Utility for generating Explorer view links that the legacy explorer page
 * understands. This mirrors the URL encoding handled by
 * `explorePageUrlSync`.
 */

// Node typings are not guaranteed, so declare Buffer for TS.
declare const Buffer: undefined | { from(data: string, encoding: string): { toString(encoding: string): string } };

type DatazoomTuple = [number, number];

type LegendChannelConfigPayload = {
  visible: boolean;
  color?: string;
  showTooltip: boolean;
  channelId?: string;
  bitfieldElementConfig?: unknown;
  calculatedChannelConfig?: unknown;
  [key: string]: unknown;
};

type LegendXAxisConfigPayload = {
  fromDatetime: string;
  toDatetime: string;
  minDatetime: string;
  maxDatetime: string;
  [key: string]: unknown;
};

type LegendConfigPayload = {
  left: string[];
  right: string[];
  bottom: string[];
  axes: Record<string, string[]>;
  xAxes: Record<string, LegendXAxisConfigPayload>;
  channels: Record<string, LegendChannelConfigPayload>;
  stringChannelKeys?: string[];
  axesRunLookup?: Record<string, string>;
  axesDataZoom?: Record<string, DatazoomTuple>;
  axesCustomScale?: Record<string, [number | null, number | null]>;
  axesScaleType?: Record<string, 'linear' | 'log'>;
  [key: string]: unknown;
};

type TimeDisplayConfigPayload = {
  timeDisplayType: string;
  [key: string]: unknown;
};

type AnnotationsFilterPayload = {
  searchTerm?: {
    source: string;
    isValid: boolean;
  };
  tags?: string[];
  state?: Record<string, boolean>;
  type?: string;
  assignedToUserIds?: string[];
  ruleIds?: string[];
  filterToPlotTime?: boolean;
  annotationIds?: string[];
  includeArchivedAnnotations?: boolean;
  [key: string]: unknown;
};

type LogViewerFiltersPayload = {
  search?: string;
  caseSensitive?: boolean;
  regex?: boolean;
  [key: string]: unknown;
};

type LogViewerFocusedLogLinePayload = Record<string, unknown>;

type RulerRangePayload = {
  startTime?: string;
  endTime?: string;
  [key: string]: unknown;
};

type RemoteFilesPayload = Record<string, unknown>;
type OtherChartsPayload = Record<string, unknown>;

type ExtraHashParams = Record<string, string>;

type ExplorerLinkParams = {
  /** Optional origin (e.g. https://example.com). If omitted, a relative URL is returned. */
  origin?: string;
  /** Path to the explorer route. Defaults to '/explorer'. */
  basePath?: string;
  /** Optional tabStateId appended as a search param. */
  tabStateId?: string;
  /** Asset IDs to preload. */
  assets?: string[];
  /** Run IDs to preload. */
  runs?: string[];
  /** Full legend configuration that will be base64 encoded. */
  legend?: LegendConfigPayload;
  /** Annotation to open. */
  annotationId?: string;
  /** Rule to open in the sidebar. */
  ruleId?: string;
  /** Time display configuration (base64 encoded). */
  timeDisplayConfig?: TimeDisplayConfigPayload;
  /** Annotation filters (base64 encoded). */
  annotationsFilter?: AnnotationsFilterPayload;
  /** Per-annotation visibility map (base64 encoded). */
  annotationsVisibility?: Record<string, boolean>;
  /** Explorer log viewer filters (base64 encoded). */
  logViewerFilters?: LogViewerFiltersPayload;
  /** Explorer log viewer focused log line (base64 encoded). */
  logViewerFocusedLogLine?: LogViewerFocusedLogLinePayload;
  /** Ruler range definition (base64 encoded). */
  ruler?: RulerRangePayload;
  /** Selected remote files (base64 encoded). */
  remoteFiles?: RemoteFilesPayload;
  /** Serialized "other charts" payload (base64 encoded). */
  otherCharts?: OtherChartsPayload;
  /** Additional hash params to append verbatim. */
  extraHashParams?: ExtraHashParams;
};

const BASE_PATH_DEFAULT = '/explorer';

const HASH_KEYS = {
  assets: 'assets',
  runs: 'runs',
  legend: 'legend',
  annotationId: 'annotationId',
  ruleId: 'ruleId',
  timeDisplayConfig: 'timeDisplayConfig',
  annotationsFilter: 'annotationsFilter',
  annotationsVisibility: 'annotationsVisibility',
  logViewerFilters: 'logViewerFilters',
  logViewerFocusedLogLine: 'logViewerFocusedLogLine',
  ruler: 'ruler',
  remoteFiles: 'remoteFiles',
  otherCharts: 'otherCharts',
} as const;

type HashKey = keyof typeof HASH_KEYS;

const JSON_BASE64_KEYS: HashKey[] = [
  'legend',
  'timeDisplayConfig',
  'annotationsFilter',
  'annotationsVisibility',
  'logViewerFilters',
  'logViewerFocusedLogLine',
  'ruler',
  'remoteFiles',
  'otherCharts',
];

type JsonCapableKey = typeof JSON_BASE64_KEYS[number];

type HashValueMap = Partial<Record<HashKey, unknown>>;

function encodeURIComponentSafe(value: string): string {
  if (typeof window !== 'undefined' && typeof window.encodeURIComponent === 'function') {
    return window.encodeURIComponent(value);
  }
  // Fallback implementation if running under Node without DOM globals.
  // encodeURIComponent is available globally in Node as well.
  return encodeURIComponent(value);
}

function b64EncodeUnicode(str: string): string {
  if (typeof window !== 'undefined' && typeof window.btoa === 'function') {
    return window.btoa(
      encodeURIComponentSafe(str).replace(/%([0-9A-F]{2})/g, (_, p1: string) => String.fromCharCode(parseInt(p1, 16)))
    );
  }

  if (typeof Buffer !== 'undefined') {
    return Buffer.from(str, 'utf8').toString('base64');
  }

  throw new Error('No base64 encoder available in this environment.');
}

function encodeJsonPayload(value: unknown): string {
  return b64EncodeUnicode(JSON.stringify(value));
}

function normaliseBasePath(basePath: string): string {
  if (!basePath.startsWith('/')) {
    return `/${basePath}`;
  }
  return basePath;
}

function stripTrailingSlash(input: string): string {
  return input.endsWith('/') ? input.slice(0, -1) : input;
}

function setIfPresent(hash: URLSearchParams, key: string, value: string | undefined | null) {
  if (value !== undefined && value !== null && value !== '') {
    hash.set(key, value);
  }
}

function appendCommaSeparated(hash: URLSearchParams, key: string, values?: string[]) {
  if (values && values.length > 0) {
    hash.set(key, values.join(','));
  }
}

function toHashValueMap(params: ExplorerLinkParams): HashValueMap {
  return {
    assets: params.assets,
    runs: params.runs,
    legend: params.legend,
    annotationId: params.annotationId,
    ruleId: params.ruleId,
    timeDisplayConfig: params.timeDisplayConfig,
    annotationsFilter: params.annotationsFilter,
    annotationsVisibility: params.annotationsVisibility,
    logViewerFilters: params.logViewerFilters,
    logViewerFocusedLogLine: params.logViewerFocusedLogLine,
    ruler: params.ruler,
    remoteFiles: params.remoteFiles,
    otherCharts: params.otherCharts,
  };
}

function setHashValue(hash: URLSearchParams, key: HashKey, value: unknown) {
  if (value === undefined || value === null) {
    return;
  }

  if (key === 'assets' || key === 'runs') {
    appendCommaSeparated(hash, HASH_KEYS[key], value as string[]);
    return;
  }

  if ((JSON_BASE64_KEYS as readonly string[]).includes(key)) {
    const encoded = encodeJsonPayload(value);
    setIfPresent(hash, HASH_KEYS[key], encoded);
    return;
  }

  setIfPresent(hash, HASH_KEYS[key], String(value));
}

export function createExplorerLink(params: ExplorerLinkParams): string {
  const basePath = normaliseBasePath(params.basePath ?? BASE_PATH_DEFAULT);
  const searchParams = new URLSearchParams();

  if (params.tabStateId) {
    searchParams.set('tabStateId', params.tabStateId);
  }

  const hashParams = new URLSearchParams();
  const hashValueMap = toHashValueMap(params);

  (Object.keys(hashValueMap) as HashKey[]).forEach((key) => {
    setHashValue(hashParams, key, hashValueMap[key]);
  });

  if (params.extraHashParams) {
    for (const [key, value] of Object.entries(params.extraHashParams)) {
      if (value !== undefined && value !== null && value !== '') {
        hashParams.set(key, value);
      }
    }
  }

  const searchString = searchParams.toString();
  const hashString = hashParams.toString();

  let url = basePath;
  if (searchString) {
    url += `?${searchString}`;
  }
  if (hashString) {
    url += `#${hashString}`;
  }

  if (params.origin) {
    url = `${stripTrailingSlash(params.origin)}${url}`;
  }

  return url;
}

export type {
  ExplorerLinkParams,
  LegendConfigPayload,
  LegendChannelConfigPayload,
  LegendXAxisConfigPayload,
  TimeDisplayConfigPayload,
  AnnotationsFilterPayload,
  LogViewerFiltersPayload,
  LogViewerFocusedLogLinePayload,
  RulerRangePayload,
  RemoteFilesPayload,
  OtherChartsPayload,
  ExtraHashParams,
};
