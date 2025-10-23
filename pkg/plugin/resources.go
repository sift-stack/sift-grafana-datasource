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
	hasCalculatedChannels := false
	for _, cdq := range queryModel.ChannelDataQueries {
		if len(cdq.CalculatedChannelQueries) > 0 {
			hasCalculatedChannels = true
			break
		}
	}

	if hasCalculatedChannels {
		sanitizedModel := *queryModel
		sanitizedModel.ChannelDataQueries = make([]channelDataQuery, len(queryModel.ChannelDataQueries))
		for i, cdq := range queryModel.ChannelDataQueries {
			sanitizedCDQ := cdq
			sanitizedCDQ.CalculatedChannelQueries = nil
			sanitizedModel.ChannelDataQueries[i] = sanitizedCDQ
		}
		metadataInput = sanitizedModel
	}

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
		"assetIds", metadata.AssetIDs,
		"runIds", metadata.RunIDs,
		"channelIds", metadata.ChannelIDs,
	)

	calculatedExpressions := make([]string, 0)
	for _, cdq := range queryModel.ChannelDataQueries {
		for _, calcQuery := range cdq.CalculatedChannelQueries {
			expression := strings.TrimSpace(calcQuery.Expression)
			if expression != "" {
				calculatedExpressions = append(calculatedExpressions, expression)
			}
		}
	}

	responsePayload := struct {
		AssetIDs              []string `json:"assetIds"`
		RunIDs                []string `json:"runIds"`
		ChannelIDs            []string `json:"channelIds"`
		CalculatedExpressions []string `json:"calculatedChannelExpressions,omitempty"`
	}{
		AssetIDs:   metadata.AssetIDs,
		RunIDs:     metadata.RunIDs,
		ChannelIDs: metadata.ChannelIDs,
	}

	if len(calculatedExpressions) > 0 {
		responsePayload.CalculatedExpressions = calculatedExpressions
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
