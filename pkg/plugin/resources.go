package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

// Limit number of results that can be returned from the Sift API

const ResourceLimit = 200

// callResourceAssets calls the Sift Assets API and is intended to be used by the Grafana datasource frontend directly.
func (d *SiftDatasource) callResourceAssets(ctx context.Context, req *backend.CallResourceRequest, sender backend.CallResourceResponseSender) error {
	_, reqParams, _ := strings.Cut(req.URL, "?")
	v, err := url.ParseQuery(reqParams)
	if err != nil {
		return err
	}

	params := v // copy query params then overwrite any defaults
	if params.Get("limit") != "" {
		params.Set("paginationSearchParams.limit", params.Get("limit"))
	} else {
		params.Set("paginationSearchParams.limit", strconv.Itoa(ResourceLimit))
	}

	assets, err := handlePaginatedRequest[Asset](d, apiRequest{
		pCtx:        req.PluginContext,
		method:      "GET",
		path:        "/api/v1/assets",
		queryParams: params,
	}, ResourceLimit, 1, func(respBody []byte) ([]Asset, string, error) {
		response := listAssetsQueryResponse{}
		err := json.Unmarshal(respBody, &response)
		if err != nil {
			return nil, "", fmt.Errorf("json unmarshal: %w", err)
		}
		return response.Assets, response.NextPageToken, nil
	})
	if err != nil {
		return err
	}

	respBody, err := json.Marshal(map[string]any{"assets": assets})
	if err != nil {
		return err
	}

	return sender.Send(&backend.CallResourceResponse{
		Status: http.StatusOK,
		Body:   respBody,
	})
}

// callResourceRuns calls the Sift Assets API and is intended to be used by the Grafana datasource frontend directly.
func (d *SiftDatasource) callResourceRuns(ctx context.Context, req *backend.CallResourceRequest, sender backend.CallResourceResponseSender) error {
	_, reqParams, _ := strings.Cut(req.URL, "?")
	params, err := url.ParseQuery(reqParams)
	if err != nil {
		return err
	}

	runs, err := handlePaginatedRequest[Run](d, apiRequest{
		pCtx:        req.PluginContext,
		method:      "GET",
		path:        "/api/v2/runs",
		queryParams: params,
	}, ResourceLimit, 1, func(respBody []byte) ([]Run, string, error) {
		response := listRunsQueryResponse{}
		err := json.Unmarshal(respBody, &response)
		if err != nil {
			return nil, "", fmt.Errorf("json unmarshal: %w", err)
		}
		return response.Runs, response.NextPageToken, nil
	})
	if err != nil {
		return err
	}

	respBody, err := json.Marshal(map[string]any{"runs": runs})
	if err != nil {
		return err
	}

	return sender.Send(&backend.CallResourceResponse{
		Status: http.StatusOK,
		Body:   respBody,
	})
}

// callResourceChannels calls the Sift Assets API and is intended to be used by the Grafana datasource frontend directly.
func (d *SiftDatasource) callResourceChannels(ctx context.Context, req *backend.CallResourceRequest, sender backend.CallResourceResponseSender) error {
	_, reqParams, _ := strings.Cut(req.URL, "?")
	v, err := url.ParseQuery(reqParams)
	if err != nil {
		return err
	}

	params := v // copy query params then overwrite any defaults
	if params.Get("channelNames") != "" {
		channelNames := strings.Split(params.Get("channelNames"), ",")
		// Get channel names as regex group alternatives
		escapedNames := make([]string, len(channelNames))
		for i, name := range channelNames {
			escapedNames[i] = "(" + regexp.QuoteMeta(name) + ")"
		}
		regexQuery := strings.Join(escapedNames, "|")
		log.DefaultLogger.Debug("regex query", "regexQuery", regexQuery)
		params.Set("searchTerm", regexQuery)
		params.Del("channelNames")
	}

	params.Set("page_size", strconv.Itoa(ResourceLimit))

	channels, err := handlePaginatedRequest[Channel](d, apiRequest{
		pCtx:        req.PluginContext,
		method:      "GET",
		path:        "/api/v1/channels:search", // internal API endpoint used here for improved regex search performance
		queryParams: params,
	}, ResourceLimit, 1, func(respBody []byte) ([]Channel, string, error) {
		response := listChannelsQueryResponse{}
		err := json.Unmarshal(respBody, &response)
		if err != nil {
			return nil, "", fmt.Errorf("json unmarshal: %w", err)
		}
		return response.Channels, response.NextPageToken, nil
	})
	if err != nil {
		return err
	}

	respBody, err := json.Marshal(map[string]any{"channels": channels})
	if err != nil {
		return err
	}

	return sender.Send(&backend.CallResourceResponse{
		Status: http.StatusOK,
		Body:   respBody,
	})
}

// callPurgeCache purges the cache of the SiftDatasource. Useful for when a Run/Asset/Channel is recently added in Sift
// but is not showing up from a query.
func (d *SiftDatasource) callPurgeCache(ctx context.Context, req *backend.CallResourceRequest, sender backend.CallResourceResponseSender) error {
	d.assetsIdSearchCache.Flush()
	d.assetsNameSearchCache.Flush()
	d.assetsRegexSearchCache.Flush()
	d.runsIdSearchCache.Flush()
	d.runsNameSearchCache.Flush()
	d.runsRegexSearchCache.Flush()
	d.channelsIdSearchCache.Flush()
	d.channelsNameSearchCache.Flush()
	d.channelsRegexSearchCache.Flush()

	return sender.Send(&backend.CallResourceResponse{
		Status: http.StatusOK,
		Body:   []byte("{}"),
	})
}

type calculatedChannelAggregate struct {
	Name               string
	Expression         string
	ExpressionDataType string
	SourceChannels     []string
	placeholderIndex   map[string]int
}

type calculatedChannelMetadata struct {
	Name               string   `json:"name"`
	SourceChannels     []string `json:"sourceChannels"`
	Expression         string   `json:"expression"`
	ExpressionDataType string   `json:"expressionDataType"`
}

func collectCalculatedAggregates(queries []channelDataQuery) (map[string]*calculatedChannelAggregate, []string) {
	aggregates := make(map[string]*calculatedChannelAggregate)
	order := make([]string, 0)

	for _, cdq := range queries {
		for _, calcQuery := range cdq.CalculatedChannelQueries {
			addCalculatedQuery(aggregates, &order, calcQuery)
		}
	}

	return aggregates, order
}

func addCalculatedQuery(aggregates map[string]*calculatedChannelAggregate, order *[]string, calcQuery calculatedChannelQuery) {
	trimmedName := strings.TrimSpace(calcQuery.Name)
	if trimmedName == "" {
		return
	}

	key := calcQuery.Name
	agg, exists := aggregates[key]
	if !exists {
		agg = &calculatedChannelAggregate{
			Name:               trimmedName,
			ExpressionDataType: "double",
			placeholderIndex:   make(map[string]int),
		}
		aggregates[key] = agg
		*order = append(*order, key)
	}

	agg.mergeExpression(calcQuery.Expression)
	agg.mergeReferenceQueries(calcQuery.ChannelReferences)
}

func (a *calculatedChannelAggregate) mergeExpression(expression string) {
	if trimmed := strings.TrimSpace(expression); trimmed != "" {
		a.Expression = trimmed
	}
}

func (a *calculatedChannelAggregate) mergeReferenceQueries(refs []channelReferenceQuery) {
	if len(refs) != len(a.SourceChannels) {
		newSource := make([]string, len(refs))
		newIndex := make(map[string]int, len(refs))
		for idx, ref := range refs {
			newIndex[ref.ChannelReference] = idx
			if existingIdx, ok := a.placeholderIndex[ref.ChannelReference]; ok && existingIdx < len(a.SourceChannels) {
				newSource[idx] = a.SourceChannels[existingIdx]
			}
			if ref.ChannelId != "" {
				newSource[idx] = ref.ChannelId
			}
		}
		a.SourceChannels = newSource
		a.placeholderIndex = newIndex
		return
	}

	for idx, ref := range refs {
		a.placeholderIndex[ref.ChannelReference] = idx
		if ref.ChannelId != "" && a.SourceChannels[idx] == "" {
			a.SourceChannels[idx] = ref.ChannelId
		}
	}
}

func (a *calculatedChannelAggregate) fillMissingSources(refs []expressionChannelReference) {
	for _, ref := range refs {
		if pos, ok := a.placeholderIndex[ref.ChannelReference]; ok {
			if pos < len(a.SourceChannels) && a.SourceChannels[pos] == "" {
				a.SourceChannels[pos] = ref.ChannelId
			}
		}
	}
}

func (a *calculatedChannelAggregate) metadataIfComplete() (calculatedChannelMetadata, bool) {
	sources := make([]string, len(a.SourceChannels))
	copy(sources, a.SourceChannels)
	for _, channelID := range sources {
		if strings.TrimSpace(channelID) == "" {
			return calculatedChannelMetadata{}, false
		}
	}

	return calculatedChannelMetadata{
		Name:               a.Name,
		SourceChannels:     sources,
		Expression:         a.Expression,
		ExpressionDataType: a.ExpressionDataType,
	}, true
}

func (d *SiftDatasource) resolveQueryToSiftMetadata(ctx context.Context, req *backend.CallResourceRequest, sender backend.CallResourceResponseSender) error {
	log.DefaultLogger.Debug("resolveQueryToSiftMetadata request", "body", string(req.Body))

	queryModel, err := convertQueryIfNeeded(json.RawMessage(req.Body))
	if err != nil {
		log.DefaultLogger.Error("resolveQueryToSiftMetadata convert error", "error", err)
		return sender.Send(&backend.CallResourceResponse{
			Status: http.StatusBadRequest,
			Body:   []byte(fmt.Sprintf("parse query: %s", err)),
		})
	}

	metadataInput := *queryModel
	metadata, err := generateQueryMetadata(req.PluginContext, metadataInput, d)
	if err != nil {
		log.DefaultLogger.Error("resolveQueryToSiftMetadata metadata error", "error", err)
		return sender.Send(&backend.CallResourceResponse{
			Status: http.StatusBadRequest,
			Body:   []byte(fmt.Sprintf("generate metadata: %s", err)),
		})
	}

	log.DefaultLogger.Debug(
		"resolveQueryToSiftMetadata summary",
		"assetIds", metadata.AssetIds,
		"runIds", metadata.RunIds,
		"channelIds", metadata.ChannelIds,
	)

	calculatedAggregates, calculatedOrder := collectCalculatedAggregates(queryModel.ChannelDataQueries)
	calculatedChannels := make([]calculatedChannelMetadata, 0, len(calculatedAggregates))

	if len(calculatedAggregates) > 0 {
		if _, calculatedKeys, err := generateQueries(req.PluginContext, metadataInput, d); err != nil {
			log.DefaultLogger.Error("resolveQueryToSiftMetadata calculated channel lookup error", "error", err)
		} else {
			for _, key := range calculatedKeys {
				if aggregate, ok := calculatedAggregates[key.channelName]; ok && aggregate != nil {
					aggregate.fillMissingSources(key.channelReferences)
				}
			}
		}

		for _, name := range calculatedOrder {
			aggregate := calculatedAggregates[name]
			if aggregate == nil {
				continue
			}
			if metadata, ok := aggregate.metadataIfComplete(); ok {
				calculatedChannels = append(calculatedChannels, metadata)
			}
		}
	}

	responsePayload := struct {
		AssetIDs           []string                    `json:"assetIds"`
		RunIDs             []string                    `json:"runIds"`
		ChannelIDs         []string                    `json:"channelIds"`
		CalculatedChannels []calculatedChannelMetadata `json:"calculatedChannels,omitempty"`
	}{
		AssetIDs:   metadata.AssetIds,
		RunIDs:     metadata.RunIds,
		ChannelIDs: metadata.ChannelIds,
	}

	if len(calculatedChannels) > 0 {
		responsePayload.CalculatedChannels = calculatedChannels
	}

	body, err := json.Marshal(responsePayload)
	if err != nil {
		return sender.Send(&backend.CallResourceResponse{
			Status: http.StatusInternalServerError,
			Body:   []byte(fmt.Sprintf("encode response: %s", err)),
		})
	}

	return sender.Send(&backend.CallResourceResponse{
		Status: http.StatusOK,
		Body:   body,
	})
}
