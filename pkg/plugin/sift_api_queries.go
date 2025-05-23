package plugin

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/sift/grafana-datasource/pkg/plugin/celUtils"
)

const MaxQueryPageSize = 1_000
const MaxQueryPages = 1

// TODO: implement limits at some point, potentially user configurable

const MaxAssetRegexMatches = MaxQueryPageSize   //20
const MaxChannelRegexMatches = MaxQueryPageSize //50

type Asset struct {
	AssetId string `json:"assetId"`
	Name    string `json:"name"`
}
type listAssetsQueryResponse struct {
	Assets        []Asset `json:"assets"`
	NextPageToken string  `json:"nextPageToken"`
}
type Run struct {
	RunId     string `json:"runId"`
	Name      string `json:"name"`
	ClientKey string `json:"clientKey"`
	StartTime string `json:"startTime"`
	StopTime  string `json:"stopTime"`
}

type listRunsQueryResponse struct {
	Runs          []Run  `json:"runs"`
	NextPageToken string `json:"nextPageToken"`
}

type Channel struct {
	ChannelId   string `json:"channelId"`
	Name        string `json:"name"`
	AssetId     string `json:"assetId"`
	AssetName   string `json:"assetName"`
	Description string `json:"description"`
	Unit        string `json:"unit"`
	DataType    string `json:"dataType"`
}

type listChannelsQueryResponse struct {
	Channels      []Channel `json:"channels"`
	NextPageToken string    `json:"nextPageToken"`
}

type apiRequest struct {
	pCtx        backend.PluginContext
	method      string
	path        string
	queryParams url.Values
	body        interface{}
}

type siftApiChannel struct {
	ChannelId string  `json:"channelId"`
	RunId     *string `json:"runId,omitempty"`
}

type siftApiExpressionChannelReference struct {
	ChannelReference string `json:"channelReference"`
	ChannelId        string `json:"channelId"`
}

type siftApiExpressionRequest struct {
	Expression                  string                              `json:"expression"`
	ExpressionChannelReferences []siftApiExpressionChannelReference `json:"expressionChannelReferences"`
}

type siftApiCalculatedChannel struct {
	ChannelKey        string                   `json:"channelKey"`
	ExpressionRequest siftApiExpressionRequest `json:"expression"`
	RunId             *string                  `json:"runId,omitempty"`
	CombineRunData    bool                     `json:"combineRunData"`
}

type siftApiGetDataSubQuery struct {
	Channel           *siftApiChannel           `json:"channel,omitempty"`
	CalculatedChannel *siftApiCalculatedChannel `json:"calculatedChannel,omitempty"`
}

type siftApiGetDataQuery struct {
	Queries   []siftApiGetDataSubQuery `json:"queries"`
	StartTime string                   `json:"startTime"`
	EndTime   string                   `json:"endTime"`
	SampleMs  int64                    `json:"sampleMs"`
	PageSize  int                      `json:"pageSize"`
	PageToken *string                  `json:"pageToken,omitempty"`
}

func executeRequest(req apiRequest) ([]byte, error) {
	apiKey := req.pCtx.DataSourceInstanceSettings.DecryptedSecureJSONData["apiKey"]

	u, err := getApiUrl(req.pCtx.DataSourceInstanceSettings)
	if err != nil {
		return nil, fmt.Errorf("error getting api url: %w", err)
	}
	u.Path = req.path

	if req.queryParams != nil {
		u.RawQuery = req.queryParams.Encode()
	}

	var bodyReader io.Reader
	if req.body != nil {
		bodyBytes, err := json.Marshal(req.body)
		if err != nil {
			return nil, fmt.Errorf("json marshal: %w", err)
		}
		bodyReader = bytes.NewReader(bodyBytes)
	}

	httpReq, err := http.NewRequest(req.method, u.String(), bodyReader)
	if err != nil {
		return nil, fmt.Errorf("error creating request: %w", err)
	}

	httpReq.Header.Set("Authorization", "Bearer "+apiKey)
	httpReq.Header.Set("User-Agent", fmt.Sprintf("sift-grafana-datasource/%s %s", req.pCtx.PluginVersion, req.pCtx.UserAgent.String()))

	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("error querying backend: %w", err)
	}
	defer func(Body io.ReadCloser) {
		err := Body.Close()
		if err != nil {
			log.DefaultLogger.Error("error closing response body", "error", err)
		}
	}(resp.Body)

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("error reading response: %w", err)
	}

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("API error (status %d): %s", resp.StatusCode, string(respBody))
	}

	return respBody, nil
}

func handleRequest[T any](
	req apiRequest,
	unmarshal func(respBody []byte) (items []T, nextPageToken string, err error),
) (items []T, nextPageToken string, err error) {
	respBody, err := executeRequest(req)
	if err != nil {
		return nil, "", err
	}

	// Use the passed-in unmarshal function to decode the response
	items, nextPageToken, err = unmarshal(respBody)
	if err != nil {
		return nil, "", err
	}
	return items, nextPageToken, nil
}

func handlePaginatedRequest[T any](
	req apiRequest,
	pageSize int,
	maxPages int,
	unmarshal func(respBody []byte) (items []T, nextPageToken string, err error),
) ([]T, error) {

	var results []T
	params := req.queryParams
	params.Set("page_size", strconv.Itoa(pageSize))

	for i := 0; i < maxPages; i++ {
		items, nextPageToken, err := handleRequest[T](req, unmarshal)
		if err != nil {
			return nil, err
		}

		results = append(results, items...)

		// If there's no next page nextPageToken, break out of the loop.
		if nextPageToken == "" {
			break
		}
		params.Set("page_token", nextPageToken)
	}

	return results, nil
}
func (d *SiftDatasource) getData(pCtx backend.PluginContext, subQueries []siftApiGetDataSubQuery, query backend.DataQuery) ([]queryResponseData, error) {
	backendQuery := siftApiGetDataQuery{
		Queries:   subQueries,
		StartTime: query.TimeRange.From.Format(time.RFC3339Nano),
		EndTime:   query.TimeRange.To.Format(time.RFC3339Nano),
		SampleMs:  query.TimeRange.To.Sub(query.TimeRange.From).Milliseconds() / int64(query.MaxDataPoints),
		PageSize:  10_000,
	}

	var responseData []queryResponseData
	for {
		req := apiRequest{
			pCtx:   pCtx,
			method: "POST",
			path:   "/api/v2/data",
			body:   backendQuery,
		}

		respBody, err := executeRequest(req)
		if err != nil {
			return nil, err
		}

		response := queryResponse{}
		err = json.Unmarshal(respBody, &response)
		if err != nil {
			return nil, fmt.Errorf("json unmarshal: %w - `%s`", err, string(respBody))
		}

		if response.ErrorMessage != "" {
			return nil, fmt.Errorf(response.ErrorMessage)
		}

		responseData = append(responseData, response.Data...)
		if response.NextPageToken == "" {
			break
		}
		backendQuery.PageToken = &response.NextPageToken
	}
	return responseData, nil
}

func (d *SiftDatasource) getValidAssetsById(pCtx backend.PluginContext, assetIds []string) ([]string, error) {
	// TODO: client key support once backend supports it
	startTime := time.Now()

	cachedAssetIds := []string{}
	assetIdsToSearch := []string{}

	for _, assetId := range assetIds {
		cachedAssetId, found := d.assetsIdSearchCache.Get(assetId)
		if found {
			cachedAssetIds = append(cachedAssetIds, cachedAssetId)
		} else {
			assetIdsToSearch = append(assetIdsToSearch, assetId)
		}
	}

	if len(cachedAssetIds) == len(assetIds) {
		return assetIds, nil
	}

	params := url.Values{}
	assetFilter := celUtils.In("asset_id", assetIdsToSearch)
	params.Set("filter", assetFilter)

	assets, err := handlePaginatedRequest[Asset](apiRequest{
		pCtx:        pCtx,
		method:      "GET",
		path:        "/api/v1/assets",
		queryParams: params,
	}, MaxQueryPageSize, MaxQueryPages, func(respBody []byte) ([]Asset, string, error) {
		response := listAssetsQueryResponse{}
		err := json.Unmarshal(respBody, &response)
		if err != nil {
			return nil, "", fmt.Errorf("json unmarshal: %w", err)
		}
		return response.Assets, response.NextPageToken, nil
	})
	if err != nil {
		return nil, err
	}

	// TODO: handle errors more gracefully and log them to show to user without failing entire query
	if len(assets) == 0 {
		return nil, fmt.Errorf("no assets found with ids: %v", assetIdsToSearch)
	}

	validAssetIds := []string{}
	for _, a := range assets {
		validAssetIds = append(validAssetIds, a.AssetId)
		d.assetsIdSearchCache.Add(a.AssetId, a.AssetId)
	}

	validAssetIds = append(validAssetIds, cachedAssetIds...)

	log.DefaultLogger.Info("getValidAssetsById", "duration", time.Since(startTime).Milliseconds(), "validAssetIds", validAssetIds)
	return validAssetIds, nil
}

func (d *SiftDatasource) getAssetIdsByName(pCtx backend.PluginContext, assetName string, asRegex bool) ([]string, error) {
	startTime := time.Now()

	if asRegex {
		cachedAssetIds, found := d.assetsRegexSearchCache.Get(assetName)
		if found {
			return cachedAssetIds, nil
		}
	} else {
		cachedAssetId, found := d.assetsNameSearchCache.Get(assetName)
		if found {
			return []string{cachedAssetId}, nil
		}
	}

	params := url.Values{}
	var assetFilter string
	if asRegex {
		assetFilter = celUtils.MatchRegex("name", assetName)
	} else {
		assetFilter = celUtils.Equals("name", assetName)
	}
	params.Set("filter", assetFilter)

	assets, err := handlePaginatedRequest[Asset](apiRequest{
		pCtx:        pCtx,
		method:      "GET",
		path:        "/api/v1/assets",
		queryParams: params,
	}, MaxQueryPageSize, MaxQueryPages, func(respBody []byte) ([]Asset, string, error) {
		response := listAssetsQueryResponse{}
		err := json.Unmarshal(respBody, &response)
		if err != nil {
			return nil, "", fmt.Errorf("json unmarshal: %w", err)
		}
		return response.Assets, response.NextPageToken, nil
	})
	if err != nil {
		return nil, err
	}

	if len(assets) == 0 {
		return nil, fmt.Errorf("no assets found with name: %s", assetName)
	}

	if len(assets) > MaxAssetRegexMatches && asRegex {
		return nil, fmt.Errorf("asset regex `%s` matches too many assets (>%d). Increase regex specificity or use a different selection type", assetName, MaxAssetRegexMatches)
	}

	assetIds := []string{}
	for _, a := range assets {
		assetIds = append(assetIds, a.AssetId)
	}

	if asRegex {
		d.assetsRegexSearchCache.Add(assetName, assetIds)
	} else if len(assetIds) > 0 {
		d.assetsNameSearchCache.Add(assetName, assetIds[0])
	}

	log.DefaultLogger.Info("getAssetIdsByName", "duration", time.Since(startTime).Milliseconds(), "search", assetName, "asRegex", asRegex, "assetIds", assetIds)
	return assetIds, nil
}

func (d *SiftDatasource) getValidRunsById(pCtx backend.PluginContext, runIdOrClientKeys []string) ([]string, error) {
	startTime := time.Now()

	cachedRunIds := []string{}
	runIdOrClientKeysToSearch := []string{}

	for _, runIdOrClientKey := range runIdOrClientKeys {
		cachedRunId, found := d.runsIdSearchCache.Get(runIdOrClientKey)
		if found {
			cachedRunIds = append(cachedRunIds, cachedRunId)
		} else {
			runIdOrClientKeysToSearch = append(runIdOrClientKeysToSearch, runIdOrClientKey)
		}
	}

	if len(cachedRunIds) == len(runIdOrClientKeys) {
		return cachedRunIds, nil
	}

	params := url.Values{}
	runFilter := celUtils.Or(celUtils.In("client_key", runIdOrClientKeysToSearch), celUtils.In("run_id", runIdOrClientKeysToSearch))
	params.Set("filter", runFilter)

	runs, err := handlePaginatedRequest[Run](apiRequest{
		pCtx:        pCtx,
		method:      "GET",
		path:        "/api/v2/runs",
		queryParams: params,
	}, MaxQueryPageSize, MaxQueryPages, func(respBody []byte) ([]Run, string, error) {
		response := listRunsQueryResponse{}
		err := json.Unmarshal(respBody, &response)
		if err != nil {
			return nil, "", fmt.Errorf("json unmarshal: %w", err)
		}
		return response.Runs, response.NextPageToken, nil
	})
	if err != nil {
		return nil, err
	}

	if len(runs) == 0 {
		return nil, fmt.Errorf("no runs found with ids: %v", runIdOrClientKeysToSearch)
	}

	validRunIds := []string{}
	for _, r := range runs {
		validRunIds = append(validRunIds, r.RunId)
		d.runsIdSearchCache.Add(r.RunId, r.RunId)
	}

	validRunIds = append(validRunIds, cachedRunIds...)

	log.DefaultLogger.Info("getValidRunsById", "duration", time.Since(startTime).Milliseconds(), "validRunIds", validRunIds)
	return validRunIds, nil
}

func (d *SiftDatasource) getRunIdsByName(pCtx backend.PluginContext, assetIds []string, runName string, asRegex bool) ([]string, error) {
	startTime := time.Now()

	if asRegex {
		cachedRunIds, found := d.runsRegexSearchCache.Get(runName)
		if found {
			return cachedRunIds, nil
		}
	} else {
		cachedRunIds, found := d.runsNameSearchCache.Get(runName)
		if found {
			return cachedRunIds, nil
		}
	}

	params := url.Values{}
	var runFilter string
	if asRegex {
		runFilter = celUtils.And(celUtils.In("asset_id", assetIds), celUtils.MatchRegex("name", runName))
	} else {
		runFilter = celUtils.And(celUtils.In("asset_id", assetIds), celUtils.Equals("name", runName))
	}
	params.Set("filter", runFilter)

	runs, err := handlePaginatedRequest[Run](apiRequest{
		pCtx:        pCtx,
		method:      "GET",
		path:        "/api/v2/runs",
		queryParams: params,
	}, MaxQueryPageSize, MaxQueryPages, func(respBody []byte) ([]Run, string, error) {
		response := listRunsQueryResponse{}
		err := json.Unmarshal(respBody, &response)
		if err != nil {
			return nil, "", fmt.Errorf("json unmarshal: %w", err)
		}
		return response.Runs, response.NextPageToken, nil
	})
	if err != nil {
		return nil, err
	}

	if len(runs) == 0 {
		return nil, fmt.Errorf("no runs found with name: %s for assets: %v", runName, assetIds)
	}

	runIds := []string{}
	for _, r := range runs {
		runIds = append(runIds, r.RunId)
	}

	if asRegex {
		d.runsRegexSearchCache.Add(runName, runIds)
	} else {
		d.runsNameSearchCache.Add(runName, runIds)
	}

	log.DefaultLogger.Info("getRunIdsByName", "duration", time.Since(startTime).Milliseconds(), "assetIds", assetIds, "search", runName, "asRegex", asRegex, "runIds", runIds)
	return runIds, nil
}

func (d *SiftDatasource) getChannelsById(pCtx backend.PluginContext, channelIds []string) ([]Channel, error) {
	startTime := time.Now()

	cachedChannels := []Channel{}
	channelIdsToSearch := []string{}

	for _, channelId := range channelIds {
		cachedChannel, found := d.channelsIdSearchCache.Get(channelId)
		if found {
			cachedChannels = append(cachedChannels, cachedChannel)
		} else {
			channelIdsToSearch = append(channelIdsToSearch, channelId)
		}
	}

	if len(cachedChannels) == len(channelIds) {
		return cachedChannels, nil
	}

	params := url.Values{}
	channelFilter := celUtils.In("channel_id", channelIdsToSearch)
	params.Set("filter", channelFilter)

	channels, err := handlePaginatedRequest[Channel](apiRequest{
		pCtx:        pCtx,
		method:      "GET",
		path:        "/api/v3/channels",
		queryParams: params,
	}, MaxQueryPageSize, MaxQueryPages, func(respBody []byte) ([]Channel, string, error) {
		response := listChannelsQueryResponse{}
		err := json.Unmarshal(respBody, &response)
		if err != nil {
			return nil, "", fmt.Errorf("json unmarshal: %w", err)
		}
		return response.Channels, response.NextPageToken, nil
	})
	if err != nil {
		return nil, err
	}

	if len(channels) == 0 {
		return nil, fmt.Errorf("no channels found with ids: %v", channelIdsToSearch)
	}

	for _, channel := range channels {
		d.channelsIdSearchCache.Add(channel.ChannelId, channel)
	}

	channels = append(channels, cachedChannels...)

	log.DefaultLogger.Info("getChannelsById", "duration", time.Since(startTime).Milliseconds(), "channelIds", channelIds)
	return channels, nil
}

func (d *SiftDatasource) getChannelsByName(pCtx backend.PluginContext, assetId string, channelName string, asRegex bool) ([]Channel, error) {
	startTime := time.Now()

	cacheKey := channelCacheKey{
		assetId: assetId,
		search:  channelName,
	}

	if asRegex {
		cachedChannels, found := d.channelsRegexSearchCache.Get(cacheKey)
		if found {
			return cachedChannels, nil
		}
	} else {
		cachedChannels, found := d.channelsNameSearchCache.Get(cacheKey)
		if found {
			return cachedChannels, nil
		}
	}

	params := url.Values{}
	params.Set("isSearchCaseSensitive", "true")
	if asRegex {
		params.Set("isSearchRegexp", "true")
	}
	params.Set("assetIds", assetId)
	params.Set("searchTerm", channelName)

	channels, err := handlePaginatedRequest[Channel](apiRequest{
		pCtx:        pCtx,
		method:      "GET",
		path:        "/api/v1/channels:search", // internal API endpoint used here for improved regex search performance
		queryParams: params,
	}, MaxQueryPageSize, MaxQueryPages, func(respBody []byte) ([]Channel, string, error) {
		response := listChannelsQueryResponse{}
		err := json.Unmarshal(respBody, &response)
		if err != nil {
			return nil, "", fmt.Errorf("json unmarshal: %w", err)
		}
		return response.Channels, response.NextPageToken, nil
	})
	if err != nil {
		return nil, err
	}

	if len(channels) > MaxChannelRegexMatches && asRegex {
		return nil, fmt.Errorf("channel regex `%s` matches too many channels (>%d). Increase regex specificity or use a different selection type", channelName, MaxChannelRegexMatches)
	}

	if asRegex {
		d.channelsRegexSearchCache.Add(cacheKey, channels)
	} else {
		d.channelsNameSearchCache.Add(cacheKey, channels)
	}

	log.DefaultLogger.Info("getChannelsByName", "duration", time.Since(startTime).Milliseconds(), "search", channelName, "assetId", assetId, "asRegex", asRegex, "noOfChannels", len(channels))
	return channels, nil
}

// getChannelsAndSameNameChannelsById first finds channels by ID and then searches for channels with the same name
// This is intended to handle the case in the frontend selection where there are multiple channels with the same name.
// The frontend dedupes on name to make selection more clear, so this undoes that
func (d *SiftDatasource) getChannelsAndSameNameChannelsById(pCtx backend.PluginContext, channelIds []string) ([]Channel, error) {
	startTime := time.Now()

	channels, err := d.getChannelsById(pCtx, channelIds)
	if err != nil {
		return nil, err
	}

	searchKeys := make([]channelSearchKey, len(channels))
	for i, channel := range channels {
		searchKeys[i] = channelSearchKey{
			assetId:    channel.AssetId,
			searchTerm: fmt.Sprintf("^%s$", regexp.QuoteMeta(channel.Name)), // Exact regex match
		}
	}

	results, err := parallelSearchChannels(pCtx, searchKeys, true, 10, d.getChannelsByName)
	if err != nil {
		return nil, err
	}
	allChannels := []Channel{}
	for _, resultChannels := range results {
		allChannels = append(allChannels, resultChannels...)
	}

	log.DefaultLogger.Info("getChannelsAndSameNameChannelsById", "duration", time.Since(startTime).Milliseconds(), "noOfChannels", len(allChannels))

	return allChannels, nil
}
