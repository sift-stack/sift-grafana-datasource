import {
  getValueAndSelectionTypeFromQuery,
  insertAfter,
  deleteValue,
  runQueryFromSelection,
  assetQueryFromSelection,
  channelQueryFromSelection,
  filterQueryBeforeRequest,
} from './utils';
import { SelectableInputTypes } from './components/input/InputTypeSelect';

describe('utils', () => {
  describe('getValueAndSelectionTypeFromQuery', () => {
    it('returns select type if asSelect is true', () => {
      expect(getValueAndSelectionTypeFromQuery({ runId: '123', asSelect: true })).toEqual([
        '123',
        SelectableInputTypes.SELECT,
      ]);
    });
    it('returns text type if name is present', () => {
      expect(getValueAndSelectionTypeFromQuery({ runName: 'abc' })).toEqual(['abc', SelectableInputTypes.TEXT]);
    });
    it('returns id type if id is present', () => {
      expect(getValueAndSelectionTypeFromQuery({ runId: '456' })).toEqual(['456', SelectableInputTypes.ID]);
    });
    it('returns regex type if nameAsRegex is true', () => {
      expect(getValueAndSelectionTypeFromQuery({ runName: 'abc', nameAsRegex: true })).toEqual([
        'abc',
        SelectableInputTypes.REGEX,
      ]);
    });
    it('returns ID type if both runName and runId exist and asSelect/nameAsRegex are false', () => {
      expect(
        getValueAndSelectionTypeFromQuery({ runId: 'id', runName: 'name', asSelect: false, nameAsRegex: false })
      ).toEqual(['id', SelectableInputTypes.ID]);
    });
    it('returns id type if both runName and runId exist but runName is empty', () => {
      expect(
        getValueAndSelectionTypeFromQuery({ runId: 'id', runName: '', asSelect: false, nameAsRegex: false })
      ).toEqual(['id', SelectableInputTypes.ID]);
    });
    it('returns id type if only runId exists and asSelect/nameAsRegex are false', () => {
      expect(getValueAndSelectionTypeFromQuery({ runId: 'id', asSelect: false, nameAsRegex: false })).toEqual([
        'id',
        SelectableInputTypes.ID,
      ]);
    });
    it('returns text type if only runName exists and asSelect/nameAsRegex are false', () => {
      expect(getValueAndSelectionTypeFromQuery({ runName: 'name', asSelect: false, nameAsRegex: false })).toEqual([
        'name',
        SelectableInputTypes.TEXT,
      ]);
    });
    it('returns text type if runName exists and runId is empty and asSelect/nameAsRegex are false', () => {
      expect(
        getValueAndSelectionTypeFromQuery({ runName: 'name', runId: '', asSelect: false, nameAsRegex: false })
      ).toEqual(['name', SelectableInputTypes.TEXT]);
    });
    it('returns regex type if nameAsRegex is true and runName exists', () => {
      expect(getValueAndSelectionTypeFromQuery({ runName: '', nameAsRegex: true })).toEqual([
        '',
        SelectableInputTypes.REGEX,
      ]);
    });
    it('returns regex type if nameAsRegex is true', () => {
      expect(getValueAndSelectionTypeFromQuery({ nameAsRegex: true })).toEqual(['', SelectableInputTypes.REGEX]);
    });
    it('returns select type if asSelect is true', () => {
      expect(getValueAndSelectionTypeFromQuery({ asSelect: true })).toEqual(['', SelectableInputTypes.SELECT]);
    });
    it('returns default if query is undefined', () => {
      expect(getValueAndSelectionTypeFromQuery(undefined)).toEqual(['', SelectableInputTypes.TEXT]);
    });
    it('returns default if query is null', () => {
      expect(getValueAndSelectionTypeFromQuery(null)).toEqual(['', SelectableInputTypes.TEXT]);
    });
    it('returns default if query is empty object', () => {
      expect(getValueAndSelectionTypeFromQuery({})).toEqual(['', SelectableInputTypes.TEXT]);
    });
  });

  describe('insertAfter', () => {
    it('inserts after a value', () => {
      expect(insertAfter([1, 2, 3], 2, 99)).toEqual([1, 2, 99, 3]);
    });
    it('appends if value not found', () => {
      expect(insertAfter([1, 2, 3], 4, 99)).toEqual([1, 2, 3, 99]);
    });
  });

  describe('deleteValue', () => {
    it('removes all occurrences', () => {
      expect(deleteValue([1, 2, 3, 2], 2)).toEqual([1, 3]);
    });
    it('returns original if not found', () => {
      expect(deleteValue([1, 2, 3], 4)).toEqual([1, 2, 3]);
    });
  });

  describe('runQueryFromSelection', () => {
    it('returns correct object for ID', () => {
      expect(runQueryFromSelection('idval', SelectableInputTypes.ID)).toEqual({ runId: 'idval' });
    });
    it('returns correct object for SELECT', () => {
      expect(runQueryFromSelection('idval', SelectableInputTypes.SELECT)).toEqual({ runId: 'idval', asSelect: true });
    });
    it('returns correct object for REGEX', () => {
      expect(runQueryFromSelection('nameval', SelectableInputTypes.REGEX)).toEqual({
        runName: 'nameval',
        nameAsRegex: true,
      });
    });
    it('returns correct object for TEXT', () => {
      expect(runQueryFromSelection('nameval', SelectableInputTypes.TEXT)).toEqual({ runName: 'nameval' });
    });
  });

  describe('assetQueryFromSelection', () => {
    it('returns correct object for ID', () => {
      expect(assetQueryFromSelection('idval', SelectableInputTypes.ID)).toEqual({ assetId: 'idval' });
    });
    it('returns correct object for SELECT', () => {
      expect(assetQueryFromSelection('idval', SelectableInputTypes.SELECT)).toEqual({
        assetId: 'idval',
        asSelect: true,
      });
    });
    it('returns correct object for REGEX', () => {
      expect(assetQueryFromSelection('nameval', SelectableInputTypes.REGEX)).toEqual({
        assetName: 'nameval',
        nameAsRegex: true,
      });
    });
    it('returns correct object for TEXT', () => {
      expect(assetQueryFromSelection('nameval', SelectableInputTypes.TEXT)).toEqual({ assetName: 'nameval' });
    });
  });

  describe('channelQueryFromSelection', () => {
    it('returns correct object for ID', () => {
      expect(channelQueryFromSelection('idval', SelectableInputTypes.ID)).toEqual({ channelId: 'idval' });
    });
    it('returns correct object for SELECT', () => {
      expect(channelQueryFromSelection('idval', SelectableInputTypes.SELECT)).toEqual({
        channelId: 'idval',
        asSelect: true,
      });
    });
    it('returns correct object for REGEX', () => {
      expect(channelQueryFromSelection('nameval', SelectableInputTypes.REGEX)).toEqual({
        channelName: 'nameval',
        nameAsRegex: true,
      });
    });
    it('returns correct object for TEXT', () => {
      expect(channelQueryFromSelection('nameval', SelectableInputTypes.TEXT)).toEqual({ channelName: 'nameval' });
    });
  });

  describe('filterQueryBeforeRequest', () => {
    it('filters out empty queries from channelDataQueries', () => {
      const testQuery = {
        refId: 'A',
        queryVersion: '2',
        channelDataQueries: [
          {
            // Valid query with assetQueries
            assetQueries: [{ assetId: 'asset1' }],
            runQueries: [],
            channelQueries: [],
            calculatedChannelQueries: [],
          },
          {
            // Empty query that should be filtered out
            assetQueries: [],
            runQueries: [],
            channelQueries: [],
            calculatedChannelQueries: [],
          },
          {
            // Valid query with runQueries
            assetQueries: [],
            runQueries: [{ runId: 'run1' }],
            channelQueries: [],
            calculatedChannelQueries: [],
          },
        ],
      };

      const result = filterQueryBeforeRequest(testQuery);

      // Should have filtered out the empty query
      expect(result.channelDataQueries?.length).toBe(2);
      expect(result.channelDataQueries?.[0].assetQueries?.[0].assetId).toBe('asset1');
      expect(result.channelDataQueries?.[1].runQueries?.[0].runId).toBe('run1');
    });

    it('filters out invalid queries from within each query type', () => {
      const testQuery = {
        refId: 'A',
        queryVersion: '2',
        channelDataQueries: [
          {
            // Contains both valid and invalid entries
            assetQueries: [
              { assetId: 'valid-asset' },
              {}, // Empty object should be filtered
              { invalidProp: 'should-be-filtered' },
            ],
            runQueries: [
              { runName: 'valid-run' },
              {}, // Empty object should be filtered
            ],
            channelQueries: [
              { channelId: 'valid-channel' },
              { channelName: '' }, // Empty name should be filtered
            ],
            calculatedChannelQueries: [
              {
                name: 'valid-calc',
                expression: 'expression',
                channelReferences: [{ channelReference: '$1', channelId: 'valid-channel' }],
              },
              { name: '', expression: '', channelReferences: [] }, // Empty name should not be filtered
            ],
          },
        ],
      };

      const result = filterQueryBeforeRequest(testQuery);

      // Should have filtered out invalid entries but kept the query
      expect(result.channelDataQueries?.length).toBe(1);

      // Check assetQueries filtering
      expect(result.channelDataQueries?.[0].assetQueries?.length).toBe(1);
      expect(result.channelDataQueries?.[0].assetQueries?.[0].assetId).toBe('valid-asset');

      // Check runQueries filtering
      expect(result.channelDataQueries?.[0].runQueries?.length).toBe(1);
      expect(result.channelDataQueries?.[0].runQueries?.[0].runName).toBe('valid-run');

      // Check channelQueries filtering
      expect(result.channelDataQueries?.[0].channelQueries?.length).toBe(1);
      expect(result.channelDataQueries?.[0].channelQueries?.[0].channelId).toBe('valid-channel');

      // Check calculatedChannelQueries filtering
      expect(result.channelDataQueries?.[0].calculatedChannelQueries?.length).toBe(2);
      expect(result.channelDataQueries?.[0].calculatedChannelQueries?.[0].name).toBe('valid-calc');
      expect(result.channelDataQueries?.[0].calculatedChannelQueries?.[0].channelReferences?.length).toBe(1);
    });

    it('preserves other properties in the query object', () => {
      const testQuery = {
        refId: 'A',
        queryType: 'someType',
        queryVersion: '2',
        combineRuns: true,
        channelDataQueries: [
          {
            assetQueries: [{ assetId: 'asset1' }],
            runQueries: [],
            channelQueries: [],
            calculatedChannelQueries: [],
          },
        ],
      };

      const result = filterQueryBeforeRequest(testQuery);

      // Should preserve other properties
      expect(result.refId).toBe('A');
      expect(result.queryType).toBe('someType');
      expect(result.combineRuns).toBe(true);
    });
  });
});
