Repository layout and roles

- Frontend (TypeScript/React)
  - Entry and meta:
    - [src/plugin.json](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/src/plugin.json:0:0-0:0): plugin manifest. Type: `datasource`, id: `sift-grafana-datasource`, `backend: true`, `executable: "gpx_grafana_datasource"`.
    - [src/module.ts](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/src/module.ts:0:0-0:0): registers the datasource and editors via `new DataSourcePlugin(...).setConfigEditor(...).setQueryEditor(...)`.
  - Datasource runtime + helpers:
    - [src/datasource.ts](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/src/datasource.ts:0:0-0:0): [SiftDataSource](cci:2://file:///Users/leo/Documents/code/sift-grafana-datasource/src/types.ts:79:0-81:1) extends `DataSourceWithBackend` and orchestrates query migration, templating, and caching.
    - [src/datasourceCache.ts](cci:1://file:///Users/leo/Documents/code/sift-grafana-datasource/.config/webpack/webpack.config.ts:163:14-163:113): client-side frame cache and range stitching.
    - [src/utils.ts](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/src/utils.ts:0:0-0:0): query defaults, selection conversion, CEL utilities for filtering, template variable replacement, defaults filling.
    - [src/types.ts](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/src/types.ts:0:0-0:0): v2.1 query models, datasource options, and query enums.
    - [src/legacyTypes.ts](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/src/legacyTypes.ts:0:0-0:0): legacy types (used by config editor for [SiftSecureJsonData](cci:2://file:///Users/leo/Documents/code/sift-grafana-datasource/src/types.ts:86:0-88:1) shape).
    - [src/variables.ts](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/src/variables.ts:0:0-0:0) and [src/components/VariableQueryEditor.tsx](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/src/components/VariableQueryEditor.tsx:0:0-0:0): Grafana query variable support (assets list).
  - Query editor UI:
    - [src/components/VisualSiftQueryEditor.tsx](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/src/components/VisualSiftQueryEditor.tsx:0:0-0:0): top-level query editor; triggers migration and renders sub-editors.
    - [src/components/query-editor/QueryEditor.tsx](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/src/components/query-editor/QueryEditor.tsx:0:0-0:0): manages multiple subqueries per target.
    - [src/components/query-editor/SubQueryEditor.tsx](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/src/components/query-editor/SubQueryEditor.tsx:0:0-0:0): asset/run/channel/calculated-channel editors and composition.
    - [src/components/query-editor/ChannelQueryEditor.tsx](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/src/components/query-editor/ChannelQueryEditor.tsx:0:0-0:0): per-channel selection UI.
    - [src/resources.hooks.ts](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/src/resources.hooks.ts:0:0-0:0): hooks to fetch assets, runs, and channels via datasource resources (debounced, deduped, sorted).
    - Common/input components under `src/components/common/` and `src/components/input/`.
- Backend (Go)
  - Entrypoint:
    - `pkg/main.go`: runs `datasource.Manage("sift-grafana-datasource", plugin.NewSiftDatasource, ...)`.
  - Core handlers and logic:
    - [pkg/plugin/datasource.go](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/pkg/plugin/datasource.go:0:0-0:0): implements [QueryData](cci:1://file:///Users/leo/Documents/code/sift-grafana-datasource/pkg/plugin/datasource.go:155:0-183:1), the main query pipeline: migrate, resolve selections, call Sift API, assemble DataFrame.
    - [pkg/plugin/resources.go](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/pkg/plugin/resources.go:0:0-0:0): implements [CallResource](cci:1://file:///Users/leo/Documents/code/sift-grafana-datasource/pkg/plugin/datasource.go:131:0-153:1) endpoints (`assets`, `runs`, `channels`, `migrate-query`, `purge-cache`).
    - [pkg/plugin/migrate_query.go](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/pkg/plugin/migrate_query.go:0:0-0:0): server-side migration: legacy -> v2 -> v2.1 and POST `migrate-query` resource to support frontend migration.
    - [pkg/plugin/sift_api_queries.go](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/pkg/plugin/sift_api_queries.go:0:0-0:0): Sift REST API client utilities, pagination helpers, and data fetching.
    - [pkg/plugin/cache_utils.go](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/pkg/plugin/cache_utils.go:0:0-0:0): typed caches with optional randomized TTLs and “loader” to deduplicate concurrent cache fills.
    - [pkg/plugin/check_health.go](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/pkg/plugin/check_health.go:0:0-0:0): implements [CheckHealth](cci:1://file:///Users/leo/Documents/code/sift-grafana-datasource/pkg/plugin/check_health.go:10:0-50:1) using `/api/v1/me`.
- Provisioning and local dev
  - [provisioning/datasources/datasources.yml](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/provisioning/datasources/datasources.yml:0:0-0:0): sets datasource URL and API key via env vars.
  - [provisioning/dashboards/json/sample-dashboard.json](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/provisioning/dashboards/json/sample-dashboard.json:0:0-0:0): dashboard exhibiting queries (version "2", which the system migrates).
  - [provisioning/README.MD](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/provisioning/README.MD:0:0-0:0): `.env` instructions and `docker-compose` spin up.
- Build and CI
  - Frontend: webpack under [.config/webpack/webpack.config.ts](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/.config/webpack/webpack.config.ts:0:0-0:0), TypeScript config under [.config/tsconfig.json](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/.config/tsconfig.json:0:0-0:0).
  - Backend: [Magefile.go](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/Magefile.go:0:0-0:0) uses SDK build tasks.
  - CI: [.github/workflows/ci.yml](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/.github/workflows/ci.yml:0:0-0:0) builds, lints, unit tests, builds backend (mage), signs, validates plugin. E2E is gated by presence of [playwright.config.ts](cci:1://file:///Users/leo/Documents/code/sift-grafana-datasource/.config/webpack/webpack.config.ts:163:14-163:113) (file is `playwright.config.ts.disabled`, so E2E job won’t run by default).

Grafana integration points

- Datasource registration
  - [src/module.ts](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/src/module.ts:0:0-0:0) registers [SiftDataSource](cci:2://file:///Users/leo/Documents/code/sift-grafana-datasource/src/types.ts:79:0-81:1) with `DataSourcePlugin`, sets the Config and Query Editors.
  - The plugin is declared backend-enabled in [src/plugin.json](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/src/plugin.json:0:0-0:0).
- Backend runtime
  - The frontend uses `DataSourceWithBackend`, which routes query requests to backend handlers automatically.
  - Resource calls (`getResource`, `postResource`) are proxied to backend [CallResource](cci:1://file:///Users/leo/Documents/code/sift-grafana-datasource/pkg/plugin/datasource.go:131:0-153:1) implementations in [pkg/plugin/resources.go](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/pkg/plugin/resources.go:0:0-0:0).
- Authentication/config
  - [ConfigEditor.tsx](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/src/components/ConfigEditor.tsx:0:0-0:0) ([SiftDataSourceOptions](cci:2://file:///Users/leo/Documents/code/sift-grafana-datasource/src/types.ts:79:0-81:1), [SiftSecureJsonData](cci:2://file:///Users/leo/Documents/code/sift-grafana-datasource/src/types.ts:86:0-88:1) from [src/legacyTypes.ts](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/src/legacyTypes.ts:0:0-0:0)) collects:
    - `jsonData.url` (REST endpoint base URL).
    - `secureJsonData.apiKey` (bearer token for Sift API).
  - Backend pulls `url` from `DataSourceInstanceSettings.JSONData` and `apiKey` from `DecryptedSecureJSONData`.
- Variables
  - The datasource supplies a custom variable (`CustomVariableSupport`) via [src/variables.ts](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/src/variables.ts:0:0-0:0).
  - Variable query editor returns all assets as variable options (value: `assetId`, text: [name](cci:1://file:///Users/leo/Documents/code/sift-grafana-datasource/src/utils.ts:453:2-458:3)).

Frontend: data fetching and query handling

- Datasource class
  - [SiftDataSource](cci:2://file:///Users/leo/Documents/code/sift-grafana-datasource/src/types.ts:79:0-81:1) in [src/datasource.ts](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/src/datasource.ts:0:0-0:0):
    - Sets `this.variables = new SiftVariableSupport(this)`.
    - [getDefaultQuery()](cci:1://file:///Users/leo/Documents/code/sift-grafana-datasource/src/variables.ts:14:2-16:3) returns `DEFAULT_QUERY` from [src/types.ts](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/src/types.ts:0:0-0:0) (v2.1).
    - [query(request)](cci:1://file:///Users/leo/Documents/code/sift-grafana-datasource/src/variables.ts:18:2-35:3):
      - Migrates each target via [migrateQuery(target)](cci:1://file:///Users/leo/Documents/code/sift-grafana-datasource/src/components/VisualSiftQueryEditor.tsx:40:4-55:5):
        - If legacy fields or version mismatch, posts to backend `postResource('migrate-query', query)`.
        - Otherwise, [ensureQueryDefaults(...)](cci:1://file:///Users/leo/Documents/code/sift-grafana-datasource/src/utils.ts:465:0-473:2).
      - Wraps the Grafana request with `SiftDataSourceCache.queryWithCache(request, super.query)` to add client-side caching/range-stitching.
    - `applyTemplateVariables(query, scopedVars)`:
      - Filters out empty subqueries via [filterQueryBeforeRequest](cci:1://file:///Users/leo/Documents/code/sift-grafana-datasource/src/utils.ts:193:0-219:2).
      - Replaces template variables across asset/run/channel and calculated-channel sections via [replaceTemplateVariablesInQuery](cci:1://file:///Users/leo/Documents/code/sift-grafana-datasource/src/utils.ts:221:0-293:2).
- Query model and defaults
  - [src/types.ts](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/src/types.ts:0:0-0:0) defines v2.1 model:
    - [SiftQuery](cci:2://file:///Users/leo/Documents/code/sift-grafana-datasource/src/legacyTypes.ts:33:0-39:1) includes `channelDataQueries?: ChannelDataQuery[]`, `combineRuns?: boolean`, `queryVersion: string`.
    - Each [ChannelDataQuery](cci:2://file:///Users/leo/Documents/code/sift-grafana-datasource/src/types.ts:57:0-62:1) includes arrays of `assetQueries`, `runQueries`, `channelQueries`, and/or `calculatedChannelQueries`.
    - `QueryTypes` provides `CHANNEL` vs `CALCULATED_CHANNEL`.
  - [src/constants.ts](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/src/constants.ts:0:0-0:0) provides `DEFAULT_*` blocks used to fill blanks in the UI; [src/utils.ts](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/src/utils.ts:0:0-0:0) has `fillInDefault*` helpers.
- Query editor and selection UX
  - [src/components/VisualSiftQueryEditor.tsx](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/src/components/VisualSiftQueryEditor.tsx:0:0-0:0):
    - On initial render, triggers migration once (via [datasource.migrateQuery(query)](cci:1://file:///Users/leo/Documents/code/sift-grafana-datasource/src/components/VisualSiftQueryEditor.tsx:40:4-55:5)), sets editor mode based on whether there are calculated-channel queries.
    - Provides a "Clear cache" icon that calls `datasource.clearCache(panelId)`, which both clears the frontend panel cache and calls backend `purge-cache`.
  - [src/components/query-editor/QueryEditor.tsx](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/src/components/query-editor/QueryEditor.tsx:0:0-0:0) and [SubQueryEditor.tsx](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/src/components/query-editor/SubQueryEditor.tsx:0:0-0:0):
    - Manage one-or-more “subqueries” per target (think: groupings of asset/run/channel selections or a single calculated-channel definition).
    - Asset, Run, Channel input fields use `SelectableTypeInput` with modes: Select, Text, ID, Regex, and Dashboard-variable (asset only).
    - For Calculated Channels, the subquery maps channel inputs into `$1`, `$2`, ... references and captures a name and expression.
    - Selections map to query models using helpers ([assetQueryFromSelection](cci:1://file:///Users/leo/Documents/code/sift-grafana-datasource/src/utils.ts:81:0-92:2), [runQueryFromSelection](cci:1://file:///Users/leo/Documents/code/sift-grafana-datasource/src/utils.ts:68:0-79:2), [channelQueryFromSelection](cci:1://file:///Users/leo/Documents/code/sift-grafana-datasource/src/utils.ts:94:0-105:2)) in [src/utils.ts](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/src/utils.ts:0:0-0:0).
- Listing/searching data for selectors
  - [src/resources.hooks.ts](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/src/resources.hooks.ts:0:0-0:0) defines:
    - [useFetchAssets](cci:1://file:///Users/leo/Documents/code/sift-grafana-datasource/src/resources.hooks.ts:9:0-98:2), [useFetchRuns](cci:1://file:///Users/leo/Documents/code/sift-grafana-datasource/src/resources.hooks.ts:100:0-193:2), [useFetchChannels](cci:1://file:///Users/leo/Documents/code/sift-grafana-datasource/src/resources.hooks.ts:195:0-294:2) — each debounced, uses `datasource.getResource()` against the backend resources; build CEL filters via [CELUtil](cci:2://file:///Users/leo/Documents/code/sift-grafana-datasource/src/utils.ts:308:0-459:1) (e.g., [In](cci:1://file:///Users/leo/Documents/code/sift-grafana-datasource/src/utils.ts:309:2-318:3), [CaseInsensitiveMatch](cci:1://file:///Users/leo/Documents/code/sift-grafana-datasource/src/utils.ts:399:2-404:3)).
    - Results are optionally sorted by Levenshtein distance (via `leven`) when a search term is present; deduped before being set in state.
  - [variables.ts](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/src/variables.ts:0:0-0:0) custom variable support lists all assets (up to a `limit` parameter).
- Templating
  - [replaceTemplateVariablesInQuery()](cci:1://file:///Users/leo/Documents/code/sift-grafana-datasource/src/utils.ts:221:0-293:2) in [src/utils.ts](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/src/utils.ts:0:0-0:0):
    - Uses `getTemplateSrv().replace` to substitute `${var}` occurrences.
    - Special handling for Asset Dashboard Variables: expands one asset query into N, one per selected asset ID.
  - `applyTemplateVariables()` on the datasource calls the filter and replace functions before the backend sees the query.

Backend: handlers, API calls, and DataFrame assembly

- Handler interfaces and routing
  - [pkg/plugin/datasource.go](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/pkg/plugin/datasource.go:0:0-0:0) implements:
    - `backend.QueryDataHandler`: [QueryData()](cci:1://file:///Users/leo/Documents/code/sift-grafana-datasource/pkg/plugin/datasource.go:155:0-183:1) parses and migrates queries, runs the pipeline, and returns `backend.QueryDataResponse`.
    - `instancemgmt.InstanceDisposer`: [Dispose()](cci:1://file:///Users/leo/Documents/code/sift-grafana-datasource/pkg/plugin/datasource.go:124:0-129:1) (no special cleanup here).
  - [pkg/plugin/resources.go](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/pkg/plugin/resources.go:0:0-0:0) implements:
    - `backend.CallResourceHandler`: routes:
      - `GET /assets`: lists assets via `/api/v1/assets` with CEL filters and pagination (limit 200).
      - `GET /runs`: lists runs via `/api/v2/runs` with CEL filters and pagination.
      - `GET /channels`: lists channels via `/api/v1/channels:search` (internal endpoint; accepts `searchTerm` and `assetIds`; respects limit).
      - `POST /migrate-query`: front-end migration resource.
      - `POST /purge-cache`: clears all backend caches.
  - [pkg/plugin/check_health.go](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/pkg/plugin/check_health.go:0:0-0:0) provides the health check: GET `/api/v1/me` with bearer token.
- Query migration
  - [pkg/plugin/migrate_query.go](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/pkg/plugin/migrate_query.go:0:0-0:0):
    - [convertQueryIfNeeded(q)](cci:1://file:///Users/leo/Documents/code/sift-grafana-datasource/pkg/plugin/migrate_query.go:44:0-92:1):
      - Legacy (no `queryVersion`): migrates to v2.1, splitting selections into arrays, handling dashboard variables and regex; sets `QueryVersion = "2.1"`.
      - v2: [convertFromV2ToV2_1](cci:1://file:///Users/leo/Documents/code/sift-grafana-datasource/pkg/plugin/migrate_query.go:94:0-108:1) (notably: for channel AsSelect queries, clears `ChannelId` in favor of using names).
      - v2.1: parsed as-is.
    - [callResourceMigrateQuery](cci:1://file:///Users/leo/Documents/code/sift-grafana-datasource/pkg/plugin/migrate_query.go:262:0-289:1) exposes migration to the frontend.
- Query pipeline
  - In [datasource.go](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/pkg/plugin/datasource.go:0:0-0:0):
    - [query(...)](cci:1://file:///Users/leo/Documents/code/sift-grafana-datasource/src/variables.ts:18:2-35:3):
      - [generateQueries(...)](cci:1://file:///Users/leo/Documents/code/sift-grafana-datasource/pkg/plugin/datasource.go:412:0-493:1): resolves user selections into Sift API subqueries for both channel and calculated-channel modes. It looks up asset IDs by name/regex/ID, run IDs by name/ID/client key, and channels by ID or name (exact/regex).
        - Uses caches extensively (see below).
      - [runDataQueries(...)](cci:1://file:///Users/leo/Documents/code/sift-grafana-datasource/pkg/plugin/datasource.go:507:0-533:1): splits large requests and calls Sift [getData(...)](cci:1://file:///Users/leo/Documents/code/sift-grafana-datasource/pkg/plugin/sift_api_queries.go:205:0-245:1) for each batch; merges pages until done.
      - [generateDataFrame(...)](cci:1://file:///Users/leo/Documents/code/sift-grafana-datasource/pkg/plugin/datasource.go:535:0-880:1): maps raw values to Grafana data frame fields, handling types including enums and bit-fields. Applies `combineRuns` to collapse multi-run data into single traces when enabled.
- Backend Sift API client and pagination
  - [pkg/plugin/sift_api_queries.go](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/pkg/plugin/sift_api_queries.go:0:0-0:0):
    - [executeRequest(apiRequest)](cci:1://file:///Users/leo/Documents/code/sift-grafana-datasource/pkg/plugin/sift_api_queries.go:105:0-156:1) builds the request with Authorization and a `User-Agent` including plugin version.
    - [handlePaginatedRequest](cci:1://file:///Users/leo/Documents/code/sift-grafana-datasource/pkg/plugin/sift_api_queries.go:176:0-204:1) loops with `page_token` until `nextPageToken` is empty or max pages reached; per-request page sizes set via constants (most listing APIs use `MaxQueryPageSize`).
    - [getData(...)](cci:1://file:///Users/leo/Documents/code/sift-grafana-datasource/pkg/plugin/sift_api_queries.go:205:0-245:1): posts to `/api/v2/data` with:
      - `StartTime`, `EndTime` from Grafana’s time range.
      - `SampleMs` computed from time range and `MaxDataPoints`.
      - Pagination via `NextPageToken` on the data API as well.
- Caching on the backend
  - [pkg/plugin/cache_utils.go](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/pkg/plugin/cache_utils.go:0:0-0:0):
    - [TypedCache[K,V]](cci:2://file:///Users/leo/Documents/code/sift-grafana-datasource/pkg/plugin/cache_utils.go:13:0-17:1) wraps `patrickmn/go-cache` with typed access and optional randomized TTL ([NewTypedCacheWithRandomTtl](cci:1://file:///Users/leo/Documents/code/sift-grafana-datasource/pkg/plugin/cache_utils.go:28:0-34:1)) to reduce cache stampedes.
    - [TypedCacheWithLoader](cci:2://file:///Users/leo/Documents/code/sift-grafana-datasource/pkg/plugin/cache_utils.go:76:0-82:1) ensures in-flight key loads are de-duplicated: other callers wait on the same load via `sync.OnceValues`.
  - [pkg/plugin/datasource.go](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/pkg/plugin/datasource.go:0:0-0:0) caches:
    - Assets: id/name/regex caches.
    - Runs: id/name/regex caches.
    - Channels: id cache, and name/regex caches with loaders to avoid duplicate concurrent calls.

End-to-end data flow

- Channel or Calculated Channel query in the panel editor:
  1. Frontend editor builds [SiftQuery](cci:2://file:///Users/leo/Documents/code/sift-grafana-datasource/src/legacyTypes.ts:33:0-39:1) with `channelDataQueries` (v2.1) in [VisualSiftQueryEditor.tsx](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/src/components/VisualSiftQueryEditor.tsx:0:0-0:0) + [SubQueryEditor.tsx](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/src/components/query-editor/SubQueryEditor.tsx:0:0-0:0).
  2. On query run, [SiftDataSource.query()](cci:1://file:///Users/leo/Documents/code/sift-grafana-datasource/src/variables.ts:18:2-35:3):
     - Migrates each target via `postResource('migrate-query')` if needed.
     - Applies client-side panel cache logic in `SiftDataSourceCache.queryWithCache(...)`, potentially issuing sub-requests to expand ranges.
     - Delegates to [super.query(req)](cci:1://file:///Users/leo/Documents/code/sift-grafana-datasource/src/variables.ts:18:2-35:3) (DataSourceWithBackend) which gRPC-calls backend [QueryData](cci:1://file:///Users/leo/Documents/code/sift-grafana-datasource/pkg/plugin/datasource.go:155:0-183:1).
  3. Backend [QueryData](cci:1://file:///Users/leo/Documents/code/sift-grafana-datasource/pkg/plugin/datasource.go:155:0-183:1):
     - Ensures migration via [convertQueryIfNeeded](cci:1://file:///Users/leo/Documents/code/sift-grafana-datasource/pkg/plugin/migrate_query.go:44:0-92:1).
     - [generateQueries](cci:1://file:///Users/leo/Documents/code/sift-grafana-datasource/pkg/plugin/datasource.go:412:0-493:1) resolves IDs via Sift API (using caches).
     - [getData](cci:1://file:///Users/leo/Documents/code/sift-grafana-datasource/pkg/plugin/sift_api_queries.go:205:0-245:1) posts `/api/v2/data`, paged until done.
     - [generateDataFrame](cci:1://file:///Users/leo/Documents/code/sift-grafana-datasource/pkg/plugin/datasource.go:535:0-880:1) returns a Grafana [data.Frame](cci:1://file:///Users/leo/Documents/code/sift-grafana-datasource/pkg/plugin/datasource.go:535:0-880:1).
  4. Frontend cache merges/stitches results with cached frames (appending by time, trimming live window), filters to requested time range, and returns data to the panel.
- Selector UIs (assets/runs/channels):
  - Frontend hooks (`useFetchAssets/Runs/Channels`) call `datasource.getResource('assets'|'runs'|'channels', params)` with debounced search terms and CEL filters, listing options for select inputs.

Caching strategy

- Frontend cache ([src/datasourceCache.ts](cci:1://file:///Users/leo/Documents/code/sift-grafana-datasource/.config/webpack/webpack.config.ts:163:14-163:113)):
  - Keyed per panel by targets + intervalMs (after template replacement).
  - If the range extends left or right, fetches only missing windows and stitches frames by `refId`.
  - Always re-fetches the last 10 minutes of “liveish” data (`MIN_LIVE_LOOKBACK_TIME_MS = 10 minutes`), so recent data is fresh.
  - Provides `clearCache(panelId)` and calls backend `purge-cache`.
- Backend caches:
  - TTLs ~10 minutes (max), with randomization, and purge endpoint.
  - Typed caches per key type avoid repeated API calls.
  - Channel caches use loaders to deduplicate in-flight requests.

Provisioning and configuration

- [provisioning/datasources/datasources.yml](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/provisioning/datasources/datasources.yml:0:0-0:0) configures:
  - `type: sift-grafana-datasource`, `jsonData.url: ${SIFT_API_URL}`, `secureJsonData.apiKey: ${SIFT_API_KEY}`.
- [provisioning/README.MD](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/provisioning/README.MD:0:0-0:0):
  - Create `.env` with `SIFT_API_URL` and `SIFT_API_KEY`, `docker-compose up`, browse to Grafana, view sample dashboard.
- Sample dashboard ([provisioning/dashboards/json/sample-dashboard.json](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/provisioning/dashboards/json/sample-dashboard.json:0:0-0:0)):
  - Targets include `"queryVersion": "2"` demonstrating migration in action.

Build, CI, and release

- Frontend
  - `npm run build` uses SWC-based webpack build with proper externals for Grafana modules.
  - Copies assets and replaces `%VERSION%` and `%TODAY%` in [dist/plugin.json](cci:2://file:///Users/leo/Documents/code/sift-grafana-datasource/pkg/plugin/datasource.go:185:0-187:1) and `dist/README.md`.
- Backend
  - `mage buildAll` compiles the backend binary (executable `gpx_*`), and CI `chmod +x` ensures it’s executable.
- CI ([.github/workflows/ci.yml](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/.github/workflows/ci.yml:0:0-0:0))
  - Node 20, Go 1.23.5, linting, tests, build, optional sign with `@grafana/sign-plugin`, `plugin-validator` checks.
  - E2E is conditional on [playwright.config.ts](cci:1://file:///Users/leo/Documents/code/sift-grafana-datasource/.config/webpack/webpack.config.ts:163:14-163:113) existing (currently disabled as `playwright.config.ts.disabled`).

Tests

- Frontend unit tests:
  - [src/datasource.test.ts](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/src/datasource.test.ts:0:0-0:0): tests `applyTemplateVariables` and filtering of empty queries; dashboard variable expansion.
  - Query editor tests under `src/components/query-editor/*.test.tsx`.
- Backend tests:
  - [pkg/plugin/datasource_test.go](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/pkg/plugin/datasource_test.go:0:0-0:0), [cache_utils_test.go](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/pkg/plugin/cache_utils_test.go:0:0-0:0), [migrate_query_test.go](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/pkg/plugin/migrate_query_test.go:0:0-0:0) cover API/client, migration, caching, transformation.
- E2E:
  - Playwright scaffolding exists but config file is disabled in the repo snapshot.

Query migration strategy

- Versioning constants:
  - Frontend: `QUERY_VERSION = '2.1'` in [src/types.ts](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/src/types.ts:0:0-0:0).
  - Backend: `QueryVersion = "2.1"` in [pkg/plugin/datasource.go](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/pkg/plugin/datasource.go:0:0-0:0).
- When migration happens:
  - Frontend proactively POSTs `migrate-query` (and the editor does so once, after mount) to server-migrate legacy/v2 queries.
  - Backend [QueryData](cci:1://file:///Users/leo/Documents/code/sift-grafana-datasource/pkg/plugin/datasource.go:155:0-183:1) also invokes [convertQueryIfNeeded(...)](cci:1://file:///Users/leo/Documents/code/sift-grafana-datasource/pkg/plugin/migrate_query.go:44:0-92:1), ensuring server-side safety even if the UI isn’t rendered (e.g., in alerting).
- v2 -> v2.1 change:
  - Channel `AsSelect` uses names directly; previously kept `ChannelId` but searched by name; now channel IDs are cleared for AsSelect.

Performance considerations and limits

- Frontend
  - Debouncing (250ms default) for selector searches to avoid excessive calls.
  - Live window forcing re-fetch of last 10 minutes ensures freshness for near-real-time panels.
  - Range stitching avoids re-fetching already cached data for the same query/interval.
- Backend
  - Caches with randomized TTL reduce thundering herds.
  - `maxParallelDataQueries = 10` caps concurrent channel searches.
  - Pagination helpers used for listing APIs; data API paginates until `NextPageToken` is empty.
- Limits and notes
  - `MaxQueryPageSize` is set to 1000 and `MaxQueryPages` to 1 in [sift_api_queries.go](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/pkg/plugin/sift_api_queries.go:0:0-0:0) for some listing helpers; large regex matches are constrained (e.g., `MaxAssetRegexMatches`/`MaxChannelRegexMatches`).
  - Resource endpoints have `ResourceLimit = 200`; front-end selectors dedupe and sort.

Extension points and recommendations

- Add new resource endpoints:
  - Implement in [pkg/plugin/resources.go](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/pkg/plugin/resources.go:0:0-0:0), add a case in [CallResource](cci:1://file:///Users/leo/Documents/code/sift-grafana-datasource/pkg/plugin/datasource.go:131:0-153:1) and a helper in [sift_api_queries.go](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/pkg/plugin/sift_api_queries.go:0:0-0:0) if needed. Consume via `datasource.getResource('new-endpoint', params)` in the UI or [variables.ts](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/src/variables.ts:0:0-0:0).
- Add new query types:
  - Extend [src/types.ts](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/src/types.ts:0:0-0:0) to model new query elements.
  - Adjust [src/utils.ts](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/src/utils.ts:0:0-0:0) for default fillers, selection conversion, and templating.
  - Add UI in `src/components/query-editor/` and wire to [VisualSiftQueryEditor.tsx](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/src/components/VisualSiftQueryEditor.tsx:0:0-0:0).
  - Extend backend [queryModel](cci:2://file:///Users/leo/Documents/code/sift-grafana-datasource/pkg/plugin/datasource.go:234:0-239:1) in [pkg/plugin/datasource.go](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/pkg/plugin/datasource.go:0:0-0:0), [generateQueries(...)](cci:1://file:///Users/leo/Documents/code/sift-grafana-datasource/pkg/plugin/datasource.go:412:0-493:1), and frame assembly logic.
- Enhance variables:
  - [variables.ts](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/src/variables.ts:0:0-0:0) can query other entities (runs/channels) if desired; implement a corresponding editor and backend resource usage.
- Improve editor UX:
  - Enable aliasing/transform options (there’s a TODO for “ALIAS” in [VisualSiftQueryEditor.tsx](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/src/components/VisualSiftQueryEditor.tsx:0:0-0:0)).
  - Support multi-channel “select” in one go (UI allows multiple channel queries per subquery).
- E2E coverage:
  - Consider enabling Playwright by renaming `playwright.config.ts.disabled` and adjusting CI gating.

Notable details and minor observations

- [ConfigEditor.tsx](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/src/components/ConfigEditor.tsx:0:0-0:0) imports types from [src/legacyTypes.ts](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/src/legacyTypes.ts:0:0-0:0) while query types live in [src/types.ts](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/src/types.ts:0:0-0:0). This is intentional: both define the datasource options and secure JSON shape and avoids tight coupling to v2.1 query types in config UI.
- [src/resources.hooks.ts](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/src/resources.hooks.ts:0:0-0:0) pushes the raw response and a sorted copy into the same `assets` array and then dedupes; deduplication ensures correctness, though you could avoid double-push for clarity/perf.
- Frontend cache uses refId stitching; ensure that all returned frames from backend preserve `frame.refId` for correct merging.
- Permissions and signing: `npm run sign` uses `GRAFANA_ACCESS_POLICY_TOKEN` in CI for signed bundles.

In summary

- The plugin is a full-stack Grafana datasource:
  - Frontend registers a `DataSourceWithBackend` for query routing, provides a visual query editor, custom variable support, and selector UIs backed by datasource resource endpoints.
  - Backend implements query migration, listing resources for selectors, cache-backed resolution of assets/runs/channels, Sift `/api/v2/data` queries, and DataFrame assembly suitable for Grafana panels.
  - Both sides enforce query migration for robustness. Caching occurs on both sides for performance and reduced load.
- It integrates cleanly with Grafana 11+ via [plugin.json](cci:7://file:///Users/leo/Documents/code/sift-grafana-datasource/src/plugin.json:0:0-0:0), standard SDK handlers, and provisioning.

If you’d like, I can:

- Walk you through adding a new query type or selector field.
- Enable/adjust E2E testing and add coverage for typical flows.
- Profile/optimize large regex searches or high-cardinality channel selection scenarios.
