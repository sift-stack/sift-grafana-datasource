import { DataSourceInstanceSettings, CoreApp, ScopedVars, DataQueryResponse, DataQueryRequest } from '@grafana/data';
import { DataSourceWithBackend, getTemplateSrv } from '@grafana/runtime';
import { SiftQuery, SiftDataSourceOptions, DEFAULT_QUERY, AssetQuery, AssetGrafanaVariable } from './types';
import { SiftVariableSupport } from 'variables';
import { filterQueryBeforeRequest, replaceTemplateVariablesInQuery } from './utils';
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
    return replaceTemplateVariablesInQuery(filteredQuery);
  }
}
