import { DataSourceInstanceSettings, CoreApp, ScopedVars, DataQueryResponse, DataQueryRequest } from '@grafana/data';
import { DataSourceWithBackend, getTemplateSrv } from '@grafana/runtime';
import { SiftQuery, SiftDataSourceOptions, DEFAULT_QUERY, AssetQuery, AssetGrafanaVariable } from './types';
import { SiftVariableSupport } from 'variables';
import { filterQueryBeforeRequest } from './utils';
import { Observable, from } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { SiftDataSourceCache } from './datasourceCache';

export class SiftDataSource extends DataSourceWithBackend<SiftQuery, SiftDataSourceOptions> {
  cache: SiftDataSourceCache;

  constructor(instanceSettings: DataSourceInstanceSettings<SiftDataSourceOptions>) {
    super(instanceSettings);
    this.variables = new SiftVariableSupport(this);
    this.cache = new SiftDataSourceCache();
  }

  clearCache(panelId?: number) {
    // clear panel cache
    this.cache.clearPanelCache(panelId);
    // clear backend search cache
    void this.getResource('purge-cache');
  }

  getDefaultQuery(_: CoreApp): Partial<SiftQuery> {
    return DEFAULT_QUERY;
  }

  // Ensure migration is always run even when frontend query editor is not rendered
  query(request: DataQueryRequest<SiftQuery>): Observable<DataQueryResponse> {
    return from(Promise.all(request.targets.map((target) => this.migrateQuery(target)))).pipe(
      switchMap((migratedTargets) => {
        const migratedRequest: DataQueryRequest<SiftQuery> = {
          ...request,
          targets: migratedTargets,
        };
        return this.cache.queryWithCache(migratedRequest, (req) => super.query(req));
      })
    );
  }

  async migrateQuery(query: Partial<SiftQuery>): Promise<SiftQuery> {
    if ('queries' in query || 'calculatedChannelQuery' in query) {
      const result = await this.postResource<SiftQuery>('migrate-query', query);
      return { ...result, refId: query.refId || '' };
    }
    return query as SiftQuery;
  }

  applyTemplateVariables(query: SiftQuery, scopedVars: ScopedVars): SiftQuery {
    // First filter any queries that aren't fully defined
    const filteredQuery = filterQueryBeforeRequest(query);

    const templateSrv = getTemplateSrv();

    function getValuesForVariable(name: string): string[] {
      const values: string[] = [];
      templateSrv.replace(name, {}, (value: string | string[]) => {
        if (Array.isArray(value)) {
          values.push(...value);
        } else {
          values.push(value);
        }
      });
      return values;
    }

    return {
      ...filteredQuery,
      channelDataQueries: filteredQuery.channelDataQueries?.map((cdq) => {
        return {
          ...cdq,
          assetQueries: cdq.assetQueries?.reduce((acc: AssetQuery[], aq: AssetQuery) => {
            // If we have a dashboard variable, handle it separately
            if (aq.dashboardVariableName) {
              const dashboardVarValues = getValuesForVariable(aq.dashboardVariableName);
              if (dashboardVarValues) {
                dashboardVarValues.forEach((v) => {
                  acc.push({
                    assetId: v,
                    dashboardVariableName: aq.dashboardVariableName,
                  });
                });
              }
            } else {
              acc.push({
                ...aq,
                assetId: templateSrv.replace(aq.assetId || ''),
                assetName: templateSrv.replace(aq.assetName || ''),
              });
            }
            return acc;
          }, []),
          runQueries: cdq.runQueries?.map((rq) => {
            return {
              ...rq,
              runId: templateSrv.replace(rq.runId || ''),
              runName: templateSrv.replace(rq.runName || ''),
            };
          }),
          channelQueries: cdq.channelQueries?.map((cq) => {
            return {
              ...cq,
              channelId: templateSrv.replace(cq.channelId || ''),
              channelName: templateSrv.replace(cq.channelName || ''),
            };
          }),
          calculatedChannelQueries: cdq.calculatedChannelQueries?.map((cc) => {
            return {
              ...cc,
              name: templateSrv.replace(cc.name || ''),
              expression: templateSrv.replace(cc.expression || ''),
              channelReferences: cc.channelReferences?.map((cr) => {
                return {
                  ...cr,
                  channelId: templateSrv.replace(cr.channelId || ''),
                  channelName: templateSrv.replace(cr.channelName || ''),
                };
              }),
            };
          }),
        };
      }),
    };
  }
}
