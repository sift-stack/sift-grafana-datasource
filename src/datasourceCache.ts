import {
  DataQueryError,
  DataQueryResponse,
  DataQueryRequest,
  LoadingState,
  toDataFrame,
  dateTime,
  FieldType,
  DataFrame,
  outerJoinDataFrames,
  Field,
  Labels,
  FieldConfig,
} from '@grafana/data';
import { Observable, defer, from, lastValueFrom, of } from 'rxjs';
import { catchError, concatWith, map, scan, tap } from 'rxjs/operators';
import { SiftQuery } from './types';
import { replaceTemplateVariablesInQuery } from './utils';

// Any data newer than this will always be requested from the datasource backend
export const MIN_LIVE_LOOKBACK_TIME_MS = 10 * 60 * 1_000; // 10 minutes

const EMPTY_RESPONSE: DataQueryResponse = { data: [] };

interface CacheEntry {
  request: DataQueryRequest<SiftQuery>;
  response: DataQueryResponse;
  targetsKey: string;
  fetchedIntervalMs: number;
}

/** responseHasError reports whether a response failed, in any of the three ways Grafana
 * signals it: the errors array, the deprecated singular error, or the loading state. */
export function responseHasError(response: DataQueryResponse): boolean {
  return Boolean(response.errors?.length || response.error || response.state === LoadingState.Error);
}

/**
 * mergeResponsesByRefId folds one emission of the async query stream into the running
 * result, keyed by refId.
 *
 * The backend runs each query block as its own async job, and DatasourceWithAsyncBackend
 * polls each one on an independent loop before merging the loops into a single stream. So
 * an emission carries only the frames of the block that produced it: a panel with blocks A
 * and B emits A's frames when A finishes, then B's when B finishes. Taking the last value
 * would keep B and silently discard A. Each emission replaces the entry for its own refIds
 * and leaves the others alone.
 */
export function mergeResponsesByRefId(acc: DataQueryResponse, next: DataQueryResponse): DataQueryResponse {
  // refIds in the order they were first seen, so a panel's series do not reshuffle as
  // blocks finish in different orders on different loads.
  const order: string[] = [];

  const groupInto = <T extends { refId?: string }>(
    target: Map<string, T[]>,
    items: T[] | undefined,
    replace: boolean
  ): Set<string> => {
    const refreshed = new Set<string>();
    for (const item of items ?? []) {
      const key = item?.refId ?? '';
      if (!order.includes(key)) {
        order.push(key);
      }
      if (replace && !refreshed.has(key)) {
        target.set(key, []);
        refreshed.add(key);
      }
      target.set(key, [...(target.get(key) ?? []), item]);
    }
    return refreshed;
  };

  const frames = new Map<string, DataFrame[]>();
  const errors = new Map<string, DataQueryError[]>();

  groupInto(frames, acc.data, false);
  groupInto(errors, acc.errors, false);
  // A refId present in this emission supersedes whatever we held for it, including the
  // case where a block that previously errored now returns data.
  const refreshedFrames = groupInto(frames, next.data, true);
  const refreshedErrors = groupInto(errors, next.errors, true);
  for (const key of refreshedFrames) {
    if (!refreshedErrors.has(key)) {
      errors.delete(key);
    }
  }

  const data: DataFrame[] = [];
  const mergedErrors: DataQueryError[] = [];
  for (const key of order) {
    data.push(...(frames.get(key) ?? []));
    mergedErrors.push(...(errors.get(key) ?? []));
  }

  const merged: DataQueryResponse = { ...acc, ...next, data };
  if (mergedErrors.length) {
    merged.errors = mergedErrors;
  } else {
    delete merged.errors;
    delete merged.error;
  }
  return merged;
}

/**
 * collectResponses turns the multi-emission async query stream into a stream of complete
 * results, each one the accumulation of every block seen so far. The final emission is the
 * whole panel's data, so a consumer that only wants the settled result can take the last
 * value without losing anything.
 *
 * Unsubscribing propagates to the source, which is how @grafana/async-query-data learns to
 * POST its cancel: it fires that from the teardown of its own observable.
 */
export function collectResponses(source: Observable<DataQueryResponse>): Observable<DataQueryResponse> {
  // defer gives each subscription its own accumulator, so two subscribers cannot
  // interleave into one running result.
  return defer(() => {
    let latest = EMPTY_RESPONSE;
    return source.pipe(
      scan(mergeResponsesByRefId, EMPTY_RESPONSE),
      tap((response) => {
        latest = response;
      }),
      map((response) => ({
        ...response,
        // Interim: another block may still be running, so this is not Done yet.
        state: responseHasError(response) ? LoadingState.Error : LoadingState.Streaming,
      })),
      // Only once the merged stream completes is the terminal state known. This also
      // covers a stream that never emits at all (every target hidden), which would
      // otherwise leave lastValueFrom rejecting with EmptyError.
      concatWith(
        defer(() =>
          of({
            ...latest,
            state: responseHasError(latest) ? LoadingState.Error : LoadingState.Done,
          })
        )
      )
    );
  });
}

export class SiftDataSourceCache {
  private cache: Map<number, CacheEntry> = new Map();

  clearCache() {
    this.cache.clear();
  }

  clearPanelCache(panelId?: number) {
    if (panelId !== undefined) {
      this.cache.delete(panelId);
    }
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
   * */
  queryWithCache(
    request: DataQueryRequest<SiftQuery>,
    fetchCallback: (req: DataQueryRequest<SiftQuery>) => Observable<DataQueryResponse>
  ): Observable<DataQueryResponse> {
    const panelId = typeof request.panelId === 'number' ? request.panelId : -1; // if not in a dashboard, will be "undefined"
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

      // No cache yet or targets/interval changed/data is within min live time → full fetch
      if (
        !cacheEntry || // no cache data
        cacheEntry.response?.errors || // cache has errors
        currentTargetsKey !== cacheEntry.targetsKey || // targets (query) changed
        newIntervalMs !== cacheEntry.fetchedIntervalMs || // new resolution/sample frequency requested
        liveLookbackTime <= newFrom // all data is liveish
      ) {
        return this.fullFetch(panelId, request, currentTargetsKey, fetchCallback);
      }

      // We have a cache with same targets/interval: figure out missing sub‑ranges
      const oldFrom = cacheEntry.request.range.from.valueOf();
      const oldTo = cacheEntry.request.range.to.valueOf();
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
        return of({
          ...cacheEntry.response,
          state: LoadingState.Done,
          data: cacheEntry.response.data.map((df: DataFrame) => filterFrameByTimeRange(df, newFrom, newTo)),
        });
      }

      const cachedFrames: DataFrame[] = cacheEntry.response.data;

      // If we're looking at live data, filter out the recent data from the cached frame
      let trimmedCacheFrames = cachedFrames;
      if (isLiveishData) {
        trimmedCacheFrames = cachedFrames.map((cachedFrame) => {
          return filterFrameByTimeRange(cachedFrame, cacheFrom, cacheTo);
        });
      }

      // The sub-range fetches stay promise-based: they are short follow-up reads over the
      // gap between the cached window and the requested one, run one after another.
      return defer(() =>
        from(
          this.fetchAndMergeRanges({
            panelId,
            request,
            fetchCallback,
            fetchRanges,
            trimmedCacheFrames,
            currentTargetsKey,
            newFrom,
            newTo,
            newIntervalMs,
          })
        )
      ).pipe(catchError(() => this.fallbackFetch(request, fetchCallback)));
    } catch (e) {
      console.error(`Panel ${panelId} - Failed to handle cache`, e);
      return this.fallbackFetch(request, fetchCallback);
    }
  }

  /**
   * fullFetch reads the whole requested range from the backend. It returns the live stream
   * rather than a promise, so the panel renders each query block as it lands and, just as
   * importantly, an unsubscribe reaches @grafana/async-query-data and makes it cancel the
   * jobs it started. Awaiting a promise here would swallow that teardown, which is what
   * left the backend relying on its idle reaper to notice an abandoned query.
   */
  private fullFetch(
    panelId: number,
    request: DataQueryRequest<SiftQuery>,
    targetsKey: string,
    fetchCallback: (req: DataQueryRequest<SiftQuery>) => Observable<DataQueryResponse>
  ): Observable<DataQueryResponse> {
    return defer(() => {
      let latest: DataQueryResponse | undefined;
      return collectResponses(fetchCallback(request)).pipe(
        tap({
          next: (response) => {
            latest = response;
          },
          complete: () => {
            // Only a stream that ran to completion is worth caching. An unsubscribe skips
            // this, so a superseded panel cannot leave a half-finished result behind, and
            // a failed response is not cached at all.
            if (latest && !responseHasError(latest)) {
              this.cache.set(panelId, {
                request,
                response: latest,
                targetsKey,
                fetchedIntervalMs: request.intervalMs,
              });
            }
          },
        })
      );
    });
  }

  /** fallbackFetch reads the range without touching the cache, for when cache handling
   * itself fails and the panel should still get its data. */
  private fallbackFetch(
    request: DataQueryRequest<SiftQuery>,
    fetchCallback: (req: DataQueryRequest<SiftQuery>) => Observable<DataQueryResponse>
  ): Observable<DataQueryResponse> {
    return collectResponses(fetchCallback(request));
  }

  private async fetchAndMergeRanges(args: {
    panelId: number;
    request: DataQueryRequest<SiftQuery>;
    fetchCallback: (req: DataQueryRequest<SiftQuery>) => Observable<DataQueryResponse>;
    fetchRanges: Array<{ from: number; to: number }>;
    trimmedCacheFrames: DataFrame[];
    currentTargetsKey: string;
    newFrom: number;
    newTo: number;
    newIntervalMs: number;
  }): Promise<DataQueryResponse> {
    const {
      panelId,
      request,
      fetchCallback,
      fetchRanges,
      trimmedCacheFrames,
      currentTargetsKey,
      newFrom,
      newTo,
      newIntervalMs,
    } = args;

    let newFrames: DataFrame[][] = [];
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

        const subResp = await lastValueFrom(collectResponses(fetchCallback(subReq)));
        if (!responseHasError(subResp) && subResp.data.length > 0) {
          newFrames.push(subResp.data);
        } else {
          console.error(
            `Panel ${panelId} - Failed to fetch data from ${new Date(rng.from).toISOString()} to ${new Date(
              rng.to
            ).toISOString()}`,
            subResp
          );
        }
      } catch (error) {
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

    const result: DataQueryResponse = { data: filteredFrames, state: LoadingState.Done };

    // Update cache to this full new range+response
    this.cache.set(panelId, {
      request,
      response: result,
      targetsKey: currentTargetsKey,
      fetchedIntervalMs: newIntervalMs,
    });

    return result;
  }
}

// Filters a DataFrame to only include rows within the specified time range
export function filterFrameByTimeRange(frame: DataFrame, fromTime: number, toTime: number): DataFrame {
  // Find the time field
  const timeFieldIndex = frame.fields.findIndex((f) => f.type === FieldType.time);
  if (timeFieldIndex === -1) {
    return frame;
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

  // Create a new frame with only the data points in the requested range.
  // meta is carried over deliberately: the backend attaches its warnings there (partial
  // data, precision loss), and rebuilding the frame without it would drop them silently.
  return toDataFrame({
    refId: frame.refId,
    name: frame.name,
    meta: frame.meta,
    fields: frame.fields.map((field) => {
      const values = field.values;
      return {
        ...field,
        values: validIndices.map((i) => values[i]),
      };
    }),
  });
}

// Combines the frame metadata of two slices of the same series. Notices from both are
// kept, deduplicated on their text, so a warning raised while fetching one slice is not
// lost when it is stitched onto another.
function mergeFrameMeta(first: DataFrame, second: DataFrame): DataFrame['meta'] {
  if (!first.meta && !second.meta) {
    return undefined;
  }
  const notices = [...(first.meta?.notices ?? []), ...(second.meta?.notices ?? [])];
  const seen = new Set<string>();
  const uniqueNotices = notices.filter((notice) => {
    const key = `${notice.severity}:${notice.text}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  const meta = { ...first.meta, ...second.meta };
  if (uniqueNotices.length) {
    meta.notices = uniqueNotices;
  } else {
    delete meta.notices;
  }
  return meta;
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

  // Concatenate values for each column
  const mergedFields: Field[] = keys.map((key) => {
    const meta = schema.get(key)!;
    const valsA = mapA.get(key)!;
    const valsB = mapB.get(key)!;
    return {
      ...meta,
      values: valsA.concat(valsB),
    };
  });

  return {
    ...cached,
    meta: mergeFrameMeta(cached, fresh),
    fields: mergedFields,
    length: mergedFields[0].values.length,
  };
}
