import {
  DataQueryRequest,
  DataQueryResponse,
  FieldType,
  LoadingState,
  dateTime,
  toDataFrame,
  Field,
} from '@grafana/data';
import { Subject, of } from 'rxjs';
import {
  SiftDataSourceCache,
  MIN_LIVE_LOOKBACK_TIME_MS,
  filterFrameByTimeRange,
  appendFramesByTime,
  isUsableResponse,
} from './datasourceCache';
import { SiftQuery } from './types';

// Mock the template service
jest.mock('@grafana/runtime', () => ({
  getTemplateSrv: () => ({
    replace: (str: string) => str, // Simple mock that returns the input string
  }),
}));

// Mock the MIN_LIVE_LOOKBACK_TIME_MS constant
const MOCK_TIME = new Date('2024-01-01T00:00:00.000Z').getTime(); // Fixed timestamp for testing
const MOCK_TIME_NOW = new Date('2025-01-01T12:30:00.000Z').getTime();

// Helper time constants for readability
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

// Mock Date.now() to return a consistent value for testing
jest.spyOn(Date, 'now').mockImplementation(() => MOCK_TIME_NOW);

describe('SiftDataSourceCache', () => {
  let cache: SiftDataSourceCache;
  let mockFetchCallback: jest.Mock;

  // Helper to create a mock data frame with time series data
  const createMockDataFrame = (
    from: number,
    to: number,
    step = MINUTE, // 1 minute steps by default
    refId = 'A',
    withLabels = false
  ) => {
    const times: number[] = [];
    const values1: number[] = [];
    const values2: number[] = [];

    for (let t = from; t <= to; t += step) {
      times.push(t);
      values1.push(Math.random() * 100); // Random values
      values2.push(Math.random() * 100); // Random values for second series
    }

    const fields: Field[] = [{ name: 'time', type: FieldType.time, values: times, config: { displayName: 'Time' } }];

    if (withLabels) {
      // Add fields with labels to simulate channel data
      fields.push({
        name: 'value1',
        type: FieldType.number,
        values: values1,
        labels: { channel: 'channel1', unit: 'temp' },
        config: { displayName: 'Value 1' },
      });
      fields.push({
        name: 'value2',
        type: FieldType.number,
        values: values2,
        labels: { channel: 'channel2', unit: 'temp' },
        config: { displayName: 'Value 2' },
      });
    } else {
      fields.push({ name: 'value', type: FieldType.number, values: values1, config: { displayName: 'Value' } });
    }

    return toDataFrame({
      refId,
      fields,
    });
  };

  // Helper to create a mock query request
  const createMockRequest = (
    from: number,
    to: number,
    panelId = 1,
    intervalMs = MINUTE
  ): DataQueryRequest<SiftQuery> => {
    return {
      requestId: 'mock-request',
      interval: '1m',
      intervalMs,
      panelId,
      range: {
        from: dateTime(from),
        to: dateTime(to),
        raw: {
          from: dateTime(from),
          to: dateTime(to),
        },
      },
      scopedVars: {},
      targets: [
        {
          refId: 'A',
          queryVersion: '2',
          channelDataQueries: [],
        },
      ],
      timezone: 'utc',
      app: 'dashboard',
      startTime: 0,
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    cache = new SiftDataSourceCache();

    // Mock the fetch callback to return test data
    mockFetchCallback = jest.fn().mockImplementation((request: DataQueryRequest<SiftQuery>) => {
      const from = request.range.from.valueOf();
      const to = request.range.to.valueOf();
      const dataFrame = createMockDataFrame(from, to);

      const response: DataQueryResponse = {
        data: [dataFrame],
      };

      return of(response);
    });
  });

  describe('queryWithCache', () => {
    it('should fetch data when cache is empty', async () => {
      // Request data for the last hour
      const request = createMockRequest(MOCK_TIME, MOCK_TIME + HOUR);
      const response = await cache.queryWithCache(request, mockFetchCallback);

      expect(mockFetchCallback).toHaveBeenCalledTimes(1);
      expect(response.data).toHaveLength(1);
      expect(response.data[0].fields[0].values.length).toBeGreaterThan(0);
    });

    it('should use cached data when available and time range is contained', async () => {
      // Initial request for the last hour
      const initialRequest = createMockRequest(MOCK_TIME, MOCK_TIME + HOUR);
      await cache.queryWithCache(initialRequest, mockFetchCallback);
      expect(mockFetchCallback).toHaveBeenCalledTimes(1);

      // Narrower range inside the cached window
      mockFetchCallback.mockClear();
      const containedRequest = createMockRequest(MOCK_TIME + MINUTE, MOCK_TIME + HOUR - MINUTE);
      await cache.queryWithCache(containedRequest, mockFetchCallback);

      // Should not call fetch again
      expect(mockFetchCallback).not.toHaveBeenCalled();
    });

    it('should fetch only missing data when expanding time range, left side', async () => {
      // Initial request for last hour
      const initialRequest = createMockRequest(MOCK_TIME, MOCK_TIME + HOUR);
      await cache.queryWithCache(initialRequest, mockFetchCallback);

      mockFetchCallback.mockClear();

      // Expanded request for last two hours
      const expandedRequest = createMockRequest(MOCK_TIME - HOUR, MOCK_TIME + HOUR);
      await cache.queryWithCache(expandedRequest, mockFetchCallback);

      // Should fetch only the missing hour
      expect(mockFetchCallback).toHaveBeenCalledTimes(1);
      const fetchedRequest = mockFetchCallback.mock.calls[0][0];
      expect(fetchedRequest.range.from.valueOf()).toBe(MOCK_TIME - HOUR);
      expect(fetchedRequest.range.to.valueOf()).toBe(MOCK_TIME);
    });

    it('should fetch only missing data when expanding time range, right side', async () => {
      // Initial request for last hour
      const initialRequest = createMockRequest(MOCK_TIME, MOCK_TIME + HOUR);
      await cache.queryWithCache(initialRequest, mockFetchCallback);

      mockFetchCallback.mockClear();

      // Expanded request for last two hours
      const expandedRequest = createMockRequest(MOCK_TIME, MOCK_TIME + 2 * HOUR);
      await cache.queryWithCache(expandedRequest, mockFetchCallback);

      // Should fetch only the missing hour
      expect(mockFetchCallback).toHaveBeenCalledTimes(1);
      const fetchedRequest = mockFetchCallback.mock.calls[0][0];
      expect(fetchedRequest.range.from.valueOf()).toBe(MOCK_TIME + HOUR);
      expect(fetchedRequest.range.to.valueOf()).toBe(MOCK_TIME + 2 * HOUR);
    });

    it('should always fetch recent data within MIN_LIVE_LOOKBACK_TIME_MS', async () => {
      // Initial request for last hour
      const initialRequest = createMockRequest(MOCK_TIME_NOW - 15 * MINUTE - MINUTE, MOCK_TIME_NOW - MINUTE);
      await cache.queryWithCache(initialRequest, mockFetchCallback);

      // Move window by 1 min to simulate grafana live refresh
      const slideRequest = createMockRequest(MOCK_TIME_NOW - 15 * MINUTE, MOCK_TIME_NOW);
      await cache.queryWithCache(slideRequest, mockFetchCallback);

      // Should fetch recent data even though the entire range is cached
      expect(mockFetchCallback).toHaveBeenCalledTimes(2);
      const fetchedRequest = mockFetchCallback.mock.calls[1][0];

      // Should fetch from the live lookback time to current time
      const liveLookbackTime = MOCK_TIME_NOW - MIN_LIVE_LOOKBACK_TIME_MS;
      expect(fetchedRequest.range.from.valueOf()).toBe(liveLookbackTime);
      expect(fetchedRequest.range.to.valueOf()).toBe(MOCK_TIME_NOW);
    });

    it('should only fetch query time range even if liveish data', async () => {
      // Initial request for last hour
      const initialRequest = createMockRequest(MOCK_TIME - MINUTE, MOCK_TIME_NOW);
      await cache.queryWithCache(initialRequest, mockFetchCallback);

      // Same request again
      const sameRequest = createMockRequest(MOCK_TIME - MINUTE, MOCK_TIME_NOW);
      await cache.queryWithCache(sameRequest, mockFetchCallback);

      // A refresh of the same range fetches the full range again
      expect(mockFetchCallback).toHaveBeenCalledTimes(2);
      const fetchedRequest = mockFetchCallback.mock.calls[1][0];

      // Should fetch from the larger of live lookback time and request time
      expect(fetchedRequest.range.from.valueOf()).toBeLessThanOrEqual(MOCK_TIME - MINUTE);
      expect(fetchedRequest.range.to.valueOf()).toBe(MOCK_TIME_NOW);
    });

    it('should fetch full range when interval changes', async () => {
      // Initial request with 1m interval
      const initialRequest = createMockRequest(MOCK_TIME - HOUR, MOCK_TIME, 1, MINUTE);
      await cache.queryWithCache(initialRequest, mockFetchCallback);

      mockFetchCallback.mockClear();

      // Same time range but different interval (30s)
      const differentIntervalRequest = createMockRequest(MOCK_TIME - HOUR, MOCK_TIME, 1, MINUTE / 2);
      await cache.queryWithCache(differentIntervalRequest, mockFetchCallback);

      // Should fetch the full range again
      expect(mockFetchCallback).toHaveBeenCalledTimes(1);
      const fetchedRequest = mockFetchCallback.mock.calls[0][0];
      expect(fetchedRequest.range.from.valueOf()).toBe(MOCK_TIME - HOUR);
      expect(fetchedRequest.range.to.valueOf()).toBe(MOCK_TIME);
    });

    it('should fetch full range when targets change', async () => {
      // Initial request
      const initialRequest = createMockRequest(MOCK_TIME - HOUR, MOCK_TIME);
      await cache.queryWithCache(initialRequest, mockFetchCallback);

      mockFetchCallback.mockClear();

      // Same time range but different targets
      const differentTargetsRequest = createMockRequest(MOCK_TIME - HOUR, MOCK_TIME);
      differentTargetsRequest.targets = [
        {
          refId: 'B',
          queryVersion: '2',
          channelDataQueries: [{ assetQueries: [{ assetId: 'test' }] }],
        },
      ];

      await cache.queryWithCache(differentTargetsRequest, mockFetchCallback);

      // Should fetch the full range again
      expect(mockFetchCallback).toHaveBeenCalledTimes(1);
    });

    it('should clear cache for a specific panel', async () => {
      // Initial request for panel 1
      const panel1Request = createMockRequest(MOCK_TIME - HOUR, MOCK_TIME, 1);
      await cache.queryWithCache(panel1Request, mockFetchCallback);

      // Initial request for panel 2
      const panel2Request = createMockRequest(MOCK_TIME - HOUR, MOCK_TIME, 2);
      await cache.queryWithCache(panel2Request, mockFetchCallback);

      mockFetchCallback.mockClear();

      // Clear cache for panel 1
      cache.clearPanelCache(1);

      // Request a range inside the cached window for both panels
      await cache.queryWithCache(createMockRequest(MOCK_TIME - HOUR, MOCK_TIME - MINUTE, 1), mockFetchCallback);
      await cache.queryWithCache(createMockRequest(MOCK_TIME - HOUR, MOCK_TIME - MINUTE, 2), mockFetchCallback);

      // Should fetch only for panel 1
      expect(mockFetchCallback).toHaveBeenCalledTimes(1);
      expect(mockFetchCallback.mock.calls[0][0].panelId).toBe(1);
    });

    it('should clear all cache entries', async () => {
      // Initial request for panel 1
      const panel1Request = createMockRequest(MOCK_TIME - HOUR, MOCK_TIME, 1);
      await cache.queryWithCache(panel1Request, mockFetchCallback);

      // Initial request for panel 2
      const panel2Request = createMockRequest(MOCK_TIME - HOUR, MOCK_TIME, 2);
      await cache.queryWithCache(panel2Request, mockFetchCallback);

      mockFetchCallback.mockClear();

      // Clear all cache
      cache.clearCache();

      // Request for panel 1 again
      await cache.queryWithCache(panel1Request, mockFetchCallback);

      // Request for panel 2 again
      await cache.queryWithCache(panel2Request, mockFetchCallback);

      // Should fetch for both panels
      expect(mockFetchCallback).toHaveBeenCalledTimes(2);
    });

    it('should filter data frames to the requested time range', async () => {
      // Create a request with a specific time range (last hour, but only the first half)
      const from = MOCK_TIME - HOUR;
      const to = MOCK_TIME - HOUR / 2;

      // Mock the fetch callback to return data for a wider range (extra 30 min on each side)
      const dataFrame = createMockDataFrame(to, from);

      const trimmedFrame = filterFrameByTimeRange(dataFrame, to + MINUTE, from - MINUTE);

      // The response should only contain data within the requested time range
      const timeField = trimmedFrame.fields.find((f: Field) => f.type === FieldType.time);
      const times = timeField?.values || [];

      // All times should be within the requested range
      expect(times.every((t: number) => t >= to + MINUTE && t <= from - MINUTE)).toBe(true);
    });

    it('should merge frames without creating duplicate columns', async () => {
      // Mock fetch callback to return frames with labeled fields
      mockFetchCallback.mockImplementation((request: DataQueryRequest<SiftQuery>) => {
        const from = request.range.from.valueOf();
        const to = request.range.to.valueOf();
        const dataFrame = createMockDataFrame(from, to, MINUTE, 'A', true); // with labels

        const response: DataQueryResponse = {
          data: [dataFrame],
        };

        return of(response);
      });

      // Initial request for first half of the time range
      const initialRequest = createMockRequest(MOCK_TIME, MOCK_TIME + HOUR / 2);
      await cache.queryWithCache(initialRequest, mockFetchCallback);

      // Now request the full ranges
      const fullRangeRequest = createMockRequest(MOCK_TIME, MOCK_TIME + HOUR);
      const response = await cache.queryWithCache(fullRangeRequest, mockFetchCallback);

      // The result should have exactly 3 fields: time, value1, value2
      expect(response.data).toHaveLength(1);
      expect(response.data[0].fields).toHaveLength(3);

      // Check field names to ensure no duplicates
      const fieldNames = response.data[0].fields.map((f: Field) => f.name);
      expect(fieldNames).toContain('time');

      // Count occurrences of each field name
      const nameCounts = fieldNames.reduce((acc: Record<string, number>, name: string) => {
        acc[name] = (acc[name] || 0) + 1;
        return acc;
      }, {});

      // Verify no field name appears more than once (no duplicates)
      Object.values(nameCounts).forEach((count) => {
        expect(count).toBe(1);
      });

      // Check that we have the correct number of data points
      const timeField = response.data[0].fields.find((f: Field) => f.name === 'time');
      expect(timeField?.values.length).toBeGreaterThanOrEqual(60); // At least 60 minutes worth of data
    });

    it('should correctly handle multiple queries with multiple DataFrames', async () => {
      // Mock fetch callback to return multiple DataFrames for multiple queries
      mockFetchCallback.mockImplementation((request: DataQueryRequest<SiftQuery>) => {
        const from = request.range.from.valueOf();
        const to = request.range.to.valueOf();

        // Create a DataFrame for each target/query
        const dataFrames = request.targets.map((target) => {
          return createMockDataFrame(from, to, MINUTE, target.refId, true);
        });

        const response: DataQueryResponse = {
          data: dataFrames,
        };

        return of(response);
      });

      // Create a request with multiple targets/queries
      const multiQueryRequest = createMockRequest(MOCK_TIME, MOCK_TIME + HOUR);
      multiQueryRequest.targets = [
        {
          refId: 'A',
          queryVersion: '2',
          channelDataQueries: [{ assetQueries: [{ assetId: 'asset1' }] }],
        },
        {
          refId: 'B',
          queryVersion: '2',
          channelDataQueries: [{ assetQueries: [{ assetId: 'asset2' }] }],
        },
        {
          refId: 'C',
          queryVersion: '2',
          channelDataQueries: [{ assetQueries: [{ assetId: 'asset3' }] }],
        },
      ];

      // Initial request for first half of the time range
      const initialResponse = await cache.queryWithCache(multiQueryRequest, mockFetchCallback);

      // Verify we got 3 DataFrames in the response
      expect(initialResponse.data).toHaveLength(3);
      expect(initialResponse.data[0].refId).toBe('A');
      expect(initialResponse.data[1].refId).toBe('B');
      expect(initialResponse.data[2].refId).toBe('C');

      // Clear the mock to track subsequent calls
      mockFetchCallback.mockClear();

      // Now request an expanded time range
      const expandedRequest = { ...multiQueryRequest };
      expandedRequest.range = {
        from: dateTime(MOCK_TIME),
        to: dateTime(MOCK_TIME + HOUR * 2),
        raw: {
          from: dateTime(MOCK_TIME),
          to: dateTime(MOCK_TIME + HOUR * 2),
        },
      };

      const expandedResponse = await cache.queryWithCache(expandedRequest, mockFetchCallback);

      // Verify we still got 3 DataFrames in the response after expanding the range
      expect(expandedResponse.data).toHaveLength(3);
      expect(expandedResponse.data[0].refId).toBe('A');
      expect(expandedResponse.data[1].refId).toBe('B');
      expect(expandedResponse.data[2].refId).toBe('C');

      // Mock should have been called once to fetch the expanded range
      expect(mockFetchCallback).toHaveBeenCalledTimes(1);

      // The fetched request should be for the missing range
      const fetchedRequest = mockFetchCallback.mock.calls[0][0];
      expect(fetchedRequest.range.from.valueOf()).toBe(MOCK_TIME + HOUR);
      expect(fetchedRequest.range.to.valueOf()).toBe(MOCK_TIME + HOUR * 2);

      // Each DataFrame should have data for the full requested range
      expandedResponse.data.forEach((frame) => {
        const timeField = frame.fields.find((f: Field) => f.type === FieldType.time);
        if (timeField) {
          const times = timeField.values;
          // Check that we have times spanning the full range
          const minTime = Math.min(...times);
          const maxTime = Math.max(...times);

          // Allow for some small rounding errors in the test
          expect(minTime).toBeCloseTo(MOCK_TIME, -3);
          expect(maxTime).toBeCloseTo(MOCK_TIME + HOUR * 2, -3);
        }
      });
    });

    describe('failed and refreshed requests', () => {
      // Shapes Grafana returns for a cancelled request and for a dropped connection
      const cancelledResponse = (): DataQueryResponse => ({
        data: [],
        state: LoadingState.Error,
        error: { type: 'cancelled' as any, cancelled: true, status: -1, statusText: 'Request was aborted' } as any,
      });
      const droppedConnectionResponse = (): DataQueryResponse => ({ data: [], state: LoadingState.Done });
      const gatewayTimeoutResponse = (): DataQueryResponse => ({
        data: [],
        state: LoadingState.Error,
        error: { status: 504, statusText: 'Gateway Timeout' } as any,
      });

      const namedFrameResponse = (from: number, to: number, name: string): DataQueryResponse => {
        const frame = createMockDataFrame(from, to);
        frame.name = name;
        return { data: [frame] };
      };

      it.each([
        ['cancelled', cancelledResponse],
        ['dropped connection', droppedConnectionResponse],
        ['gateway timeout', gatewayTimeoutResponse],
      ])('should not cache a %s response', async (_name, badResponse) => {
        const request = createMockRequest(MOCK_TIME, MOCK_TIME + HOUR);
        mockFetchCallback.mockImplementationOnce(() => of(badResponse()));

        const first = await cache.queryWithCache(request, mockFetchCallback);
        expect(first.data).toHaveLength(0);

        // A narrower range would be served from cache if the bad response had been cached
        const second = await cache.queryWithCache(
          createMockRequest(MOCK_TIME + MINUTE, MOCK_TIME + HOUR - MINUTE),
          mockFetchCallback
        );
        expect(mockFetchCallback).toHaveBeenCalledTimes(2);
        expect(second.data).toHaveLength(1);
        expect(second.data[0].length).toBeGreaterThan(0);
      });

      it('should fetch the full range again on a refresh of the same historical range', async () => {
        const request = createMockRequest(MOCK_TIME, MOCK_TIME + HOUR);
        mockFetchCallback.mockImplementationOnce(() => of(namedFrameResponse(MOCK_TIME, MOCK_TIME + HOUR / 2, 'old')));
        await cache.queryWithCache(request, mockFetchCallback);

        // Data for the second half of the range arrives later (store and forward)
        mockFetchCallback.mockImplementationOnce(() => of(namedFrameResponse(MOCK_TIME, MOCK_TIME + HOUR, 'new')));
        const refreshed = await cache.queryWithCache(request, mockFetchCallback);

        expect(mockFetchCallback).toHaveBeenCalledTimes(2);
        expect(mockFetchCallback.mock.calls[1][0].range.from.valueOf()).toBe(MOCK_TIME);
        expect(mockFetchCallback.mock.calls[1][0].range.to.valueOf()).toBe(MOCK_TIME + HOUR);
        expect(refreshed.data[0].name).toBe('new');
        expect(refreshed.data[0].length).toBe(61);
      });

      it('should keep the last good data when a refresh fails', async () => {
        const request = createMockRequest(MOCK_TIME, MOCK_TIME + HOUR);
        mockFetchCallback.mockImplementationOnce(() => of(namedFrameResponse(MOCK_TIME, MOCK_TIME + HOUR, 'good')));
        await cache.queryWithCache(request, mockFetchCallback);

        mockFetchCallback.mockImplementationOnce(() => of(gatewayTimeoutResponse()));
        const failedRefresh = await cache.queryWithCache(request, mockFetchCallback);

        expect(failedRefresh.data).toHaveLength(1);
        expect(failedRefresh.data[0].name).toBe('good');
        expect(failedRefresh.data[0].length).toBe(61);
        // eslint-disable-next-line deprecation/deprecation
        expect(failedRefresh.error?.status).toBe(504);

        // The good data is still cached
        mockFetchCallback.mockClear();
        const contained = await cache.queryWithCache(
          createMockRequest(MOCK_TIME + MINUTE, MOCK_TIME + HOUR - MINUTE),
          mockFetchCallback
        );
        expect(mockFetchCallback).not.toHaveBeenCalled();
        expect(contained.data[0].name).toBe('good');
      });

      it('should not let an older response overwrite a newer one', async () => {
        const request = createMockRequest(MOCK_TIME, MOCK_TIME + HOUR);
        const olderFetch = new Subject<DataQueryResponse>();
        mockFetchCallback.mockImplementationOnce(() => olderFetch);
        mockFetchCallback.mockImplementationOnce(() => of(namedFrameResponse(MOCK_TIME, MOCK_TIME + HOUR, 'newer')));

        const olderQuery = cache.queryWithCache(request, mockFetchCallback);
        await cache.queryWithCache(request, mockFetchCallback);

        // The older request finishes last
        olderFetch.next(namedFrameResponse(MOCK_TIME, MOCK_TIME + HOUR, 'older'));
        olderFetch.complete();
        await olderQuery;

        mockFetchCallback.mockClear();
        const contained = await cache.queryWithCache(
          createMockRequest(MOCK_TIME + MINUTE, MOCK_TIME + HOUR - MINUTE),
          mockFetchCallback
        );
        expect(mockFetchCallback).not.toHaveBeenCalled();
        expect(contained.data[0].name).toBe('newer');
      });

      it('should not repopulate a cleared panel cache with an in-flight response', async () => {
        const request = createMockRequest(MOCK_TIME, MOCK_TIME + HOUR);
        const inFlightFetch = new Subject<DataQueryResponse>();
        mockFetchCallback.mockImplementationOnce(() => inFlightFetch);

        const inFlightQuery = cache.queryWithCache(request, mockFetchCallback);
        cache.clearPanelCache(1);
        inFlightFetch.next(namedFrameResponse(MOCK_TIME, MOCK_TIME + HOUR, 'stale'));
        inFlightFetch.complete();
        await inFlightQuery;

        mockFetchCallback.mockClear();
        await cache.queryWithCache(createMockRequest(MOCK_TIME + MINUTE, MOCK_TIME + HOUR - MINUTE), mockFetchCallback);
        expect(mockFetchCallback).toHaveBeenCalledTimes(1);
      });

      it('should not cache a merged range when a sub-range fetch fails', async () => {
        await cache.queryWithCache(createMockRequest(MOCK_TIME, MOCK_TIME + HOUR), mockFetchCallback);

        // Expand left, and fail the missing range
        mockFetchCallback.mockClear();
        mockFetchCallback.mockImplementationOnce(() => of(cancelledResponse()));
        const expanded = await cache.queryWithCache(
          createMockRequest(MOCK_TIME - HOUR, MOCK_TIME + HOUR),
          mockFetchCallback
        );
        expect(expanded.data[0].length).toBe(61);

        // The missing range is fetched again rather than treated as cached
        mockFetchCallback.mockClear();
        await cache.queryWithCache(
          createMockRequest(MOCK_TIME - HOUR + MINUTE, MOCK_TIME + HOUR - MINUTE),
          mockFetchCallback
        );
        expect(mockFetchCallback).toHaveBeenCalledTimes(1);
        expect(mockFetchCallback.mock.calls[0][0].range.from.valueOf()).toBe(MOCK_TIME - HOUR + MINUTE);
        expect(mockFetchCallback.mock.calls[0][0].range.to.valueOf()).toBe(MOCK_TIME);
      });

      it('should use fresh frames for queries that succeeded when another query fails', async () => {
        const request = createMockRequest(MOCK_TIME, MOCK_TIME + HOUR);
        const frameFor = (refId: string, name: string) => {
          const frame = createMockDataFrame(MOCK_TIME, MOCK_TIME + HOUR, MINUTE, refId);
          frame.name = name;
          return frame;
        };
        mockFetchCallback.mockImplementationOnce(() =>
          of({ data: [frameFor('A', 'cached A'), frameFor('B', 'cached B')] })
        );
        await cache.queryWithCache(request, mockFetchCallback);

        // Query B fails, query A returns new data
        mockFetchCallback.mockImplementationOnce(() =>
          of({
            data: [frameFor('A', 'fresh A')],
            errors: [{ message: 'error generating queries', refId: 'B' }],
            state: LoadingState.Error,
          })
        );
        const refreshed = await cache.queryWithCache(request, mockFetchCallback);

        expect(refreshed.data.map((df) => df.name)).toEqual(['fresh A', 'cached B']);
        expect(refreshed.errors?.[0].refId).toBe('B');
      });

      it('should return the error when a sub-range fetch fails', async () => {
        await cache.queryWithCache(createMockRequest(MOCK_TIME, MOCK_TIME + HOUR), mockFetchCallback);

        mockFetchCallback.mockImplementationOnce(() => of(gatewayTimeoutResponse()));
        const expanded = await cache.queryWithCache(
          createMockRequest(MOCK_TIME - HOUR, MOCK_TIME + HOUR),
          mockFetchCallback
        );

        expect(expanded.state).toBe(LoadingState.Error);
        expect(expanded.errors?.[0].status).toBe(504);
        expect(expanded.data[0].length).toBe(61);
      });

      it('should not share frames with Grafana, which empties value arrays after rendering', async () => {
        const emptyValuesInPlace = (response: DataQueryResponse) =>
          response.data.forEach((frame) => frame.fields.forEach((field: Field) => (field.values.length = 0)));

        const request = createMockRequest(MOCK_TIME, MOCK_TIME + HOUR);
        emptyValuesInPlace(await cache.queryWithCache(request, mockFetchCallback));

        const contained = createMockRequest(MOCK_TIME + MINUTE, MOCK_TIME + HOUR - MINUTE);
        const firstRead = await cache.queryWithCache(contained, mockFetchCallback);
        emptyValuesInPlace(firstRead);
        const secondRead = await cache.queryWithCache(contained, mockFetchCallback);
        expect(secondRead.data[0].fields[0].values).toHaveLength(59);

        // The fallback after a failed refresh must not return emptied frames either
        mockFetchCallback.mockImplementationOnce(() => of(cancelledResponse()));
        const fallback = await cache.queryWithCache(request, mockFetchCallback);
        expect(fallback.data[0].fields[0].values).toHaveLength(61);
      });

      it('should classify responses as usable only when they have frames and no error', () => {
        expect(isUsableResponse({ data: [createMockDataFrame(MOCK_TIME, MOCK_TIME + MINUTE)] })).toBe(true);
        expect(isUsableResponse(cancelledResponse())).toBe(false);
        expect(isUsableResponse(droppedConnectionResponse())).toBe(false);
        expect(isUsableResponse(gatewayTimeoutResponse())).toBe(false);
        expect(
          isUsableResponse({
            data: [createMockDataFrame(MOCK_TIME, MOCK_TIME + MINUTE)],
            errors: [{ message: 'partial failure', refId: 'B' }],
          })
        ).toBe(false);
      });
    });

    it('should keep frame meta when filtering by time range', () => {
      const frame = createMockDataFrame(MOCK_TIME, MOCK_TIME + HOUR);
      frame.meta = { type: 'timeseries-wide' as any, notices: [{ severity: 'warning', text: 'note' }] };

      const filtered = filterFrameByTimeRange(frame, MOCK_TIME, MOCK_TIME + HOUR / 2);

      expect(filtered.meta).toEqual(frame.meta);
      expect(filtered.length).toBe(31);
    });

    it('should filter time field nanos with the values', () => {
      const frame = createMockDataFrame(MOCK_TIME, MOCK_TIME + 4 * MINUTE);
      frame.fields[0].nanos = [0, 1, 2, 3, 4];

      const filtered = filterFrameByTimeRange(frame, MOCK_TIME + MINUTE, MOCK_TIME + 2 * MINUTE);

      expect(filtered.fields[0].values).toEqual([MOCK_TIME + MINUTE, MOCK_TIME + 2 * MINUTE]);
      expect(filtered.fields[0].nanos).toEqual([1, 2]);
    });

    describe('annotation frames', () => {
      const createMockAnnotationFrame = (
        annotations: Array<{
          time: number;
          timeEnd?: number;
          title: string;
          text: string;
          tags: string;
          annotationId: string;
        }>,
        refId = 'A'
      ) => {
        return toDataFrame({
          name: 'annotations',
          refId,
          fields: [
            { name: 'time', type: FieldType.time, values: annotations.map((a) => a.time) },
            { name: 'timeEnd', type: FieldType.time, values: annotations.map((a) => a.timeEnd ?? null) },
            { name: 'title', type: FieldType.string, values: annotations.map((a) => a.title) },
            { name: 'text', type: FieldType.string, values: annotations.map((a) => a.text) },
            { name: 'tags', type: FieldType.string, values: annotations.map((a) => a.tags) },
            { name: 'annotationId', type: FieldType.string, values: annotations.map((a) => a.annotationId) },
          ],
        });
      };

      it('should append annotation frames with duplicate timestamps', () => {
        // dataQuery annotations flatten wide frames, producing multiple rows at the same timestamp
        const cached = createMockAnnotationFrame([
          { time: MOCK_TIME, title: 'ch1 val', text: '42', tags: '', annotationId: 'a1' },
          { time: MOCK_TIME, title: 'ch2 val', text: '99', tags: '', annotationId: 'a2' },
          { time: MOCK_TIME + 10 * MINUTE, title: 'ch1 val', text: '43', tags: '', annotationId: 'a3' },
        ]);
        const fresh = createMockAnnotationFrame([
          { time: MOCK_TIME + HOUR, title: 'ch1 val', text: '50', tags: '', annotationId: 'a4' },
          { time: MOCK_TIME + HOUR, title: 'ch2 val', text: '88', tags: '', annotationId: 'a5' },
        ]);

        const merged = appendFramesByTime(cached, fresh);

        expect(merged.fields).toHaveLength(6);
        expect(merged.fields.find((f) => f.name === 'time')?.values).toEqual([
          MOCK_TIME,
          MOCK_TIME,
          MOCK_TIME + 10 * MINUTE,
          MOCK_TIME + HOUR,
          MOCK_TIME + HOUR,
        ]);
        expect(merged.fields.find((f) => f.name === 'title')?.values).toEqual([
          'ch1 val',
          'ch2 val',
          'ch1 val',
          'ch1 val',
          'ch2 val',
        ]);
        expect(merged.fields.find((f) => f.name === 'annotationId')?.values).toEqual(['a1', 'a2', 'a3', 'a4', 'a5']);
      });

      it('should invalidate cache when annotationFilter changes', async () => {
        mockFetchCallback.mockImplementation(() => {
          const frame = createMockAnnotationFrame([
            { time: MOCK_TIME, title: 'Ann 1', text: 'Desc', tags: '', annotationId: 'a1' },
          ]);
          return of({ data: [frame] } as DataQueryResponse);
        });

        const makeRequest = (filter: string, to = MOCK_TIME + HOUR): DataQueryRequest<SiftQuery> => ({
          requestId: 'mock-request',
          interval: '1m',
          intervalMs: MINUTE,
          panelId: 1,
          range: {
            from: dateTime(MOCK_TIME),
            to: dateTime(to),
            raw: { from: dateTime(MOCK_TIME), to: dateTime(to) },
          },
          scopedVars: {},
          targets: [
            {
              refId: 'A',
              queryVersion: '2',
              channelDataQueries: [],
              annotationType: 'annotationsQuery' as const,
              annotationFilter: filter,
            },
          ],
          timezone: 'utc',
          app: 'dashboard',
          startTime: 0,
        });

        await cache.queryWithCache(makeRequest("asset_name == 'rover_1'"), mockFetchCallback);
        expect(mockFetchCallback).toHaveBeenCalledTimes(1);

        mockFetchCallback.mockClear();

        // Same filter, narrower range — cache hit
        await cache.queryWithCache(
          makeRequest("asset_name == 'rover_1'", MOCK_TIME + HOUR - MINUTE),
          mockFetchCallback
        );
        expect(mockFetchCallback).not.toHaveBeenCalled();

        // Different filter — cache miss
        await cache.queryWithCache(makeRequest("asset_name == 'rover_2'"), mockFetchCallback);
        expect(mockFetchCallback).toHaveBeenCalledTimes(1);
      });
    });
  });
});
