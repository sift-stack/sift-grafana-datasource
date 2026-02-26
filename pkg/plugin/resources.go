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

	params := v
	limit := ResourceLimit
	if params.Get("limit") != "" {
		if parsedLimit, err := strconv.Atoi(params.Get("limit")); err == nil && parsedLimit > 0 {
			limit = parsedLimit
		}
	}

	assets, err := handlePaginatedRequest[Asset](ctx, d, apiRequest{
		pCtx:        req.PluginContext,
		method:      "GET",
		path:        "/api/v1/assets",
		queryParams: params,
	}, limit, 1, func(respBody []byte) ([]Asset, string, error) {
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

	runs, err := handlePaginatedRequest[Run](ctx, d, apiRequest{
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

	channels, err := handlePaginatedRequest[Channel](ctx, d, apiRequest{
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

type calculatedChannelMetadata struct {
	Name               string   `json:"name"`
	SourceChannels     []string `json:"sourceChannels"`
	Expression         string   `json:"expression"`
	ExpressionDataType string   `json:"expressionDataType"`
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

	queries, calculatedKeys, err := generateQueries(ctx, req.PluginContext, *queryModel, d)
	if err != nil {
		log.DefaultLogger.Error("resolveQueryToSiftMetadata generateQueries error", "error", err)
		return sender.Send(&backend.CallResourceResponse{
			Status: http.StatusBadRequest,
			Body:   []byte(fmt.Sprintf("generate queries: %s", err)),
		})
	}

	assetIDSet := make(map[string]struct{})
	runIDSet := make(map[string]struct{})
	channelIDSet := make(map[string]struct{})
	order := make([]string, 0, len(calculatedKeys))
	metaByName := make(map[string]*calculatedChannelMetadata)

	for _, subQuery := range queries {
		calc := subQuery.CalculatedChannel
		if subQuery.Channel != nil {
			channelID := strings.TrimSpace(subQuery.Channel.ChannelId)
			if channelID != "" {
				channelIDSet[channelID] = struct{}{}
			}
			if subQuery.Channel.RunId != nil {
				if runID := strings.TrimSpace(*subQuery.Channel.RunId); runID != "" {
					runIDSet[runID] = struct{}{}
				}
			}
		}

		if calc == nil {
			continue
		}

		if calc.RunId != nil {
			if runID := strings.TrimSpace(*calc.RunId); runID != "" {
				runIDSet[runID] = struct{}{}
			}
		}

		name := strings.TrimSpace(calc.ChannelKey)
		if key, ok := calculatedKeys[calc.ChannelKey]; ok {
			if trimmed := strings.TrimSpace(key.channelName); trimmed != "" {
				name = trimmed
			}
		}
		if name == "" {
			continue
		}

		refs := calc.ExpressionRequest.ExpressionChannelReferences
		expr := strings.TrimSpace(calc.ExpressionRequest.Expression)

		meta, exists := metaByName[name]
		if !exists {
			meta = &calculatedChannelMetadata{
				Name:               name,
				SourceChannels:     make([]string, len(refs)),
				ExpressionDataType: "double",
			}
			metaByName[name] = meta
			order = append(order, name)
		} else if len(meta.SourceChannels) != len(refs) {
			meta.SourceChannels = make([]string, len(refs))
		}

		meta.Expression = expr

		for idx, ref := range refs {
			channelID := strings.TrimSpace(ref.ChannelId)
			if channelID == "" {
				continue
			}
			channelIDSet[channelID] = struct{}{}
			if meta.SourceChannels[idx] == "" {
				meta.SourceChannels[idx] = channelID
			}
		}
	}

	channelIDs := make([]string, 0, len(channelIDSet))
	for channelID := range channelIDSet {
		channelIDs = append(channelIDs, channelID)
	}

	if len(channelIDs) > 0 {
		channels, err := d.getChannelsById(ctx, req.PluginContext, channelIDs)
		if err != nil {
			log.DefaultLogger.Error("resolveQueryToSiftMetadata channel lookup error", "error", err)
			return sender.Send(&backend.CallResourceResponse{
				Status: http.StatusBadRequest,
				Body:   []byte(fmt.Sprintf("lookup channels: %s", err)),
			})
		}
		for _, channel := range channels {
			assetID := strings.TrimSpace(channel.AssetId)
			if assetID != "" {
				assetIDSet[assetID] = struct{}{}
			}
		}
	}

	assetIDs := sortedKeys(assetIDSet)
	runIDs := sortedKeys(runIDSet)
	channelIDsSorted := sortedKeys(channelIDSet)

	log.DefaultLogger.Debug(
		"resolveQueryToSiftMetadata summary",
		"assetIds", assetIDs,
		"runIds", runIDs,
		"channelIds", channelIDsSorted,
	)

	var calculatedChannels []calculatedChannelMetadata
	for _, name := range order {
		meta := metaByName[name]
		if meta.Expression == "" {
			continue
		}

		complete := true
		for _, channelID := range meta.SourceChannels {
			if channelID == "" {
				complete = false
				break
			}
		}
		if complete {
			calculatedChannels = append(calculatedChannels, *meta)
		}
	}

	responsePayload := struct {
		AssetIDs           []string                    `json:"assetIds"`
		RunIDs             []string                    `json:"runIds"`
		ChannelIDs         []string                    `json:"channelIds"`
		CalculatedChannels []calculatedChannelMetadata `json:"calculatedChannels,omitempty"`
	}{
		AssetIDs:           assetIDs,
		RunIDs:             runIDs,
		ChannelIDs:         channelIDsSorted,
		CalculatedChannels: calculatedChannels,
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
