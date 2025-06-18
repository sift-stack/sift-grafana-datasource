package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
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
