import { SiftDataSource } from './datasource';
import { getTemplateSrv } from '@grafana/runtime';
import { SiftQuery, QueryTypes, QUERY_VERSION } from './types';

// Mock the getTemplateSrv function
jest.mock('@grafana/runtime', () => ({
  getTemplateSrv: jest.fn(),
  DataSourceWithBackend: class {
    constructor() {}
    postResource = jest.fn();
  },
}));

describe('SiftDataSource', () => {
  let datasource: SiftDataSource;
  let mockTemplateSrv: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock template service
    mockTemplateSrv = {
      getVariables: jest.fn().mockReturnValue([
        { name: 'asset_var', current: { value: ['asset1', 'asset2'] } },
        { name: 'single_asset', current: { value: 'single_asset_value' } },
      ]),
      replace: jest.fn((str, scopedVars, format) => {
        // If a format function is provided, call it with the appropriate values
        if (typeof format === 'function') {
          if (str === '${asset_var}') {
            format(['asset1', 'asset2']);
            return str; // Return original string as the replace function does
          }
        }

        // Simple replacement logic for testing when no format function is provided
        return str
          .replace(/\$\{asset_var\}/g, 'replaced_asset_value')
          .replace(/\$\{run_var\}/g, 'replaced_run_value')
          .replace(/\$\{channel_var\}/g, 'replaced_channel_value');
      }),
    };

    (getTemplateSrv as jest.Mock).mockReturnValue(mockTemplateSrv);

    datasource = new SiftDataSource({} as any);
  });

  describe('migrateQuery', () => {
    it('skips migration when queryVersion is current', async () => {
      const query: Partial<SiftQuery> = {
        refId: 'Anno',
        queryVersion: QUERY_VERSION,
        annotationType: 'annotationsQuery',
        annotationFilter: "asset_name=='blah'",
      };

      const result = await datasource.migrateQuery(query);

      expect(datasource.postResource).not.toHaveBeenCalled();
      expect(result.annotationType).toBe('annotationsQuery');
      expect(result.annotationFilter).toBe("asset_name=='blah'");
      expect(result.queryVersion).toBe(QUERY_VERSION);
    });

    it('triggers backend migration when queryVersion is missing', async () => {
      const query: Partial<SiftQuery> = {
        refId: 'Anno',
        annotationType: 'annotationsQuery',
        annotationFilter: "asset_name=='blah'",
      };

      // Backend migration now preserves annotation fields
      (datasource.postResource as jest.Mock).mockResolvedValue({
        queryVersion: QUERY_VERSION,
        combineRuns: true,
        annotationType: 'annotationsQuery',
        annotationFilter: "asset_name=='blah'",
      });

      const result = await datasource.migrateQuery(query);

      expect(datasource.postResource).toHaveBeenCalledWith('migrate-query', query);
      expect(result.annotationType).toBe('annotationsQuery');
      expect(result.annotationFilter).toBe("asset_name=='blah'");
      expect(result.queryVersion).toBe(QUERY_VERSION);
      expect(result.refId).toBe('Anno');
    });

    it('triggers backend migration when legacy fields are present', async () => {
      const query: Partial<SiftQuery> = {
        refId: 'A',
        queries: [{ assetId: 'asset123', channelId: 'chan456' }],
      } as any;

      (datasource.postResource as jest.Mock).mockResolvedValue({
        queryVersion: QUERY_VERSION,
        combineRuns: true,
        channelDataQueries: [{ assetQueries: [{ assetId: 'asset123' }] }],
      });

      const result = await datasource.migrateQuery(query);

      expect(datasource.postResource).toHaveBeenCalledWith('migrate-query', query);
      expect(result.queryVersion).toBe(QUERY_VERSION);
      expect(result.refId).toBe('A');
    });
  });

  describe('applyTemplateVariables', () => {
    it('replaces template variables in asset, run, and channel queries', () => {
      const query: SiftQuery = {
        refId: 'A',
        queryVersion: '2',
        channelDataQueries: [
          {
            assetQueries: [{ assetId: '${asset_var}', assetName: 'Asset ${asset_var}' }],
            runQueries: [{ runId: '${run_var}', runName: 'Run ${run_var}' }],
            channelQueries: [{ channelId: '${channel_var}', channelName: 'Channel ${channel_var}' }],
          },
        ],
      };

      const result = datasource.applyTemplateVariables(query, {});

      // Check that template variables were replaced
      expect(result.channelDataQueries?.[0].assetQueries?.[0].assetId).toBe('replaced_asset_value');
      expect(result.channelDataQueries?.[0].assetQueries?.[0].assetName).toBe('Asset replaced_asset_value');
      expect(result.channelDataQueries?.[0].runQueries?.[0].runId).toBe('replaced_run_value');
      expect(result.channelDataQueries?.[0].runQueries?.[0].runName).toBe('Run replaced_run_value');
      expect(result.channelDataQueries?.[0].channelQueries?.[0].channelId).toBe('replaced_channel_value');
      expect(result.channelDataQueries?.[0].channelQueries?.[0].channelName).toBe('Channel replaced_channel_value');
    });

    it('handles dashboard variables with multiple values using getValuesForVariable', () => {
      const query: SiftQuery = {
        refId: 'A',
        queryVersion: '2',
        channelDataQueries: [
          {
            assetQueries: [{ dashboardVariableName: '${asset_var}' }],
            runQueries: [],
            channelQueries: [],
          },
        ],
      };

      const result = datasource.applyTemplateVariables(query, {});

      // Verify the replace function was called with the correct variable
      expect(mockTemplateSrv.replace).toHaveBeenCalledWith('${asset_var}', {}, expect.any(Function));

      // Should expand the dashboard variable into multiple asset queries
      expect(result.channelDataQueries?.[0].assetQueries?.length).toBe(2);
      expect(result.channelDataQueries?.[0].assetQueries?.[0].assetId).toBe('asset1');
      expect(result.channelDataQueries?.[0].assetQueries?.[1].assetId).toBe('asset2');
      expect(result.channelDataQueries?.[0].assetQueries?.[0].dashboardVariableName).toBe('${asset_var}');
      expect(result.channelDataQueries?.[0].assetQueries?.[1].dashboardVariableName).toBe('${asset_var}');
    });

    it('replaces template variables in calculated channel queries', () => {
      const query: SiftQuery = {
        refId: 'A',
        queryVersion: '2',
        channelDataQueries: [
          {
            assetQueries: [],
            runQueries: [],
            channelQueries: [],
            calculatedChannelQueries: [
              {
                name: 'Calc ${asset_var}',
                expression: '$1 + ${asset_var}',
                channelReferences: [
                  {
                    channelReference: '$1',
                    channelId: '${channel_var}',
                    channelName: 'Channel ${channel_var}',
                  },
                ],
              },
            ],
          },
        ],
      };

      const result = datasource.applyTemplateVariables(query, {});

      // Check that template variables were replaced in calculated channel queries
      const calcQuery = result.channelDataQueries?.[0].calculatedChannelQueries?.[0];
      expect(calcQuery?.name).toBe('Calc replaced_asset_value');
      expect(calcQuery?.expression).toBe('$1 + replaced_asset_value');
      expect(calcQuery?.channelReferences?.[0].channelId).toBe('replaced_channel_value');
      expect(calcQuery?.channelReferences?.[0].channelName).toBe('Channel replaced_channel_value');
    });

    it('filters out empty queries before applying template variables', () => {
      const query: SiftQuery = {
        refId: 'A',
        queryVersion: '2',
        channelDataQueries: [
          {
            // Valid query
            assetQueries: [{ assetId: '${asset_var}' }],
            runQueries: [],
            channelQueries: [],
          },
          {
            // Empty query that should be filtered out
            assetQueries: [],
            runQueries: [],
            channelQueries: [],
          },
        ],
      };

      const result = datasource.applyTemplateVariables(query, {});

      // Should have filtered out the empty query
      expect(result.channelDataQueries?.length).toBe(1);
      expect(result.channelDataQueries?.[0].assetQueries?.[0].assetId).toBe('replaced_asset_value');
    });
  });
});
