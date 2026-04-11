/**
 * Utility for generating Explorer view links that the legacy explorer page
 * understands. This mirrors the URL encoding handled by
 * `explorePageUrlSync`.
 */
import { SharelinkItems, SharelinkTimeRange } from '../../types';

// Node typings are not guaranteed, so declare Buffer for TS.
declare const Buffer: undefined | { from(data: string, encoding: string): { toString(encoding: string): string } };

type DatazoomTuple = [number, number];

export type CalculatedChannelConfig = {
  channelKey: string;
  name: string;
  channelReferences: Record<string, string>;
  expression: string;
  dataType: string;
  unitAbbreviatedName: string;
};

type LegendChannelConfigPayload = {
  visible: boolean;
  showTooltip: boolean;
  channelId?: string;
  calculatedChannelConfig?: CalculatedChannelConfig;
};

type LegendXAxisConfigPayload = {
  fromDatetime: string;
  toDatetime: string;
  minDatetime: string;
  maxDatetime: string;
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
  axesScaleType?: Record<string, 'linear' | 'log'>;
};

type OtherChartsPayload = Record<string, unknown>;

type ExtraHashParams = Record<string, string>;

type ExplorerLinkParams = {
  /** Optional origin (e.g. https://example.com). If omitted, a relative URL is returned. */
  origin?: string;
  /** Path to the explorer route. Defaults to '/explorer'. */
  basePath?: string;
  /** Asset IDs to preload. */
  assets?: string[];
  /** Run IDs to preload. */
  runs?: string[];
  /** Full legend configuration that will be base64 encoded. */
  legend?: LegendConfigPayload;
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
  otherCharts: 'otherCharts',
} as const;

type HashKey = keyof typeof HASH_KEYS;

const JSON_BASE64_KEYS: HashKey[] = ['legend', 'otherCharts'];

type JsonCapableKey = (typeof JSON_BASE64_KEYS)[number];

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
  // Remove trailing slash for consistency
  return basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
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

function createExplorerLink(params: ExplorerLinkParams): string {
  const basePath = normaliseBasePath(params.basePath ?? BASE_PATH_DEFAULT);
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

  const hashString = hashParams.toString();

  // If origin is provided, use URL constructor for proper URL building
  if (params.origin) {
    try {
      const url = new URL(basePath, params.origin);
      if (hashString) {
        url.hash = hashString;
      }
      return url.toString();
    } catch {
      // If URL construction fails, fall back to string concatenation
      // This shouldn't happen if origin is properly validated
      const fullUrl = `${params.origin}${basePath}`;
      return hashString ? `${fullUrl}#${hashString}` : fullUrl;
    }
  }

  // Return relative URL
  return hashString ? `${basePath}#${hashString}` : basePath;
}

export function generateLinkFromQuery(hostname: string, items: SharelinkItems, timeRange?: SharelinkTimeRange) {
  // Guard against null/undefined hostname
  if (!hostname) {
    throw new Error('hostname is required');
  }
  
  // Normalize hostname to a valid origin URL
  let origin: string;
  try {
    // If hostname is already a valid URL, use it directly
    const testUrl = new URL(hostname);
    // Check if origin is valid (not null or 'null')
    if (testUrl.origin && testUrl.origin !== 'null') {
      origin = testUrl.origin;
    } else {
      // URL parsed but origin is invalid, treat as hostname
      throw new Error('Invalid origin');
    }
  } catch {
    // If not a valid URL, assume it's a hostname and prepend https://
    const withProtocol = `https://${hostname}`;
    try {
      const validatedUrl = new URL(withProtocol);
      origin = validatedUrl.origin;
    } catch {
      // If still invalid, fall back to the string (shouldn't happen with valid hostnames)
      origin = withProtocol;
    }
  }
  const channelIds = items.channelIds;
  const channelKeys = channelIds.map((_, index) => `channel-key-${index + 1}`);
  const legendChannels: LegendConfigPayload['channels'] = {};
  channelIds.forEach((channelId, index) => {
    const channelKey = channelKeys[index];
    legendChannels[channelKey] = {
      channelId,
      visible: true,
      showTooltip: true,
    };
  });
  if (items.calculatedChannels) {
    items.calculatedChannels.forEach((calcChannel, index) => {
      const channelKeyIndex = channelKeys.length + index;
      const channelKeyName = `channel-key-${channelKeyIndex+1}`;
      channelKeys.push(channelKeyName)

      const channelReferences: Record<string, string> = {};
      calcChannel.sourceChannels.forEach((el, index) => {
        channelReferences[`$${index + 1}`] = el;
      });

      legendChannels[channelKeyName] = {
        visible: true,
        showTooltip: true,
        calculatedChannelConfig: {
          channelKey: channelKeyName,
          name: calcChannel.name,
          channelReferences: channelReferences,
          expression: calcChannel.expression,
          dataType: calcChannel.expressionDataType,
          unitAbbreviatedName: '',
        },
      };
    });
  }

  let xAxis = {
    fromDatetime: '',
    toDatetime: '',
    minDatetime: '',
    maxDatetime: '',
  };
  if (timeRange) {
    xAxis.fromDatetime = timeRange.from;
    xAxis.toDatetime = timeRange.to;
  }

  const legend: LegendConfigPayload = {
    left: ['y-axis-1'],
    right: [],
    bottom: ['x-axis-1'],
    axes: {
      'y-axis-1': channelKeys,
      'x-axis-1': channelKeys,
    },
    xAxes: {
      'x-axis-1': xAxis,
    },
    channels: legendChannels,
    stringChannelKeys: [],
    axesRunLookup: {},
    axesDataZoom: {
      'y-axis-1': [0, 100],
    },
    axesScaleType: {
      'y-axis-1': 'linear',
    },
  };

  const assets = items.assetIds && items.assetIds.length > 0 ? items.assetIds : undefined;
  const runs = items.runIds && items.runIds.length > 0 ? items.runIds : undefined;

  return createExplorerLink({
    origin,
    assets,
    runs,
    legend
  })
}

export type {
  ExplorerLinkParams,
  LegendConfigPayload,
  LegendChannelConfigPayload,
  LegendXAxisConfigPayload,
  OtherChartsPayload,
  ExtraHashParams,
};
