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
} from '@grafana/data';
import { Observable, firstValueFrom } from 'rxjs';
import { SiftQuery } from './types';
import { replaceTemplateVariablesInQuery } from './utils';

// Any data newer than this will always be requested from the datasource backend
export const MIN_LIVE_LOOKBACK_TIME_MS = 10 * 60 * 1_000; // 10 minutes

interface CacheEntry {
  request: DataQueryRequest<SiftQuery>;
  response: DataQueryResponse;
  targetsKey: string;
  fetchedIntervalMs: number;
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
  async queryWithCache(
    request: DataQueryRequest<SiftQuery>,
    fetchCallback: (req: DataQueryRequest<SiftQuery>) => Observable<DataQueryResponse>
  ): Promise<DataQueryResponse> {
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
        const fullData = await firstValueFrom(fetchCallback(request));

        // Store in cache
        this.cache.set(panelId, {
          request,
          response: fullData,
          targetsKey: currentTargetsKey,
          fetchedIntervalMs: request.intervalMs,
        });

        return fullData;
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
        return {
          ...cacheEntry.response,
          data: cacheEntry.response.data.map((df: DataFrame) => filterFrameByTimeRange(df, newFrom, newTo)),
        };
      }

      const cachedFrames: DataFrame[] = cacheEntry.response.data;

      // If we're looking at live data, filter out the recent data from the cached frame
      let trimmedCacheFrames = cachedFrames;
      if (isLiveishData) {
        trimmedCacheFrames = cachedFrames.map((cachedFrame) => {
          return filterFrameByTimeRange(cachedFrame, cacheFrom, cacheTo);
        });
      }

      let newFrames: DataFrame[][] = [];
      // Fire off sub‑queries for each missing range
      await Promise.all(
        fetchRanges.map(async (rng) => {
          const subReq: DataQueryRequest<SiftQuery> = {
            ...request,
            range: {
              from: dateTime(rng.from),
              to: dateTime(rng.to),
              raw: { from: dateTime(rng.from), to: dateTime(rng.to) },
            },
          };

          const subResp = await firstValueFrom(fetchCallback(subReq));
          if (!subResp.errors && subResp.data.length > 0) {
            newFrames.push(subResp.data);
          } else {
            console.error(
              `Panel ${panelId} - Failed to fetch data from ${new Date(rng.from).toISOString()} to ${new Date(
                rng.to
              ).toISOString()}`
            );
          }
        })
      );

      let updatedCacheFrames: DataFrame[] = [];
      newFrames.forEach((frames) => {
        frames.forEach((frame) => {
          const matchingCachedFrame = trimmedCacheFrames.find((cachedFrame) => {
            return cachedFrame.refId === frame.refId;
          });

          // If cached frame exists, append to it
          if (matchingCachedFrame) {
            updatedCacheFrames.push(appendFramesByTime(matchingCachedFrame, frame));
          } else {
            updatedCacheFrames.push(frame);
          }
        });
      });

      const filteredFrames = updatedCacheFrames.map((frame) => filterFrameByTimeRange(frame, newFrom, newTo));

      const result: DataQueryResponse = { data: filteredFrames };

      // Update cache to this full new range+response
      this.cache.set(panelId, {
        request,
        response: result,
        targetsKey: currentTargetsKey,
        fetchedIntervalMs: newIntervalMs,
      });

      return result;
    } catch (e) {
      console.error(`Panel ${panelId} - Failed to handle cache`, e);
      return await firstValueFrom(fetchCallback(request));
    }
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

  // Create a new frame with only the data points in the requested range
  return toDataFrame({
    refId: frame.refId,
    name: frame.name,
    fields: frame.fields.map((field) => {
      const values = field.values;
      return {
        ...field,
        values: validIndices.map((i) => values[i]),
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
    fields: mergedFields,
    length: mergedFields[0].values.length,
  };
}
