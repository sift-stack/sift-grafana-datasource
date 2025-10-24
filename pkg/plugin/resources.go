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
	//hasCalculatedChannels := false
	//for _, cdq := range queryModel.ChannelDataQueries {
	//	if len(cdq.CalculatedChannelQueries) > 0 {
	//		hasCalculatedChannels = true
	//		break
	//	}
	//}

	//if hasCalculatedChannels {
	//	sanitizedModel := *queryModel
	//	sanitizedModel.ChannelDataQueries = make([]channelDataQuery, len(queryModel.ChannelDataQueries))
	//	for i, cdq := range queryModel.ChannelDataQueries {
	//		sanitizedCDQ := cdq
	//		sanitizedCDQ.CalculatedChannelQueries = nil
	//		sanitizedModel.ChannelDataQueries[i] = sanitizedCDQ
	//	}
	//	metadataInput = sanitizedModel
	//}

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

	calculatedAggregates := make(map[string]*calculatedChannelAggregate)
	calculatedOrder := make([]string, 0)

	for _, cdq := range queryModel.ChannelDataQueries {
		for _, calcQuery := range cdq.CalculatedChannelQueries {
			rawName := calcQuery.Name
			trimmedName := strings.TrimSpace(rawName)
			if trimmedName == "" {
				continue
			}

			aggregate, exists := calculatedAggregates[rawName]
			if !exists {
				aggregate = &calculatedChannelAggregate{
					Name:               trimmedName,
					Expression:         strings.TrimSpace(calcQuery.Expression),
					ExpressionDataType: "double",
					SourceChannels:     make([]string, len(calcQuery.ChannelReferences)),
					placeholderIndex:   make(map[string]int, len(calcQuery.ChannelReferences)),
				}
				for idx, ref := range calcQuery.ChannelReferences {
					aggregate.placeholderIndex[ref.ChannelReference] = idx
					if ref.ChannelId != "" {
						aggregate.SourceChannels[idx] = ref.ChannelId
					}
				}
				calculatedAggregates[rawName] = aggregate
				calculatedOrder = append(calculatedOrder, rawName)
			} else {
				if trimmedExpression := strings.TrimSpace(calcQuery.Expression); trimmedExpression != "" {
					aggregate.Expression = trimmedExpression
				}

				if len(calcQuery.ChannelReferences) != len(aggregate.SourceChannels) {
					newSource := make([]string, len(calcQuery.ChannelReferences))
					newIndex := make(map[string]int, len(calcQuery.ChannelReferences))
					for idx, ref := range calcQuery.ChannelReferences {
						newIndex[ref.ChannelReference] = idx
						if existingIdx, ok := aggregate.placeholderIndex[ref.ChannelReference]; ok && existingIdx < len(aggregate.SourceChannels) {
							newSource[idx] = aggregate.SourceChannels[existingIdx]
						}
						if ref.ChannelId != "" {
							newSource[idx] = ref.ChannelId
						}
					}
					aggregate.SourceChannels = newSource
					aggregate.placeholderIndex = newIndex
				} else {
					for idx, ref := range calcQuery.ChannelReferences {
						aggregate.placeholderIndex[ref.ChannelReference] = idx
						if ref.ChannelId != "" && aggregate.SourceChannels[idx] == "" {
							aggregate.SourceChannels[idx] = ref.ChannelId
						}
					}
				}
			}
		}
	}

	calculatedChannels := make([]calculatedChannelMetadata, 0, len(calculatedAggregates))
	if len(calculatedAggregates) > 0 {
		if _, calculatedKeys, err := generateQueries(req.PluginContext, metadataInput, d); err != nil {
			log.DefaultLogger.Error("resolveQueryToSiftMetadata calculated channel lookup error", "error", err)
		} else {
			for _, key := range calculatedKeys {
				aggregate, ok := calculatedAggregates[key.channelName]
				if !ok {
					continue
				}
				for _, ref := range key.channelReferences {
					if pos, ok := aggregate.placeholderIndex[ref.ChannelReference]; ok {
						if pos < len(aggregate.SourceChannels) && aggregate.SourceChannels[pos] == "" {
							aggregate.SourceChannels[pos] = ref.ChannelId
						}
					}
				}
			}
		}

		for _, name := range calculatedOrder {
			aggregate, ok := calculatedAggregates[name]
			if !ok {
				continue
			}
			sourceChannels := make([]string, len(aggregate.SourceChannels))
			copy(sourceChannels, aggregate.SourceChannels)
			allResolved := true
			for _, channelID := range sourceChannels {
				if strings.TrimSpace(channelID) == "" {
					allResolved = false
					break
				}
			}
			if !allResolved {
				continue
			}
			calculatedChannels = append(calculatedChannels, calculatedChannelMetadata{
				Name:               aggregate.Name,
				SourceChannels:     sourceChannels,
				Expression:         aggregate.Expression,
				ExpressionDataType: aggregate.ExpressionDataType,
			})
		}
	}

	responsePayload := struct {
		AssetIDs           []string                    `json:"assetIds"`
		RunIDs             []string                    `json:"runIds"`
		ChannelIDs         []string                    `json:"channelIds"`
		CalculatedChannels []calculatedChannelMetadata `json:"calculatedChannels,omitempty"`
	}{
		AssetIDs:   metadata.AssetIDs,
		RunIDs:     metadata.RunIDs,
		ChannelIDs: metadata.ChannelIDs,
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
