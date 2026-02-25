package plugin

import (
	"cmp"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"slices"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/httpclient"
	"github.com/grafana/grafana-plugin-sdk-go/backend/instancemgmt"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/grafana/grafana-plugin-sdk-go/data"
	"golang.org/x/sync/errgroup"
)

// Make sure Datasource implements required interfaces. This is important to do
// since otherwise we will only get a not implemented error response from plugin in
// runtime. In this example datasource instance implements backend.QueryDataHandler,
// backend.CheckHealthHandler interfaces. Plugin should not implement all these
// interfaces - only those which are required for a particular task.
var (
	_ backend.QueryDataHandler      = (*SiftDatasource)(nil)
	_ backend.CheckHealthHandler    = (*SiftDatasource)(nil)
	_ instancemgmt.InstanceDisposer = (*SiftDatasource)(nil)
	_ backend.CallResourceHandler   = (*SiftDatasource)(nil)
)

const QueryVersion = "2.1"

const maxParallelDataQueries = 10

const (
	EnumDisplayNone     = ""
	EnumDisplayBoth     = "both"
	EnumDisplayValue    = "value"
	EnumDisplayString   = "string"
	EnumDisplayCombined = "combined"
)

var ValidSiftGrafanaDataTypes = []string{
	"CHANNEL_DATA_TYPE_STRING",
	"CHANNEL_DATA_TYPE_BOOL",
	"CHANNEL_DATA_TYPE_DOUBLE",
	"CHANNEL_DATA_TYPE_FLOAT",
	"CHANNEL_DATA_TYPE_INT_64",
	"CHANNEL_DATA_TYPE_INT_32",
	"CHANNEL_DATA_TYPE_UINT_32",
	"CHANNEL_DATA_TYPE_UINT_64",
	"CHANNEL_DATA_TYPE_ENUM",
	"CHANNEL_DATA_TYPE_BIT_FIELD",
	// Note: No bytes
}

const cacheTimeToLiveMax = time.Minute * 10
const cacheTimeToLiveMin = cacheTimeToLiveMax / 2
const cachePurgeTime = time.Minute * 5

func StringFromChannelSearchKey(c channelSearchKey) string {
	return fmt.Sprintf("[%s] %s", c.assetId, c.searchTerm)
}

// defaultSiftApiTimeout is the default HTTP client timeout for requests from the plugin to the Sift API
// when the datasource does not set a custom value (queryTimeoutSeconds). Long-running data queries
// can take multiple minutes before Sift returns the first byte; without an override the default client
// timeout causes "timeout awaiting response headers" and failed panels.
const defaultSiftApiTimeout = 5 * time.Minute

// NewSiftDatasource creates a new datasource instance.
func NewSiftDatasource(ctx context.Context, s backend.DataSourceInstanceSettings) (instancemgmt.Instance, error) {
	// Initialize http client
	opts, err := s.HTTPClientOptions(ctx)
	if err != nil {
		return nil, err
	}
	// Override timeout for outbound calls to Sift so long queries
	// do not fail with "Client.Timeout exceeded while awaiting headers".
	if opts.Timeouts == nil {
		opts.Timeouts = &httpclient.TimeoutOptions{}
	}
	opts.Timeouts.Timeout = defaultSiftApiTimeout
	if sec := getQueryTimeoutSeconds(s.JSONData); sec > 0 {
		opts.Timeouts.Timeout = time.Duration(sec) * time.Second
	}

	httpClient, err := httpclient.New(opts)
	if err != nil {
		return nil, err
	}

	// Cache logic - ID and Name caches can be long-lived since any misses will result in call to the API
	// Regex caches are shorter since any newly added Assets/Runs/Channels won't be matched unless a new API call is made
	assetsIdsCache := NewTypedCache[string, string](cacheTimeToLiveMax, cachePurgeTime)
	assetsNameCache := NewTypedCacheWithRandomTtl[string, string](cacheTimeToLiveMax, cacheTimeToLiveMin, cachePurgeTime)
	assetsRegexCache := NewTypedCacheWithRandomTtl[string, []string](cacheTimeToLiveMax, cacheTimeToLiveMin, cachePurgeTime)
	runIdsCache := NewTypedCache[string, string](cacheTimeToLiveMax, cachePurgeTime)
	runsNameCache := NewTypedCacheWithRandomTtl[string, []string](cacheTimeToLiveMax, cacheTimeToLiveMin, cachePurgeTime)
	runsRegexCache := NewTypedCacheWithRandomTtl[string, []string](cacheTimeToLiveMax, cacheTimeToLiveMin, cachePurgeTime)
	channelIdsCache := NewTypedCache[string, Channel](cacheTimeToLiveMax, cachePurgeTime)

	channelNameCache := NewTypedCacheWithLoader[channelSearchKey, []Channel, string](
		NewTypedCacheWithRandomTtl[string, []Channel](cacheTimeToLiveMax, cacheTimeToLiveMin, cachePurgeTime),
		getChannelsByNameExact,
		StringFromChannelSearchKey)
	channelRegexCache := NewTypedCacheWithLoader[channelSearchKey, []Channel, string](
		NewTypedCacheWithRandomTtl[string, []Channel](cacheTimeToLiveMax, cacheTimeToLiveMin, cachePurgeTime),
		getChannelsByNameSearch,
		StringFromChannelSearchKey)

	return &SiftDatasource{
		httpClient:               httpClient,
		assetsIdSearchCache:      assetsIdsCache,
		assetsRegexSearchCache:   assetsRegexCache,
		assetsNameSearchCache:    assetsNameCache,
		runsIdSearchCache:        runIdsCache,
		runsRegexSearchCache:     runsRegexCache,
		runsNameSearchCache:      runsNameCache,
		channelsIdSearchCache:    channelIdsCache,
		channelsNameSearchCache:  channelNameCache,
		channelsRegexSearchCache: channelRegexCache,
	}, nil
}

// SiftDatasource is an example datasource which can respond to data queries, reports
// its health and has streaming skills.
type SiftDatasource struct {
	httpClient             *http.Client
	assetsIdSearchCache    *TypedCache[string, string]
	assetsNameSearchCache  *TypedCache[string, string] // assets are unique by name
	assetsRegexSearchCache *TypedCache[string, []string]
	runsIdSearchCache      *TypedCache[string, string]
	runsNameSearchCache    *TypedCache[string, []string] // runs are not unique by name
	runsRegexSearchCache   *TypedCache[string, []string]
	channelsIdSearchCache  *TypedCache[string, Channel]
	// channel caches use loader to avoid duplicate API calls at the same time
	channelsNameSearchCache  *TypedCacheWithLoader[channelSearchKey, []Channel, string]
	channelsRegexSearchCache *TypedCacheWithLoader[channelSearchKey, []Channel, string]
}

// Dispose here tells plugin SDK that plugin wants to clean up resources when a new instance
// created. As soon as datasource settings change detected by SDK old datasource instance will
// be disposed and a new one will be created using NewSampleDatasource factory function.
func (d *SiftDatasource) Dispose() {
	// Clean up datasource instance resources.
}

func (d *SiftDatasource) CallResource(ctx context.Context, req *backend.CallResourceRequest, sender backend.CallResourceResponseSender) error {
	switch req.Path {
	case "assets":
		return d.callResourceAssets(ctx, req, sender)

	case "channels":
		return d.callResourceChannels(ctx, req, sender)

	case "runs":
		return d.callResourceRuns(ctx, req, sender)

	case "migrate-query":
		return d.callResourceMigrateQuery(ctx, req, sender)

	case "purge-cache":
		return d.callPurgeCache(ctx, req, sender)

	case "resolve-query-to-sift-metadata":
		return d.resolveQueryToSiftMetadata(ctx, req, sender)

	default:
		return sender.Send(&backend.CallResourceResponse{
			Status: http.StatusNotFound,
		})
	}
}

// QueryData handles multiple queries and returns multiple responses.
// req contains the queries []DataQuery (where each query contains RefID as a unique identifier).
// The QueryDataResponse contains a map of RefID to the response for each query, and each response
// contains Frames ([]*Frame).
func (d *SiftDatasource) QueryData(ctx context.Context, req *backend.QueryDataRequest) (*backend.QueryDataResponse, error) {
	response := backend.NewQueryDataResponse()

	// loop over queries and execute them individually.
	for _, q := range req.Queries {
		// Unmarshal the JSON into our queryModel.
		var fqm *queryModel
		fqm, err := convertQueryIfNeeded(q.JSON)
		if err != nil {
			response.Responses[q.RefID] = backend.ErrDataResponse(backend.StatusBadRequest, fmt.Sprintf("json unmarshal: %v", err.Error()))
			continue
		}

		if fqm.Hide {
			continue
		}

		res := d.query(req.PluginContext, q, *fqm)
		// save the response in a hashmap
		// based on with RefID as identifier
		response.Responses[q.RefID] = res
	}

	return response, nil
}

type jsonData struct {
	Url                 string `json:"url"`
	FrontendUrl         string `json:"frontendUrl"`
	QueryTimeoutSeconds int    `json:"queryTimeoutSeconds"`
}

type commonQueryProperties struct {
	Key       string `json:"key"`
	Hide      bool   `json:"hide"`
	QueryType string `json:"queryType"`
	RefId     string `json:"refId"`
}

type assetQuery struct {
	AssetId               string `json:"assetId"`
	AssetName             string `json:"assetName"`
	NameAsRegex           bool   `json:"nameAsRegex"`
	AsSelect              bool   `json:"asSelect"`
	DashboardVariableName string `json:"dashboardVariableName"`
}
type runQuery struct {
	RunId       string `json:"runId"`
	RunName     string `json:"runName"`
	NameAsRegex bool   `json:"nameAsRegex"`
	AsSelect    bool   `json:"asSelect"`
}
type channelQuery struct {
	ChannelId   string `json:"channelId"`
	ChannelName string `json:"channelName"`
	NameAsRegex bool   `json:"nameAsRegex"`
	AsSelect    bool   `json:"asSelect"`
}

type channelReferenceQuery struct {
	channelQuery
	ChannelReference string `json:"channelReference"`
}

type calculatedChannelQuery struct {
	Name              string                  `json:"name"`
	ChannelReferences []channelReferenceQuery `json:"channelReferences"`
	Expression        string                  `json:"expression"`
}

type channelDataQuery struct {
	AssetQueries             []assetQuery             `json:"assetQueries"`
	RunQueries               []runQuery               `json:"runQueries"`
	ChannelQueries           []channelQuery           `json:"channelQueries"`
	CalculatedChannelQueries []calculatedChannelQuery `json:"calculatedChannelQueries"`
}

type queryModel struct {
	commonQueryProperties
	ChannelDataQueries []channelDataQuery `json:"channelDataQueries"`
	CombineRuns        bool               `json:"combineRuns"`
	EnumDisplay        string             `json:"enumDisplay"`
	QueryVersion       string             `json:"queryVersion"`
	AnnotationType     string             `json:"annotationType"`
	AnnotationFilter   string             `json:"annotationFilter"`
}

type queryResponse struct {
	Data          []queryResponseData `json:"data"`
	NextPageToken string              `json:"nextPageToken"`
	ErrorMessage  string              `json:"message"`
}

type queryResponseData struct {
	Metadata queryResponseMetadata `json:"metadata"`
	Values   json.RawMessage       `json:"values"`
}

type queryResponseChannelBitFieldElement struct {
	Name     string `json:"name"`
	Index    int32  `json:"index"`
	BitCount uint32 `json:"bitCount"`
}

type queryResponseChannelEnumType struct {
	Name string `json:"name"`
	Key  uint32 `json:"key"`
}

type queryResponseMetadata struct {
	DataType  string `json:"dataType"`
	SampledMs int64  `json:"sampledMs"`
	Asset     struct {
		AssetId string `json:"assetId"`
		Name    string `json:"name"`
	} `json:"asset"`
	Run struct {
		RunId string `json:"runId"`
		Name  string `json:"name"`
	} `json:"run"`
	Channel struct {
		ChannelId        string                                `json:"channelId"`
		Name             string                                `json:"name"`
		EnumTypes        []queryResponseChannelEnumType        `json:"enumTypes"`
		BitFieldElements []queryResponseChannelBitFieldElement `json:"bitFieldElements"`
	} `json:"channel"`
}
type stringValue struct {
	Timestamp time.Time `json:"timestamp"`
	Value     string    `json:"value"`
}

type boolValue struct {
	Timestamp time.Time `json:"timestamp"`
	Value     bool      `json:"value"`
}

type doubleValue struct {
	Timestamp time.Time `json:"timestamp"`
	Value     float64   `json:"value"`
}

type floatValue struct {
	Timestamp time.Time `json:"timestamp"`
	Value     float32   `json:"value"`
}

type int64Value struct { //nolint
	Timestamp time.Time `json:"timestamp"`
	Value     int64     `json:"value"`
}

type int32Value struct {
	Timestamp time.Time `json:"timestamp"`
	Value     int32     `json:"value"`
}

type uint32Value struct {
	Timestamp time.Time `json:"timestamp"`
	Value     uint32    `json:"value"`
}

type uint64Value struct { //nolint
	Timestamp time.Time `json:"timestamp"`
	Value     uint64    `json:"value"`
}

type enumValue struct {
	Timestamp time.Time `json:"timestamp"`
	Value     uint32    `json:"value"`
}

type bitFieldValue struct {
	Timestamp time.Time `json:"timestamp"`
	Value     uint32    `json:"value"`
}

type bitFieldElementValues struct {
	Name   string          `json:"name"`
	Values []bitFieldValue `json:"values"`
}

type frameKey struct {
	channelId           string
	runId               string
	bitFieldElementName string
	isEnumString        bool
	isEnumCombined      bool
}

type expressionChannelReference struct {
	ChannelReference string `json:"channel_reference"`
	ChannelId        string `json:"channel_id"`
	ChannelName      string
}

type calculatedChannelKey struct {
	channelName       string
	channelReferences []expressionChannelReference
}

type channelSearchKey struct {
	assetId    string
	searchTerm string
}

func getQueryTimeoutSeconds(jsonDataBytes []byte) int {
	var jd jsonData
	if err := json.Unmarshal(jsonDataBytes, &jd); err != nil {
		return 0
	}
	if jd.QueryTimeoutSeconds <= 0 {
		return 0
	}
	return jd.QueryTimeoutSeconds
}

func getApiUrl(dataSourceInstanceSettings *backend.DataSourceInstanceSettings) (*url.URL, error) {
	jsonData := jsonData{}
	err := json.Unmarshal(dataSourceInstanceSettings.JSONData, &jsonData)
	if err != nil {
		return nil, fmt.Errorf("json unmarshal: %w", err)
	}

	u, err := url.Parse(jsonData.Url)
	if err != nil {
		return nil, fmt.Errorf("malformed api url: %w", err)
	}
	return u, nil
}

func (d *SiftDatasource) query(pCtx backend.PluginContext, query backend.DataQuery, fqm queryModel) backend.DataResponse {
	defer func() {
		if err := recover(); err != nil {
			log.DefaultLogger.Error("recovered from panic", "error", err)
		}
	}()

	// Route annotationsQuery to the Sift annotations API
	if fqm.AnnotationType == "annotationsQuery" {
		return d.querySiftAnnotations(pCtx, query, fqm)
	}

	var response backend.DataResponse

	queryStart := time.Now()
	queries, calculatedChannelKeys, err := generateQueries(pCtx, fqm, d)
	if err != nil {
		return backend.ErrDataResponse(backend.StatusBadRequest, fmt.Sprintf("error generating queries: %v", err.Error()))
	}
	afterLoadingQueries := time.Now()

	responseData, err := runDataQueries(pCtx, queries, query, d)
	if err != nil {
		return backend.ErrDataResponse(backend.StatusBadRequest, fmt.Sprintf("error generating getting data: %v", err.Error()))
	}
	afterExecutingQueries := time.Now()

	var frame *data.Frame
	if fqm.AnnotationType != "" {
		// Any annotationType set means we want the flat annotation frame format
		frame, err = generateAnnotationFrame(responseData, calculatedChannelKeys, fqm.CombineRuns, fqm.EnumDisplay)
	} else {
		frame, err = generateDataFrame(responseData, calculatedChannelKeys, fqm.CombineRuns, fqm.EnumDisplay)
	}
	if err != nil {
		return backend.ErrDataResponse(backend.StatusBadRequest, fmt.Sprintf("error generating data frame: %v", err.Error()))
	}

	afterTransformingData := time.Now()

	// output timings
	log.DefaultLogger.Debug("timings",
		"loadingQueries", afterLoadingQueries.Sub(queryStart).Milliseconds(),
		"gettingData", afterExecutingQueries.Sub(afterLoadingQueries).Milliseconds(),
		"generatingDataFrame", afterTransformingData.Sub(afterExecutingQueries).Milliseconds(),
	)
	// add the frames to the response.
	response.Frames = append(response.Frames, frame)
	return response
}

// generateQueries creates query objects for both simple channel queries and calculated channel queries.
// For simple channel queries, it looks up asset IDs and channel IDs based on names/identifiers.
// For calculated channel queries, it generates the appropriate query structure with channel references.
// It returns:
// - A slice of query objects that can be sent to the backend API
// - A map of calculated channel keys to their metadata (for calculated channels only)
// - Any error that occurred during query generation
func generateQueries(pCtx backend.PluginContext, fqm queryModel, d *SiftDatasource) ([]siftApiGetDataSubQuery, map[string]calculatedChannelKey, error) {
	queries := []siftApiGetDataSubQuery{}
	calculatedChannelKeys := make(map[string]calculatedChannelKey)

	for _, cdq := range fqm.ChannelDataQueries {
		assetIds := []string{}
		runIds := []string{}

		// Get all asset IDs for the asset queries
		assetIdQueries := []string{}
		for _, assetQuery := range cdq.AssetQueries {
			if assetQuery.AssetId != "" {
				assetIdQueries = append(assetIdQueries, assetQuery.AssetId)
			} else if assetQuery.AssetName != "" {
				foundAssetIds, err := d.getAssetIdsByName(pCtx, assetQuery.AssetName, assetQuery.NameAsRegex)
				if err != nil {
					return nil, nil, fmt.Errorf("error looking up assets: %w", err)
				}
				assetIds = append(assetIds, foundAssetIds...)
			}
		}
		validAssetIds, err := d.getValidAssetsById(pCtx, assetIdQueries)
		if err != nil {
			return nil, nil, fmt.Errorf("error looking up assets: %w", err)
		}
		assetIds = append(assetIds, validAssetIds...)

		if len(assetIds) == 0 {
			return nil, nil, fmt.Errorf("no assets found for query: %v", assetIdQueries)
		}

		// Get all run IDs for the run queries
		runIdQueries := []string{}
		for _, runQuery := range cdq.RunQueries {
			// TODO: handle nil run
			if runQuery.RunId != "" {
				runIdQueries = append(runIdQueries, runQuery.RunId)
			} else if runQuery.RunName != "" {
				foundRunIds, err := d.getRunIdsByName(pCtx, assetIds, runQuery.RunName, runQuery.NameAsRegex)
				if err != nil {
					return nil, nil, fmt.Errorf("error looking up runs: %w", err)
				}
				runIds = append(runIds, foundRunIds...)
			}
		}
		validRunIds, err := d.getValidRunsById(pCtx, runIdQueries)
		if err != nil {
			return nil, nil, fmt.Errorf("error looking up runs: %w", err)
		}
		runIds = append(runIds, validRunIds...)

		// Process regular channel queries
		channelQueries, err := getChannelQueries(pCtx, cdq, runIds, assetIds, d)
		if err != nil {
			return nil, nil, err
		}
		queries = append(queries, channelQueries...)

		//Process calculated channel queries
		calculationQueries, calculatedChanKeys, err := getCalculationQueries(pCtx, cdq, runIds, assetIds, fqm, d)
		if err != nil {
			return nil, nil, err
		}
		queries = append(queries, calculationQueries...)
		for key, val := range calculatedChanKeys {
			calculatedChannelKeys[key] = val
		}

		if len(queries) == 0 {
			log.DefaultLogger.Debug("No channels found for query", "assetIds", assetIds, "runIds", runIds, "channelQueries", cdq.ChannelQueries)
		}
	}

	return queries, calculatedChannelKeys, nil
}

func sortedKeys(set map[string]struct{}) []string {
	if len(set) == 0 {
		return []string{}
	}
	result := make([]string, 0, len(set))
	for k := range set {
		result = append(result, k)
	}
	slices.Sort(result)
	return result
}

func splitQueries(queries []siftApiGetDataSubQuery, chunkSize int) [][]siftApiGetDataSubQuery {
	var chunks [][]siftApiGetDataSubQuery
	for i := 0; i < len(queries); i += chunkSize {
		end := i + chunkSize
		if end > len(queries) {
			end = len(queries)
		}
		chunks = append(chunks, queries[i:end])
	}
	return chunks
}

func runDataQueries(pCtx backend.PluginContext, queries []siftApiGetDataSubQuery, query backend.DataQuery, d *SiftDatasource) ([]queryResponseData, error) {
	chunks := splitQueries(queries, (len(queries)+maxParallelDataQueries-1)/maxParallelDataQueries)

	var allData []queryResponseData
	var mu sync.Mutex

	g, _ := errgroup.WithContext(context.Background())
	g.SetLimit(maxParallelDataQueries)
	for _, chunk := range chunks {
		chunk := chunk
		g.Go(func() error {
			dataResponse, err := d.getData(pCtx, chunk, query)
			if err != nil {
				return err
			}
			mu.Lock()
			allData = append(allData, dataResponse...)
			mu.Unlock()
			return nil
		})
	}
	if err := g.Wait(); err != nil {
		return nil, err
	}

	return allData, nil
}

func generateDataFrame(responseData []queryResponseData, calculatedChannelKeys map[string]calculatedChannelKey, combineRuns bool, enumDisplay string) (*data.Frame, error) {
	// create data frame response.
	// For an overview on data frames and how grafana handles them:
	// https://grafana.com/developers/plugin-tools/introduction/data-frames
	dataMap := map[frameKey][]queryResponseData{}
	md := map[frameKey]queryResponseMetadata{}
	allData := map[frameKey]map[int64]any{}

	for _, d := range responseData {
		switch d.Metadata.DataType {
		case "CHANNEL_DATA_TYPE_BIT_FIELD":
			for _, bitFieldElement := range d.Metadata.Channel.BitFieldElements {
				key := frameKey{
					channelId:           d.Metadata.Channel.ChannelId,
					bitFieldElementName: bitFieldElement.Name,
				}
				if !combineRuns {
					key.runId = d.Metadata.Run.RunId
				}
				dataMap[key] = append(dataMap[key], d)
				if _, ok := md[key]; !ok {
					md[key] = d.Metadata
				}
			}
		case "CHANNEL_DATA_TYPE_ENUM":
			if enumDisplay == EnumDisplayCombined {
				key := frameKey{
					channelId:      d.Metadata.Channel.ChannelId,
					isEnumCombined: true,
				}
				if !combineRuns {
					key.runId = d.Metadata.Run.RunId
				}
				dataMap[key] = append(dataMap[key], d)
				if _, ok := md[key]; !ok {
					md[key] = d.Metadata
				}
			} else {
				for _, v := range []bool{true, false} {
					key := frameKey{
						channelId:    d.Metadata.Channel.ChannelId,
						isEnumString: v,
					}
					if !combineRuns {
						key.runId = d.Metadata.Run.RunId
					}
					dataMap[key] = append(dataMap[key], d)
					if _, ok := md[key]; !ok {
						md[key] = d.Metadata
					}
				}
			}
		default:
			key := frameKey{
				channelId: d.Metadata.Channel.ChannelId,
			}
			if !combineRuns {
				key.runId = d.Metadata.Run.RunId
			}
			dataMap[key] = append(dataMap[key], d)
			if _, ok := md[key]; !ok {
				md[key] = d.Metadata
			}
		}
	}

	allTimestamps := map[int64]bool{}
	for key, dm := range dataMap {
		values := map[int64]any{}
		allData[key] = values

		switch dm[0].Metadata.DataType {
		default:
			return nil, fmt.Errorf("unknown data type: %v", dm[0].Metadata.DataType)

		case "CHANNEL_DATA_TYPE_STRING":
			for _, d := range dm {
				var v []stringValue
				err := json.Unmarshal(d.Values, &v)
				if err != nil {
					return nil, fmt.Errorf("json unmarshal: %w", err)
				}
				for _, vv := range v {
					values[vv.Timestamp.UnixNano()] = vv.Value
				}
			}

		case "CHANNEL_DATA_TYPE_BOOL":
			for _, d := range dm {
				var v []boolValue
				err := json.Unmarshal(d.Values, &v)
				if err != nil {
					return nil, fmt.Errorf("json unmarshal: %w", err)
				}
				for _, vv := range v {
					values[vv.Timestamp.UnixNano()] = vv.Value
				}
			}

		case "CHANNEL_DATA_TYPE_DOUBLE":
			for _, d := range dm {
				var v []doubleValue
				err := json.Unmarshal(d.Values, &v)
				if err != nil {
					return nil, fmt.Errorf("json unmarshal: %w", err)
				}
				for _, vv := range v {
					values[vv.Timestamp.UnixNano()] = vv.Value
				}
			}

		case "CHANNEL_DATA_TYPE_FLOAT":
			for _, d := range dm {
				var v []floatValue
				err := json.Unmarshal(d.Values, &v)
				if err != nil {
					return nil, fmt.Errorf("json unmarshal: %w", err)
				}
				for _, vv := range v {
					values[vv.Timestamp.UnixNano()] = vv.Value
				}
			}

		case "CHANNEL_DATA_TYPE_INT_64":
			for _, d := range dm {
				// note that these are returned as strings in the proto -> json mapping https://protobuf.dev/programming-guides/proto3/#json
				var v []stringValue
				err := json.Unmarshal(d.Values, &v)
				if err != nil {
					return nil, fmt.Errorf("json unmarshal: %w", err)
				}
				for _, vv := range v {
					number, err := strconv.ParseInt(vv.Value, 10, 64)
					if err != nil {
						return nil, fmt.Errorf("failed to parse value: %w", err)
					}
					values[vv.Timestamp.UnixNano()] = number
				}
			}

		case "CHANNEL_DATA_TYPE_INT_32":
			for _, d := range dm {
				var v []int32Value
				err := json.Unmarshal(d.Values, &v)
				if err != nil {
					return nil, fmt.Errorf("json unmarshal: %w", err)
				}
				for _, vv := range v {
					values[vv.Timestamp.UnixNano()] = vv.Value
				}
			}

		case "CHANNEL_DATA_TYPE_UINT_32":
			for _, d := range dm {
				var v []uint32Value
				err := json.Unmarshal(d.Values, &v)
				if err != nil {
					return nil, fmt.Errorf("json unmarshal: %w", err)
				}
				for _, vv := range v {
					values[vv.Timestamp.UnixNano()] = vv.Value
				}
			}

		case "CHANNEL_DATA_TYPE_UINT_64":
			for _, d := range dm {
				// note that these are returned as strings in the proto -> json mapping https://protobuf.dev/programming-guides/proto3/#json
				var v []stringValue
				err := json.Unmarshal(d.Values, &v)
				if err != nil {
					return nil, fmt.Errorf("json unmarshal: %w", err)
				}
				for _, vv := range v {
					number, err := strconv.ParseUint(vv.Value, 10, 64)
					if err != nil {
						return nil, fmt.Errorf("failed to parse value: %w", err)
					}
					values[vv.Timestamp.UnixNano()] = number
				}
			}
		case "CHANNEL_DATA_TYPE_ENUM":
			for _, d := range dm {
				var v []enumValue
				err := json.Unmarshal(d.Values, &v)
				if err != nil {
					return nil, fmt.Errorf("json unmarshal: %w", err)
				}
				enumLookup := map[uint32]string{}
				for _, e := range d.Metadata.Channel.EnumTypes {
					enumLookup[e.Key] = e.Name
				}

				for _, vv := range v {
					if key.isEnumCombined {
						enumName, ok := enumLookup[vv.Value]
						if ok {
							values[vv.Timestamp.UnixNano()] = fmt.Sprintf("[%d] %s", vv.Value, enumName)
						} else {
							values[vv.Timestamp.UnixNano()] = fmt.Sprintf("%d", vv.Value)
						}
					} else if key.isEnumString {
						if enumName, ok := enumLookup[vv.Value]; ok {
							values[vv.Timestamp.UnixNano()] = enumName
						} else {
							values[vv.Timestamp.UnixNano()] = fmt.Sprintf("%v", vv.Value)
						}
					} else {
						values[vv.Timestamp.UnixNano()] = vv.Value
					}
				}
			}

		case "CHANNEL_DATA_TYPE_BIT_FIELD":
			for _, d := range dm {
				var v []bitFieldElementValues
				err := json.Unmarshal(d.Values, &v)
				if err != nil {
					return nil, fmt.Errorf("json unmarshal: %w", err)
				}
				for _, bitfieldElementValues := range v {
					if key.bitFieldElementName == bitfieldElementValues.Name {
						for _, vv := range bitfieldElementValues.Values {
							values[vv.Timestamp.UnixNano()] = vv.Value
						}
					}
				}
			}
		}

		for k := range values {
			allTimestamps[k] = true
		}
	}

	timestamps := []time.Time{}
	for k := range allTimestamps {
		timestamps = append(timestamps, time.Unix(0, k))
	}
	sort.Slice(timestamps, func(i, j int) bool {
		return timestamps[i].Before(timestamps[j])
	})

	frame := data.NewFrame("response")

	allDataKeys := []frameKey{}
	for k := range allData {
		allDataKeys = append(allDataKeys, k)
	}
	sort.SliceStable(allDataKeys, func(i, j int) bool {
		return allDataKeys[i].runId < allDataKeys[j].runId && allDataKeys[i].channelId < allDataKeys[j].channelId
	})

	// Track enum field base names for filtering later
	enumFieldBaseNames := map[string]bool{}

	for _, key := range allDataKeys {
		m := md[key]
		name := m.Channel.Name
		include_channel_id := false
		var field *data.Field
		labels := data.Labels{}
		if v, ok := calculatedChannelKeys[m.Channel.ChannelId]; ok {
			name = v.channelName
			for _, cr := range v.channelReferences {
				labels[cr.ChannelReference] = cr.ChannelName
				labels[fmt.Sprintf("%s_id", cr.ChannelReference)] = cr.ChannelId
			}
		} else {
			include_channel_id = true
		}
		if m.Run.Name != "" && !combineRuns {
			labels["run"] = m.Run.Name
		}
		if m.Run.RunId != "" && !combineRuns {
			labels["run_id"] = m.Run.RunId
		}
		if m.Asset.Name != "" {
			labels["asset"] = m.Asset.Name
		}
		if m.Asset.AssetId != "" {
			labels["asset_id"] = m.Asset.AssetId
		}
		if len(m.Channel.BitFieldElements) > 0 {
			for _, bitFieldElement := range m.Channel.BitFieldElements {
				if key.bitFieldElementName == bitFieldElement.Name {
					labels["bitfield_element"] = bitFieldElement.Name
				}
			}
		}
		if include_channel_id {
			labels["channel_id"] = m.Channel.ChannelId
		}

		switch m.DataType {
		default:
			return nil, fmt.Errorf("unknown data type: %v", m.DataType)

		case "CHANNEL_DATA_TYPE_STRING":
			field = data.NewField(name, labels, []*string{})

		case "CHANNEL_DATA_TYPE_BOOL":
			field = data.NewField(name, labels, []*bool{})

		case "CHANNEL_DATA_TYPE_DOUBLE":
			field = data.NewField(name, labels, []*float64{})

		case "CHANNEL_DATA_TYPE_FLOAT":
			field = data.NewField(name, labels, []*float32{})

		case "CHANNEL_DATA_TYPE_INT_64":
			field = data.NewField(name, labels, []*int64{})

		case "CHANNEL_DATA_TYPE_INT_32":
			field = data.NewField(name, labels, []*int32{})

		case "CHANNEL_DATA_TYPE_UINT_32":
			field = data.NewField(name, labels, []*uint32{})

		case "CHANNEL_DATA_TYPE_UINT_64":
			field = data.NewField(name, labels, []*uint64{})

		case "CHANNEL_DATA_TYPE_ENUM":
			if key.isEnumCombined {
				field = data.NewField(name, labels, []*string{})
			} else {
				// Track the base name for this enum field
				enumFieldBaseNames[name] = true
				if key.isEnumString {
					name = name + "_string"
					field = data.NewField(name, labels, []*string{})
				} else {
					name = name + "_value"
					field = data.NewField(name, labels, []*uint32{})
				}
			}

		case "CHANNEL_DATA_TYPE_BIT_FIELD":
			field = data.NewField(name, labels, []*uint32{})
		}

		field.Extend(len(timestamps))
		values := allData[key]
		for i, t := range timestamps {
			v := values[t.UnixNano()]
			if v != nil {
				field.SetConcrete(i, v)
			}
		}

		frame.Fields = append(frame.Fields, field)
	}

	// Filter and rename enum fields based on enumDisplay setting
	if enumDisplay == EnumDisplayString || enumDisplay == EnumDisplayValue {

		filteredFields := []*data.Field{}
		for _, field := range frame.Fields {
			fieldName := field.Name
			// Check if this is an enum field by looking for the suffix
			isEnumField := false
			baseName := ""
			keepField := false

			if strings.HasSuffix(fieldName, "_string") {
				baseName = strings.TrimSuffix(fieldName, "_string")
				if enumFieldBaseNames[baseName] {
					isEnumField = true
					keepField = enumDisplay == EnumDisplayString
				}
			} else if strings.HasSuffix(fieldName, "_value") {
				baseName = strings.TrimSuffix(fieldName, "_value")
				if enumFieldBaseNames[baseName] {
					isEnumField = true
					keepField = enumDisplay == EnumDisplayValue
				}
			}

			if isEnumField {
				if keepField {
					// Rename the field to remove the suffix
					field.Name = baseName
					filteredFields = append(filteredFields, field)
				}
				// Skip fields we don't want to keep
			} else {
				// Keep non-enum fields as-is
				filteredFields = append(filteredFields, field)
			}
		}
		frame.Fields = filteredFields
	}

	// Sort fields by channel name first.
	// Calculated channels will all have the
	// same channel name, so we also sort by labels.
	slices.SortFunc(frame.Fields, func(a, b *data.Field) int {
		return cmp.Or(
			strings.Compare(a.Name, b.Name),
			strings.Compare(a.Labels.String(), b.Labels.String()),
		)
	})

	// The time channel should always be first in the frame.
	frame.Fields = append(
		[]*data.Field{data.NewField("time", nil, timestamps)},
		frame.Fields...,
	)

	// Add frame metadata
	frame.Meta = &data.FrameMeta{
		Type:        data.FrameTypeTimeSeriesWide,
		TypeVersion: data.FrameTypeVersion{0, 1},
		Notices:     []data.Notice{},
	}

	// Check for precision loss in INT64/UINT64 fields
	checkInt64PrecisionLoss(frame)

	return frame, nil
}

// generateAnnotationFrame creates an annotation-compatible data frame by reusing generateDataFrame
// and converting it to a flat row-per-event format with metadata columns.
func generateAnnotationFrame(responseData []queryResponseData, calculatedChannelKeys map[string]calculatedChannelKey, combineRuns bool, enumDisplay string) (*data.Frame, error) {
	// Use combined mode for enums so we get a single "string (number)" field
	annotationEnumDisplay := enumDisplay
	if annotationEnumDisplay == "" || annotationEnumDisplay == EnumDisplayBoth {
		annotationEnumDisplay = EnumDisplayCombined
	}
	sourceFrame, err := generateDataFrame(responseData, calculatedChannelKeys, combineRuns, annotationEnumDisplay)
	if err != nil {
		return nil, err
	}

	// Find the time field
	var timeField *data.Field
	for _, f := range sourceFrame.Fields {
		if f.Type() == data.FieldTypeTime {
			timeField = f
			break
		}
	}
	if timeField == nil {
		return nil, fmt.Errorf("no time field found in source frame")
	}

	// Collect annotation entries from all value fields
	type annotationEntry struct {
		timestamp   time.Time
		value       string
		channelId   string
		channelName string
		assetId     string
		assetName   string
		runId       string
		runName     string
	}
	var entries []annotationEntry

	// Track which metadata fields have values
	hasChannelId := false
	hasAssetId := false
	hasAssetName := false
	hasRunId := false
	hasRunName := false

	for _, field := range sourceFrame.Fields {
		if field.Type() == data.FieldTypeTime {
			continue
		}

		// Extract metadata from labels
		labels := field.Labels
		channelName := field.Name
		channelId := labels["channel_id"]
		assetName := labels["asset"]
		assetId := labels["asset_id"]
		runName := labels["run"]
		runId := labels["run_id"]

		// Track which fields exist
		if channelId != "" {
			hasChannelId = true
		}
		if assetId != "" {
			hasAssetId = true
		}
		if assetName != "" {
			hasAssetName = true
		}
		if runId != "" {
			hasRunId = true
		}
		if runName != "" {
			hasRunName = true
		}

		// Iterate through all rows
		for i := 0; i < field.Len(); i++ {
			val := field.At(i)
			if val == nil {
				continue
			}

			t := timeField.At(i).(time.Time)

			// Convert value to string
			var valueStr string
			switch v := val.(type) {
			case *string:
				if v != nil {
					valueStr = *v
				}
			case *bool:
				if v != nil {
					valueStr = strconv.FormatBool(*v)
				}
			case *float64:
				if v != nil {
					valueStr = strconv.FormatFloat(*v, 'f', -1, 64)
				}
			case *float32:
				if v != nil {
					valueStr = strconv.FormatFloat(float64(*v), 'f', -1, 32)
				}
			case *int64:
				if v != nil {
					valueStr = strconv.FormatInt(*v, 10)
				}
			case *int32:
				if v != nil {
					valueStr = strconv.FormatInt(int64(*v), 10)
				}
			case *uint64:
				if v != nil {
					valueStr = strconv.FormatUint(*v, 10)
				}
			case *uint32:
				if v != nil {
					valueStr = strconv.FormatUint(uint64(*v), 10)
				}
			default:
				valueStr = fmt.Sprintf("%v", val)
			}

			entries = append(entries, annotationEntry{
				timestamp:   t,
				value:       valueStr,
				channelId:   channelId,
				channelName: channelName,
				assetId:     assetId,
				assetName:   assetName,
				runId:       runId,
				runName:     runName,
			})
		}
	}

	// Sort by timestamp
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].timestamp.Before(entries[j].timestamp)
	})

	// Build annotation frame
	n := len(entries)
	times := make([]time.Time, n)
	values := make([]string, n)
	channelNames := make([]string, n)

	for i, e := range entries {
		times[i] = e.timestamp
		values[i] = e.value
		channelNames[i] = e.channelName
	}

	frame := data.NewFrame("annotations",
		data.NewField("time", nil, times),
		data.NewField("value", nil, values),
		data.NewField("channelName", nil, channelNames),
	)

	// Conditionally add metadata fields
	if hasChannelId {
		channelIds := make([]string, n)
		for i, e := range entries {
			channelIds[i] = e.channelId
		}
		frame.Fields = append(frame.Fields, data.NewField("channelId", nil, channelIds))
	}
	if hasAssetName {
		assetNames := make([]string, n)
		for i, e := range entries {
			assetNames[i] = e.assetName
		}
		frame.Fields = append(frame.Fields, data.NewField("assetName", nil, assetNames))
	}
	if hasAssetId {
		assetIds := make([]string, n)
		for i, e := range entries {
			assetIds[i] = e.assetId
		}
		frame.Fields = append(frame.Fields, data.NewField("assetId", nil, assetIds))
	}
	if hasRunName {
		runNames := make([]string, n)
		for i, e := range entries {
			runNames[i] = e.runName
		}
		frame.Fields = append(frame.Fields, data.NewField("runName", nil, runNames))
	}
	if hasRunId {
		runIds := make([]string, n)
		for i, e := range entries {
			runIds[i] = e.runId
		}
		frame.Fields = append(frame.Fields, data.NewField("runId", nil, runIds))
	}

	return frame, nil
}

// querySiftAnnotations handles the annotationsQuery type by calling the Sift annotations API
// and converting the response into a Grafana-compatible annotation data frame.
func (d *SiftDatasource) querySiftAnnotations(pCtx backend.PluginContext, query backend.DataQuery, fqm queryModel) backend.DataResponse {
	var response backend.DataResponse

	annotations, err := d.listSiftAnnotations(pCtx, query, fqm.AnnotationFilter)
	if err != nil {
		return backend.ErrDataResponse(backend.StatusBadRequest, fmt.Sprintf("error listing Sift annotations: %v", err.Error()))
	}

	frame, err := generateSiftAnnotationsFrame(annotations)
	if err != nil {
		return backend.ErrDataResponse(backend.StatusBadRequest, fmt.Sprintf("error generating Sift annotations frame: %v", err.Error()))
	}

	response.Frames = append(response.Frames, frame)
	return response
}

// generateSiftAnnotationsFrame converts a slice of SiftAnnotation into a Grafana data frame.
func generateSiftAnnotationsFrame(annotations []SiftAnnotation) (*data.Frame, error) {
	n := len(annotations)

	startTimes := make([]time.Time, n)
	endTimes := make([]*time.Time, n)
	names := make([]string, n)
	descriptions := make([]string, n)
	annotationIds := make([]string, n)
	annotationTypes := make([]string, n)
	tags := make([]string, n)
	states := make([]string, n)

	// Track which optional fields have values
	hasRunId := false
	hasAssetIds := false

	for i, a := range annotations {
		// Parse start time
		t, err := time.Parse(time.RFC3339Nano, a.StartTime)
		if err != nil {
			return nil, fmt.Errorf("error parsing start_time for annotation %s: %w", a.AnnotationId, err)
		}
		startTimes[i] = t

		// Parse end time (optional)
		if a.EndTime != "" {
			et, err := time.Parse(time.RFC3339Nano, a.EndTime)
			if err != nil {
				return nil, fmt.Errorf("error parsing end_time for annotation %s: %w", a.AnnotationId, err)
			}
			endTimes[i] = &et
		}

		names[i] = a.Name
		descriptions[i] = a.Description
		annotationIds[i] = a.AnnotationId
		annotationTypes[i] = a.AnnotationType
		states[i] = a.State

		if len(a.Tags) > 0 {
			tags[i] = strings.Join(a.Tags, ", ")
		}

		if a.RunId != "" {
			hasRunId = true
		}
		if len(a.AssetIds) > 0 {
			hasAssetIds = true
		}
	}

	frame := data.NewFrame("annotations",
		data.NewField("time", nil, startTimes),
		data.NewField("timeEnd", nil, endTimes),
		data.NewField("title", nil, names),
		data.NewField("text", nil, descriptions),
		data.NewField("tags", nil, tags),
		data.NewField("annotationId", nil, annotationIds),
		data.NewField("annotationType", nil, annotationTypes),
		data.NewField("state", nil, states),
	)

	// Conditionally add optional fields
	if hasRunId {
		runIds := make([]string, n)
		for i, a := range annotations {
			runIds[i] = a.RunId
		}
		frame.Fields = append(frame.Fields, data.NewField("runId", nil, runIds))
	}
	if hasAssetIds {
		assetIds := make([]string, n)
		for i, a := range annotations {
			if len(a.AssetIds) > 0 {
				assetIds[i] = strings.Join(a.AssetIds, ", ")
			}
		}
		frame.Fields = append(frame.Fields, data.NewField("assetIds", nil, assetIds))
	}

	return frame, nil
}

// checkInt64PrecisionLoss validates INT64/UINT64 fields for values outside JavaScript's safe integer range
// and attaches warnings to the frame if precision loss may occur in the frontend.
func checkInt64PrecisionLoss(frame *data.Frame) {
	// JavaScript's safe integer range: ±2^53-1
	const jsSafeIntMax int64 = 9007199254740991  // 2^53 - 1
	const jsSafeIntMin int64 = -9007199254740991 // -(2^53 - 1)
	const jsSafeUintMax uint64 = 9007199254740991
	const warningFormat = "Field '%s' (asset: %s) contains %s values outside JavaScript's safe integer range (min: %d, max: %d). Values may not be displayed correctly."

	for _, field := range frame.Fields {
		var warning string

		switch field.Type() {
		case data.FieldTypeInt64, data.FieldTypeNullableInt64:
			var minVal, maxVal int64
			hasUnsafe := false

			for i := 0; i < field.Len(); i++ {
				var val int64
				if v, ok := field.At(i).(*int64); ok && v != nil {
					val = *v
				} else if v, ok := field.At(i).(int64); ok {
					val = v
				} else {
					continue
				}

				if i == 0 || val < minVal {
					minVal = val
				}
				if i == 0 || val > maxVal {
					maxVal = val
				}
				if val > jsSafeIntMax || val < jsSafeIntMin {
					hasUnsafe = true
				}
			}

			if hasUnsafe {
				assetName := field.Labels["asset"]
				if assetName == "" {
					assetName = "unknown"
				}
				warning = fmt.Sprintf(warningFormat, field.Name, assetName, "INT64", minVal, maxVal)
			}

		case data.FieldTypeUint64, data.FieldTypeNullableUint64:
			var minVal, maxVal uint64
			hasUnsafe := false

			for i := 0; i < field.Len(); i++ {
				var val uint64
				if v, ok := field.At(i).(*uint64); ok && v != nil {
					val = *v
				} else if v, ok := field.At(i).(uint64); ok {
					val = v
				} else {
					continue
				}

				if i == 0 || val < minVal {
					minVal = val
				}
				if i == 0 || val > maxVal {
					maxVal = val
				}
				if val > jsSafeUintMax {
					hasUnsafe = true
				}
			}

			if hasUnsafe {
				assetName := field.Labels["asset"]
				if assetName == "" {
					assetName = "unknown"
				}
				warning = fmt.Sprintf(warningFormat, field.Name, assetName, "UINT64", minVal, maxVal)
			}

		default:
			// no checking needed
		}

		if warning != "" {
			if frame.Meta == nil {
				frame.Meta = &data.FrameMeta{}
			}
			frame.Meta.Notices = append(frame.Meta.Notices, data.Notice{
				Severity: data.NoticeSeverityWarning,
				Text:     warning,
			})
			log.DefaultLogger.Warn(warning)
		}
	}
}

func getChannelQueries(pCtx backend.PluginContext, cdq channelDataQuery, runIds []string, assetIds []string, d *SiftDatasource) ([]siftApiGetDataSubQuery, error) {
	queries := []siftApiGetDataSubQuery{}
	if cdq.ChannelQueries == nil {
		return queries, nil
	}

	// create map of valid data types
	ValidSiftDataTypesMap := make(map[string]interface{})
	for _, dataType := range ValidSiftGrafanaDataTypes {
		ValidSiftDataTypesMap[dataType] = new(interface{})
	}

	channelIds := []string{}
	// Get all channel IDs for the channel queries
	channelIdQueries := []string{}
	for _, channelQuery := range cdq.ChannelQueries {
		if channelQuery.ChannelId != "" {
			channelIdQueries = append(channelIdQueries, channelQuery.ChannelId)
		} else if channelQuery.ChannelName != "" {
			// If we have a channel name, search for matching channels for each asset
			channelNameExactSearches := make([]channelSearchKey, 0)
			channelNameRegexSearches := make([]channelSearchKey, 0)
			for _, assetId := range assetIds {
				if channelQuery.NameAsRegex {
					channelNameRegexSearches = append(channelNameRegexSearches, channelSearchKey{
						assetId:    assetId,
						searchTerm: channelQuery.ChannelName,
					})
				} else {
					channelNameExactSearches = append(channelNameExactSearches, channelSearchKey{
						assetId:    assetId,
						searchTerm: channelQuery.ChannelName,
					})
				}
			}
			resultsExact, err := parallelSearchChannels(d, pCtx, channelNameExactSearches, 10, d.channelsNameSearchCache)
			if err != nil {
				return nil, fmt.Errorf("error looking up exact channels: %w", err)
			}
			for _, channels := range resultsExact {
				for _, channel := range channels {
					// Any channels that are not a compatible data type, remove from query
					if _, ok := ValidSiftDataTypesMap[channel.DataType]; ok {
						channelIds = append(channelIds, channel.ChannelId)
					}
				}
			}
			resultsRegex, err := parallelSearchChannels(d, pCtx, channelNameRegexSearches, 10, d.channelsRegexSearchCache)
			if err != nil {
				return nil, fmt.Errorf("error looking up regex channels: %w", err)
			}
			for _, channels := range resultsRegex {
				for _, channel := range channels {
					// Any channels that are not a compatible data type, remove from query
					if _, ok := ValidSiftDataTypesMap[channel.DataType]; ok {
						channelIds = append(channelIds, channel.ChannelId)
					}
				}
			}
		}
	}

	results, err := d.getChannelsById(pCtx, channelIdQueries)
	if err != nil {
		return nil, fmt.Errorf("error looking up channels: %w", err)
	}
	validChannelIds := []string{}
	for _, channel := range results {
		validChannelIds = append(validChannelIds, channel.ChannelId)
	}
	channelIds = append(channelIds, validChannelIds...)

	if len(runIds) > 0 {
		for _, channelId := range channelIds {
			for _, runId := range runIds {
				queries = append(queries, siftApiGetDataSubQuery{
					Channel: &siftApiChannel{
						ChannelId: channelId,
						RunId:     &runId,
					}})
				{
				}
			}
		}
	} else {
		for _, channelId := range channelIds {
			queries = append(queries, siftApiGetDataSubQuery{
				Channel: &siftApiChannel{
					ChannelId: channelId,
				}})
			{
			}
		}

	}

	return queries, nil
}

func getCalculationQueries(pCtx backend.PluginContext, cdq channelDataQuery, runIds []string, assetIds []string, fqm queryModel, d *SiftDatasource) ([]siftApiGetDataSubQuery, map[string]calculatedChannelKey, error) {
	queries := []siftApiGetDataSubQuery{}
	calculatedChannelKeys := map[string]calculatedChannelKey{}
	if cdq.CalculatedChannelQueries == nil {
		return queries, calculatedChannelKeys, nil
	}

	for _, calcChannelQuery := range cdq.CalculatedChannelQueries {
		if calcChannelQuery.Name == "" {
			return nil, nil, fmt.Errorf("calculated channel query name is required")
		}
		if calcChannelQuery.Expression == "" {
			return nil, nil, fmt.Errorf("calculated channel expression is required")
		}
		if len(calcChannelQuery.ChannelReferences) == 0 {
			return nil, nil, fmt.Errorf("calculated channel channel references are required")
		}

		// Process channel references - map[assetId][channelReference]
		channelReferencesMap := make(map[string]map[string][]expressionChannelReference)
		for _, assetId := range assetIds {
			channelReferencesMap[assetId] = make(map[string][]expressionChannelReference)
			for _, channelRef := range calcChannelQuery.ChannelReferences {
				channelReferencesMap[assetId][channelRef.ChannelReference] = []expressionChannelReference{}
				log.DefaultLogger.Debug("Processing calculated channel reference", "assetId", assetId, "calculatedChannel", calcChannelQuery.Name, "channelReference", channelRef.ChannelReference, "channelId", channelRef.ChannelId, "channelName", channelRef.ChannelName)
				if channelRef.ChannelId != "" {
					var results []Channel
					var err error
					results, err = d.getChannelsById(pCtx, []string{channelRef.ChannelId})
					if err != nil {
						return nil, nil, fmt.Errorf("error looking up channels: %w", err)
					}
					if len(results) == 0 {
						log.DefaultLogger.Warn("No matching channels found for reference channel id",
							"assetId", assetId, "calculatedChannel", calcChannelQuery.Name, "channelReference", channelRef.ChannelReference, "channelId", channelRef.ChannelId)
						continue
					}
					for _, channel := range results {
						channelReferencesMap[assetId][channelRef.ChannelReference] = append(channelReferencesMap[assetId][channelRef.ChannelReference], expressionChannelReference{
							ChannelReference: channelRef.ChannelReference,
							ChannelId:        channel.ChannelId,
							ChannelName:      channel.Name,
						})
					}
				} else if channelRef.ChannelName != "" {
					// If we have a channel name, search for matching channels
					var channels []Channel
					var err error
					if channelRef.NameAsRegex {
						channels, err = d.channelsRegexSearchCache.GetOrWait(d, pCtx, channelSearchKey{assetId: assetId, searchTerm: channelRef.ChannelName})
					} else {
						channels, err = d.channelsNameSearchCache.GetOrWait(d, pCtx, channelSearchKey{assetId: assetId, searchTerm: channelRef.ChannelName})
					}

					if err != nil || channels == nil {
						log.DefaultLogger.Warn("No matching channels found for reference search",
							"assetId", assetId, "calculatedChannel", calcChannelQuery.Name, "channelReference", channelRef.ChannelReference, "searchTerm", channelRef.ChannelName, "asRegex", channelRef.NameAsRegex)
						continue
					}
					for _, channel := range channels {
						channelReferencesMap[assetId][channelRef.ChannelReference] = append(channelReferencesMap[assetId][channelRef.ChannelReference], expressionChannelReference{
							ChannelReference: channelRef.ChannelReference,
							ChannelId:        channel.ChannelId,
							ChannelName:      channel.Name,
						})
					}
				}
			}
		}

		// Generate permutations for each asset and channel reference combination
		for assetId, channelRefsByName := range channelReferencesMap {
			// Skip assets with no channel references
			if len(channelRefsByName) == 0 || len(channelRefsByName) != len(calcChannelQuery.ChannelReferences) {
				log.DefaultLogger.Warn("Skipping calculated channel for asset due to missing channel references",
					"assetId", assetId, "calculatedChannel", calcChannelQuery.Name)
				continue
			}
			// Generate all combinations of channel references
			generateCombinations := func(channelRefsByName map[string][]expressionChannelReference) []map[string]expressionChannelReference {
				// Get all reference names
				refNames := make([]string, 0, len(channelRefsByName))
				for refName := range channelRefsByName {
					refNames = append(refNames, refName)
				}

				// Helper function to recursively generate combinations
				var generateHelper func(int, map[string]expressionChannelReference) []map[string]expressionChannelReference
				generateHelper = func(refIdx int, current map[string]expressionChannelReference) []map[string]expressionChannelReference {
					// Base case: if we've processed all references, return the current combination
					if refIdx >= len(refNames) {
						return []map[string]expressionChannelReference{current}
					}

					refName := refNames[refIdx]
					refs := channelRefsByName[refName]
					var result []map[string]expressionChannelReference

					// For each possible channel for this reference, create a new combination
					for i := range refs {
						// Create a new copy of the current map
						newCurrent := make(map[string]expressionChannelReference)
						for k, v := range current {
							newCurrent[k] = v
						}
						// Add the current reference to the map
						newCurrent[refName] = refs[i]
						// Recursively generate combinations for the next reference
						result = append(result, generateHelper(refIdx+1, newCurrent)...)
					}

					return result
				}

				// Start the recursive generation with an empty map
				return generateHelper(0, make(map[string]expressionChannelReference))
			}

			combinations := generateCombinations(channelRefsByName)

			if len(combinations) == 0 {
				log.DefaultLogger.Warn("No valid combinations found for calculated channel",
					"assetId", assetId, "calculatedChannel", calcChannelQuery.Name)
				continue
			}

			// For each combination, create a calculated channel query
			for _, combination := range combinations {
				// Create expression channel references
				var expressionChannelRefs []expressionChannelReference

				for _, chanRef := range calcChannelQuery.ChannelReferences {
					refName := chanRef.ChannelReference
					channelRef := combination[refName]
					expressionChannelRefs = append(expressionChannelRefs, channelRef)
				}

				// Create a unique channel key
				channelKey := fmt.Sprintf("%s-%s-%s", assetId, calcChannelQuery.Name, uuid.NewString()[:8])
				calculatedChannelKeys[channelKey] = calculatedChannelKey{
					channelName:       calcChannelQuery.Name,
					channelReferences: expressionChannelRefs,
				}

				expressionChannelReferencesRequest := []siftApiExpressionChannelReference{}
				for _, chanRef := range calcChannelQuery.ChannelReferences {
					refName := chanRef.ChannelReference
					expressionChannelReferencesRequest = append(expressionChannelReferencesRequest, siftApiExpressionChannelReference{
						ChannelReference: refName,
						ChannelId:        combination[refName].ChannelId,
					})
				}

				// For each run ID (or without run ID if empty)
				if len(runIds) > 0 {
					for _, runId := range runIds {
						calculatedChannel := &siftApiCalculatedChannel{
							ChannelKey: calcChannelQuery.Name,
							ExpressionRequest: siftApiExpressionRequest{
								Expression:                  calcChannelQuery.Expression,
								ExpressionChannelReferences: expressionChannelReferencesRequest,
							},
							RunId:          &runId,
							CombineRunData: fqm.CombineRuns,
						}

						queries = append(queries, siftApiGetDataSubQuery{
							CalculatedChannel: calculatedChannel,
						})
					}
				} else {
					// No run IDs, create a query without run ID
					calculatedChannel := &siftApiCalculatedChannel{
						ChannelKey: channelKey,
						ExpressionRequest: siftApiExpressionRequest{
							Expression:                  calcChannelQuery.Expression,
							ExpressionChannelReferences: expressionChannelReferencesRequest,
						},
						CombineRunData: fqm.CombineRuns,
					}

					queries = append(queries, siftApiGetDataSubQuery{
						CalculatedChannel: calculatedChannel,
					})
				}
			}
		}
	}

	return queries, calculatedChannelKeys, nil
}

func parallelSearchChannels(
	d *SiftDatasource,
	pCtx backend.PluginContext,
	channelSearchKeys []channelSearchKey,
	maxParallel int,
	cacheWithLoader *TypedCacheWithLoader[channelSearchKey, []Channel, string],
) (map[channelSearchKey][]Channel, error) {
	g, _ := errgroup.WithContext(context.Background())
	sem := make(chan struct{}, maxParallel)
	results := make(map[channelSearchKey][]Channel)
	mu := sync.Mutex{}

	for _, key := range channelSearchKeys {
		key := key
		g.Go(func() error {
			sem <- struct{}{}
			defer func() { <-sem }()
			result, err := cacheWithLoader.GetOrWait(d, pCtx, key)
			if err != nil {
				return err
			}

			mu.Lock()
			results[key] = result
			mu.Unlock()

			return nil
		})
	}

	if err := g.Wait(); err != nil {
		return nil, err
	}

	return results, nil
}
