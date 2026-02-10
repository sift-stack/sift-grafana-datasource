import {
  AnnotationSupport,
  CoreApp,
  DataQueryRequest,
  DataQueryResponse,
  DataSourceInstanceSettings,
  ScopedVars,
} from '@grafana/data';
import { DataSourceWithBackend } from '@grafana/runtime';
import { Observable, from } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { SiftVariableSupport } from 'variables';
import { SiftDataSourceCache } from './datasourceCache';
import { DEFAULT_QUERY, SiftDataSourceOptions, SiftQuery, QUERY_VERSION } from './types';
import { ensureQueryDefaults, filterQueryBeforeRequest, replaceTemplateVariablesInQuery } from './utils';
import { AnnotationQueryEditor } from './components/AnnotationQueryEditor';

export class SiftDataSource extends DataSourceWithBackend<SiftQuery, SiftDataSourceOptions> {
  annotations: AnnotationSupport<SiftQuery> = {
    QueryEditor: AnnotationQueryEditor,
  };
  cache: SiftDataSourceCache;
  private readonly restApiUrl?: string;
  private readonly frontendUrl?: string;

  constructor(instanceSettings: DataSourceInstanceSettings<SiftDataSourceOptions>) {
    super(instanceSettings);
    this.variables = new SiftVariableSupport(this);
    this.cache = new SiftDataSourceCache();
    this.restApiUrl = instanceSettings.jsonData?.url || instanceSettings.url;
    this.frontendUrl = instanceSettings.jsonData?.frontendUrl;
  }

  getApiRestUrl(): string | undefined {
    return this.restApiUrl;
  }

  getFrontendUrl(): string | undefined {
    return this.frontendUrl;
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
    if ('queries' in query || 'calculatedChannelQuery' in query || query.queryVersion !== QUERY_VERSION) {
      const result = await this.postResource<SiftQuery>('migrate-query', query);
      return { ...result, refId: query.refId || '' };
    }
    return ensureQueryDefaults(query) as SiftQuery;
  }

  applyTemplateVariables(query: SiftQuery, scopedVars: ScopedVars): SiftQuery {
    // First filter any queries that aren't fully defined
    const filteredQuery = filterQueryBeforeRequest(query);
    return replaceTemplateVariablesInQuery(filteredQuery, scopedVars);
  }
}
