import {
  DataQueryResponse,
  DataQueryRequest,
  toDataFrame,
  dateTime,
  FieldType,
  DataFrame,
  outerJoinDataFrames,
  Field,
  Labels,
  FieldConfig,
  LoadingState,
  DataQueryError,
  QueryResultMetaNotice,
} from '@grafana/data';
import { Observable, lastValueFrom } from 'rxjs';
import { SiftQuery } from './types';
import { replaceTemplateVariablesInQuery } from './utils';

// Any data newer than this will always be requested from the datasource backend
export const MIN_LIVE_LOOKBACK_TIME_MS = 10 * 60 * 1_000; // 10 minutes

interface CacheEntry {
  request: DataQueryRequest<SiftQuery>;
  response: DataQueryResponse;
  targetsKey: string;
  fetchedIntervalMs: number;
  seq: number;
}

// Added to cached frames that are shown in place of a failed or empty response
const STALE_DATA_NOTICE: QueryResultMetaNotice = {
  severity: 'warning',
  text: 'The latest query failed or returned no data. Showing cached data, which can be out of date.',
};

// eslint-disable-next-line deprecation/deprecation -- Grafana 13 still sets only `error` on cancelled requests
const responseError = (r: DataQueryResponse): DataQueryError | undefined => r.errors?.[0] ?? r.error;

// Cancelled, failed, and empty responses must never be cached. Grafana reports a cancelled or non-200
// request with only `error` set, and a dropped connection with no error at all.
export function isUsableResponse(response: DataQueryResponse): boolean {
  return !responseError(response) && response.state !== LoadingState.Error && response.data.length > 0;
}

export class SiftDataSourceCache {
  private cache: Map<number, CacheEntry> = new Map();
  // Sequence numbers stop a slow, older request from overwriting the result of a newer one
  private requestSeq = 0;
  private lastWrittenSeq: Map<number, number> = new Map();
  private clearedSeq = 0;

  clearCache() {
    this.cache.clear();
    this.clearedSeq = this.requestSeq;
  }

  clearPanelCache(panelId?: number) {
    if (panelId !== undefined) {
      this.cache.delete(panelId);
      this.lastWrittenSeq.set(panelId, this.requestSeq);
    }
  }

  private setCacheEntry(panelId: number, entry: CacheEntry) {
    const floor = Math.max(this.lastWrittenSeq.get(panelId) ?? 0, this.clearedSeq);
    if (entry.seq <= floor) {
      return;
    }
    this.cache.set(panelId, { ...entry, response: { ...entry.response, data: entry.response.data.map(copyFrame) } });
    this.lastWrittenSeq.set(panelId, entry.seq);
  }

  // very basic key generation from the query. Any change a user makes will invalidate (including ordering of the queries)
  private generateTargetsKey(request: DataQueryRequest<SiftQuery>): string {
    return JSON.stringify(
      // perform variable replacement to catch any changes in the panel
      request.targets.map((target) => {
        return {
          ...target,
          query: replaceTemplateVariablesInQuery(target, request.scopedVars),
        };
      })
    );
  }

  /* queryWithCache pulls data from cache if possible, otherwise fetches from backend.
   * Cache is saved for each panel and keyed on the targets and intervalMs.
   * If the targets or intervalMs change, the cache is invalidated.
   * If the new query range is outside of the cached window, only the missing data on either side is fetched.
   * Data from now() going back MIN_LIVE_LOOKBACK_TIME_MS is fetched always if it is within the query range.
   * A range inside the cached window, including a refresh of the same range, is served from cache.
   * Only usable responses are cached. If a fetch fails, previously cached data is returned instead.
   * */
  async queryWithCache(
    request: DataQueryRequest<SiftQuery>,
    fetchCallback: (req: DataQueryRequest<SiftQuery>) => Observable<DataQueryResponse>
  ): Promise<DataQueryResponse> {
    const panelId = typeof request.panelId === 'number' ? request.panelId : -1; // if not in a dashboard, will be "undefined"
    const seq = ++this.requestSeq;
    try {
      const liveLookbackTime = Date.now() - MIN_LIVE_LOOKBACK_TIME_MS;

      // New request meta
      const newFrom = request.range.from.valueOf();
      const newTo = request.range.to.valueOf();
      const currentTargetsKey = this.generateTargetsKey(request);
      const newIntervalMs = request.intervalMs;

      // Check if we're looking at recent data (liveish)
      const isLiveishData = newTo >= liveLookbackTime;

      const cacheEntry = this.cache.get(panelId);
      const usableCacheEntry =
        cacheEntry &&
        currentTargetsKey === cacheEntry.targetsKey && // targets (query) unchanged
        newIntervalMs === cacheEntry.fetchedIntervalMs // same resolution/sample frequency
          ? cacheEntry
          : undefined;

      // No usable cache or all data is liveish → full fetch
      if (!usableCacheEntry || liveLookbackTime <= newFrom) {
        const fullData = await lastValueFrom(fetchCallback(request));

        if (isUsableResponse(fullData)) {
          this.setCacheEntry(panelId, {
            request,
            response: fullData,
            targetsKey: currentTargetsKey,
            fetchedIntervalMs: request.intervalMs,
            seq,
          });
          return fullData;
        }

        // Keep showing the last good data for failed queries, and keep any error so the panel can show it
        if (usableCacheEntry) {
          const cachedFrames = usableCacheEntry.response.data.map((df: DataFrame) =>
            filterFrameByTimeRange(df, newFrom, newTo)
          );
          return { ...fullData, data: mergeWithCachedFrames(fullData, cachedFrames) };
        }
        return fullData;
      }

      // We have a cache with same targets/interval: figure out missing sub‑ranges
      const oldFrom = usableCacheEntry.request.range.from.valueOf();
      const oldTo = usableCacheEntry.request.range.to.valueOf();
      let cacheFrom = oldFrom;
      let cacheTo = oldTo;

      const fetchRanges: Array<{ from: number; to: number }> = [];

      // Add range for historical data if needed
      if (newFrom < oldFrom) {
        fetchRanges.push({ from: newFrom, to: oldFrom });
      }

      // Add range for new data if needed
      if (newTo > oldTo) {
        // always make sure we are fetching the last MIN_LIVE_LOOKBACK_TIME_MS new
        if (isLiveishData && oldTo > liveLookbackTime) {
          cacheTo = oldFrom < liveLookbackTime ? liveLookbackTime : oldTo;
          fetchRanges.push({ from: cacheTo, to: newTo });
        } else {
          fetchRanges.push({ from: oldTo, to: newTo });
        }
      }

      if (fetchRanges.length === 0) {
        return {
          ...usableCacheEntry.response,
          data: usableCacheEntry.response.data.map((df: DataFrame) => filterFrameByTimeRange(df, newFrom, newTo)),
        };
      }

      const cachedFrames: DataFrame[] = usableCacheEntry.response.data;

      // If we're looking at live data, filter out the recent data from the cached frame
      let trimmedCacheFrames = cachedFrames;
      if (isLiveishData) {
        trimmedCacheFrames = cachedFrames.map((cachedFrame) => {
          return filterFrameByTimeRange(cachedFrame, cacheFrom, cacheTo);
        });
      }

      let newFrames: DataFrame[][] = [];
      let fetchError: DataQueryError | undefined;
      // Sequential processing using reduce since parallel requests will cancel each other
      await fetchRanges.reduce(async (previousPromise, rng) => {
        await previousPromise; // Wait for the previous request to complete

        try {
          const subReq: DataQueryRequest<SiftQuery> = {
            ...request,
            range: {
              from: dateTime(rng.from),
              to: dateTime(rng.to),
              raw: { from: dateTime(rng.from), to: dateTime(rng.to) },
            },
          };

          const subResp = await lastValueFrom(fetchCallback(subReq));
          if (isUsableResponse(subResp)) {
            newFrames.push(subResp.data);
          } else {
            fetchError = fetchError ?? responseError(subResp) ?? { message: 'No data returned' };
            console.error(
              `Panel ${panelId} - Failed to fetch data from ${new Date(rng.from).toISOString()} to ${new Date(
                rng.to
              ).toISOString()}`,
              subResp
            );
          }
        } catch (error) {
          fetchError = fetchError ?? { message: String(error) };
          console.error(
            `Panel ${panelId} - Error fetching range ${new Date(rng.from).toISOString()} to ${new Date(
              rng.to
            ).toISOString()}:`,
            error
          );
        }
      }, Promise.resolve());

      let refIdToFrameMap = new Map<string, DataFrame>();

      // Initialize the map with trimmed cache frames
      trimmedCacheFrames.forEach((frame) => {
        if (frame.refId) {
          refIdToFrameMap.set(frame.refId, frame);
        }
      });

      // Process new frames and merge with cached ones
      newFrames.forEach((frames) => {
        frames.forEach((frame) => {
          if (frame.refId) {
            const cachedFrame = refIdToFrameMap.get(frame.refId);
            if (cachedFrame) {
              refIdToFrameMap.set(frame.refId, appendFramesByTime(cachedFrame, frame));
            } else {
              refIdToFrameMap.set(frame.refId, frame);
            }
          }
        });
      });

      // Convert map back to array
      const updatedCacheFrames = Array.from(refIdToFrameMap.values());

      const filteredFrames = updatedCacheFrames.map((frame) => filterFrameByTimeRange(frame, newFrom, newTo));

      const result: DataQueryResponse = fetchError
        ? { data: filteredFrames, errors: [fetchError], state: LoadingState.Error }
        : { data: filteredFrames };

      // Update cache to this full new range+response. Skip it if a range failed.
      if (!fetchError) {
        this.setCacheEntry(panelId, {
          request,
          response: result,
          targetsKey: currentTargetsKey,
          fetchedIntervalMs: newIntervalMs,
          seq,
        });
      }

      return result;
    } catch (e) {
      console.error(`Panel ${panelId} - Failed to handle cache`, e);
      return await lastValueFrom(fetchCallback(request));
    }
  }
}

// Uses fresh frames for queries that succeeded, and cached frames for queries that failed or returned nothing.
// The backend returns one frame per refId.
function mergeWithCachedFrames(fresh: DataQueryResponse, cachedFrames: DataFrame[]): DataFrame[] {
  const failedRefIds = new Set(fresh.errors?.map((e) => e.refId));
  const refIdToFrameMap = new Map<string | undefined, DataFrame>();
  cachedFrames.forEach((df) => refIdToFrameMap.set(df.refId, withStaleNotice(df)));
  fresh.data.forEach((df: DataFrame) => {
    if (!failedRefIds.has(df.refId)) {
      refIdToFrameMap.set(df.refId, df);
    }
  });
  return Array.from(refIdToFrameMap.values());
}

// Copies meta so the notice is never added to the cached entry
function withStaleNotice(frame: DataFrame): DataFrame {
  return { ...frame, meta: { ...frame.meta, notices: [...(frame.meta?.notices ?? []), STALE_DATA_NOTICE] } };
}

// Grafana empties the value arrays of frames it has finished rendering, so the cache must hold its own copy
export function copyFrame(frame: DataFrame): DataFrame {
  return {
    ...frame,
    fields: frame.fields.map((field) => ({
      ...field,
      values: field.values.slice(),
      ...(field.nanos && { nanos: field.nanos.slice() }),
      state: undefined,
    })),
  };
}

// Filters a DataFrame to only include rows within the specified time range
export function filterFrameByTimeRange(frame: DataFrame, fromTime: number, toTime: number): DataFrame {
  // Find the time field
  const timeFieldIndex = frame.fields.findIndex((f) => f.type === FieldType.time);
  if (timeFieldIndex === -1) {
    // Always copy the frame to avoid a frame shared with the cached being cleared by Grafana.
    return copyFrame(frame);
  }

  // Get time values
  const timeField = frame.fields[timeFieldIndex];
  const times = timeField.values;

  // Find indices that are within the requested time range
  const validIndices: number[] = [];
  times.forEach((time, index) => {
    if (time >= fromTime && time <= toTime) {
      validIndices.push(index);
    }
  });

  // Create a new frame with only the data points in the requested range
  return toDataFrame({
    refId: frame.refId,
    name: frame.name,
    meta: frame.meta,
    fields: frame.fields.map((field) => {
      const values = field.values;
      const nanos = field.nanos;
      return {
        ...field,
        values: validIndices.map((i) => values[i]),
        ...(nanos && { nanos: validIndices.map((i) => nanos[i]) }),
      };
    }),
  });
}

// Build a stable composite key from name+labels
function makeCompositeKey(name: string, labels: Labels): string {
  const sorted = Object.keys(labels)
    .sort()
    .reduce<Record<string, string>>((acc, k) => {
      acc[k] = labels[k]!;
      return acc;
    }, {});
  return JSON.stringify({ name, labels: sorted });
}

// Append cached + new frames. Assumes no overlap.
export function appendFramesByTime(cached: DataFrame, fresh: DataFrame): DataFrame {
  //  Extract time arrays
  const getTimes = (df: DataFrame) => df.fields.find((f) => f.type === FieldType.time)!.values as number[];
  const cachedTimes = getTimes(cached);
  const freshTimes = getTimes(fresh);
  const cachedFirst = Math.min(...cachedTimes);
  const freshFirst = Math.min(...freshTimes);

  // Decide ordering: which slice comes first?
  let first = cached;
  let second = fresh;
  // if fresh entirely before our cached slice, flip
  if (cachedFirst > freshFirst) {
    first = fresh;
    second = cached;
  }

  // Union all columns by compositeKey(name+labels)
  const schema = new Map<string, Field>();
  [first, second].forEach((df) =>
    df.fields.forEach((f) => {
      const key = f.labels ? makeCompositeKey(f.name, f.labels) : f.name;
      if (!schema.has(key)) {
        schema.set(key, {
          ...f,
          name: f.name,
          type: f.type,
          config: f.config,
          labels: f.labels,
        });
      }
    })
  );
  const keys = Array.from(schema.keys());

  //  Build lookup maps of values[], filling null for missing columns
  const buildMap = (df: DataFrame) => {
    const map = new Map<string, any[]>();
    // init every key to an array of nulls
    keys.forEach((k) => map.set(k, Array(df.length).fill(null)));
    // then overwrite with real values where present
    df.fields.forEach((f) => {
      const key = f.labels ? makeCompositeKey(f.name, f.labels) : f.name;
      map.set(key, (f.values as any[]).slice());
    });
    return map;
  };
  const mapA = buildMap(first);
  const mapB = buildMap(second);

  // Concatenate nanos with the values, filling 0 where only one side has them
  const getNanos = (df: DataFrame, key: string) =>
    df.fields.find((f) => (f.labels ? makeCompositeKey(f.name, f.labels) : f.name) === key)?.nanos;
  const mergeNanos = (key: string) => {
    const nanosA = getNanos(first, key);
    const nanosB = getNanos(second, key);
    if (!nanosA && !nanosB) {
      return undefined;
    }
    return (nanosA ?? Array(first.length).fill(0)).concat(nanosB ?? Array(second.length).fill(0));
  };

  // Concatenate values for each column
  const mergedFields: Field[] = keys.map((key) => {
    const meta = schema.get(key)!;
    const valsA = mapA.get(key)!;
    const valsB = mapB.get(key)!;
    return {
      ...meta,
      values: valsA.concat(valsB),
      nanos: mergeNanos(key),
    };
  });

  return {
    ...cached,
    fields: mergedFields,
    length: mergedFields[0].values.length,
  };
}
