package plugin

import (
	"encoding/json"
	"fmt"
	"math"
	"math/rand"
	"net/http"
	"net/http/httptest"
	neturl "net/url"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/useragent"
	"github.com/stretchr/testify/require"
	"github.com/stretchr/testify/suite"
)

// DatasourceTestSuite is the base test suite for datasource tests
type DatasourceTestSuite struct {
	suite.Suite
	server     *httptest.Server
	pCtx       backend.PluginContext
	datasource *SiftDatasource
	origClient *http.Client
}

func TestDatasourceTestSuite(t *testing.T) {
	suite.Run(t, new(DatasourceTestSuite))
}

// SetupSuite sets up the test suite and creates a mock HTTP server
func (s *DatasourceTestSuite) SetupSuite() {
	// Save the original HTTP client
	s.origClient = http.DefaultClient

	// Create a test server that mocks the Sift API
	s.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Set common headers
		w.Header().Set("Content-Type", "application/json")

		// Handle different API endpoints
		switch r.URL.Path {
		case "/api/v1/assets":
			s.handleAssets(w, r)
		case "/api/v2/runs":
			s.handleRuns(w, r)
		case "/api/v3/channels":
			s.handleChannels(w, r)
		case "/api/v2/data":
			s.handleData(w, r)
		case "/api/v1/channels:search":
			s.handleChannelsInternal(w, r)
		default:
			http.Error(w, "Not found", http.StatusNotFound)
		}
	}))

	// Set the test server's client as the default client
	http.DefaultClient = s.server.Client()

	// Create JSON data with the test server URL
	jsonData := map[string]interface{}{
		"url": s.server.URL,
	}
	jsonDataBytes, _ := json.Marshal(jsonData)

	// Create a test plugin context with the test server URL
	s.pCtx = backend.PluginContext{
		DataSourceInstanceSettings: &backend.DataSourceInstanceSettings{
			JSONData:                jsonDataBytes,
			DecryptedSecureJSONData: map[string]string{"apiKey": "test-api-key"},
		},
		PluginVersion: "X.X.X",
		UserAgent:     &useragent.UserAgent{},
		User:          &backend.User{},
	}

	// Initialize the datasource with caches
	assetsIdsCache := NewTypedCache[string, string](0, 0)
	assetsNameCache := NewTypedCache[string, string](0, 0)
	assetsRegexCache := NewTypedCache[string, []string](0, 0)
	runIdsCache := NewTypedCache[string, string](0, 0)
	runsNameCache := NewTypedCache[string, []string](0, 0)
	runsRegexCache := NewTypedCache[string, []string](0, 0)
	channelIdsCache := NewTypedCache[string, Channel](0, 0)
	channelNameCache := NewTypedCacheWithLoader[channelSearchKey, []Channel, string](
		NewTypedCache[string, []Channel](0, 0),
		getChannelsByNameExact,
		StringFromChannelSearchKey)
	channelRegexCache := NewTypedCacheWithLoader[channelSearchKey, []Channel, string](
		NewTypedCache[string, []Channel](0, 0),
		getChannelsByNameSearch,
		StringFromChannelSearchKey)

	s.datasource = &SiftDatasource{
		httpClient:               s.server.Client(),
		assetsIdSearchCache:      assetsIdsCache,
		assetsNameSearchCache:    assetsNameCache,
		assetsRegexSearchCache:   assetsRegexCache,
		runsIdSearchCache:        runIdsCache,
		runsRegexSearchCache:     runsRegexCache,
		runsNameSearchCache:      runsNameCache,
		channelsIdSearchCache:    channelIdsCache,
		channelsNameSearchCache:  channelNameCache,
		channelsRegexSearchCache: channelRegexCache,
	}
}

// TearDownSuite cleans up the test suite
func (s *DatasourceTestSuite) TearDownSuite() {
	// Restore the original HTTP client
	http.DefaultClient = s.origClient

	if s.server != nil {
		s.server.Close()
	}
}

func (s *DatasourceTestSuite) handleAssets(w http.ResponseWriter, r *http.Request) {
	// Get filter from query params
	filter := r.URL.Query().Get("filter")

	// Create base response with all assets
	allAssets := []Asset{
		{AssetId: "asset1", Name: "Test Asset 1"},
		{AssetId: "asset2", Name: "Test Asset 2"},
		{AssetId: "asset3", Name: "Production Asset"},
		{AssetId: "asset4", Name: "Dev Asset"},
	}

	// If no filter, return all assets
	if filter == "" {
		err := json.NewEncoder(w).Encode(listAssetsQueryResponse{Assets: allAssets})
		if err != nil {
			return
		}
		return
	}

	// Parse and apply filters
	var filteredAssets []Asset
	switch {
	case strings.Contains(filter, "name.matches"):
		// Handle regex match: name.matches('pattern')
		pattern := strings.TrimPrefix(strings.Split(filter, "'")[1], "'")
		pattern = strings.ReplaceAll(pattern, "\\\\", "\\")
		regex, err := regexp.Compile(pattern)
		if err == nil {
			for _, asset := range allAssets {
				if regex.MatchString(asset.Name) {
					filteredAssets = append(filteredAssets, asset)
				}
			}
		}
	case strings.Contains(filter, "name =="):
		// Handle exact name match: name == 'value'
		name := strings.TrimPrefix(strings.Split(filter, "'")[1], "'")
		for _, asset := range allAssets {
			if asset.Name == name {
				filteredAssets = append(filteredAssets, asset)
			}
		}
	case strings.Contains(filter, "asset_id in"):
		// Handle asset_id in ['id1', 'id2']
		idStr := strings.TrimPrefix(strings.TrimSuffix(filter, "]"), "asset_id in ['")
		ids := strings.Split(strings.ReplaceAll(idStr, "'", ""), ",")
		for _, asset := range allAssets {
			for _, id := range ids {
				if asset.AssetId == id {
					filteredAssets = append(filteredAssets, asset)
					break
				}
			}
		}
	}

	err := json.NewEncoder(w).Encode(listAssetsQueryResponse{Assets: filteredAssets})
	if err != nil {
		return
	}
}

func (s *DatasourceTestSuite) handleRuns(w http.ResponseWriter, r *http.Request) {
	// Get filter from query params
	filter := r.URL.Query().Get("filter")

	runToAssetIdMap := map[string]string{
		"run1": "asset1",
		"run2": "asset1",
		"run3": "asset2",
		"run4": "asset2",
	}
	// Create base response with all runs
	allRuns := []Run{
		{RunId: "run1", Name: "Test Run 1", ClientKey: "key1"},
		{RunId: "run2", Name: "Test Run 2", ClientKey: "key2"},
		{RunId: "run3", Name: "Production Run", ClientKey: "key3"},
		{RunId: "run4", Name: "Dev Run", ClientKey: "key4"},
	}

	// If no filter, return all runs
	if filter == "" {
		err := json.NewEncoder(w).Encode(listRunsQueryResponse{Runs: allRuns})
		if err != nil {
			return
		}
		return
	}

	// First filter by asset_id if present
	var assetFilteredRuns []Run
	if strings.Contains(filter, "asset_id in") {
		idStr := strings.Split(strings.Split(filter, "asset_id in [")[1], "]")[0]
		ids := strings.Split(strings.ReplaceAll(idStr, "'", ""), ",")
		for _, run := range allRuns {
			for _, id := range ids {
				matchingAssetId := runToAssetIdMap[run.RunId]
				if matchingAssetId == id {
					assetFilteredRuns = append(assetFilteredRuns, run)
					break
				}
			}
		}
	} else {
		assetFilteredRuns = allRuns
	}

	// Then apply name filter if present
	var filteredRuns []Run
	switch {
	case strings.Contains(filter, "name.matches"):
		// Handle regex match: name.matches('pattern')
		pattern := strings.TrimSuffix(strings.Split(filter, "name.matches('")[1], "')")
		pattern = strings.ReplaceAll(pattern, "\\\\", "\\")
		regex, err := regexp.Compile(pattern)
		if err == nil {
			for _, run := range assetFilteredRuns {
				if regex.MatchString(run.Name) {
					filteredRuns = append(filteredRuns, run)
				}
			}
		}
	case strings.Contains(filter, "name =="):
		// Handle exact name match: name == 'value'
		name := strings.TrimSuffix(strings.Split(filter, "name == '")[1], "'")
		for _, run := range assetFilteredRuns {
			if run.Name == name {
				filteredRuns = append(filteredRuns, run)
			}
		}
	case strings.Contains(filter, "run_id in"):
		// Handle run_id in ['id1', 'id2']
		idStr := strings.Split(strings.Split(filter, "run_id in [")[1], "]")[0]
		ids := strings.Split(strings.ReplaceAll(idStr, "'", ""), ",")
		for _, run := range assetFilteredRuns {
			for _, id := range ids {
				if run.RunId == id {
					filteredRuns = append(filteredRuns, run)
				}
			}
		}
	default:
		filteredRuns = assetFilteredRuns
	}

	err := json.NewEncoder(w).Encode(listRunsQueryResponse{Runs: filteredRuns})
	if err != nil {
		return
	}
}

func (s *DatasourceTestSuite) handleChannels(w http.ResponseWriter, r *http.Request) {
	// Get filter from query params
	filter := r.URL.Query().Get("filter")

	// Create base response with all channels
	allChannels := []Channel{
		{
			ChannelId:   "channel1",
			Name:        "Test Channel 1",
			AssetId:     "asset1",
			AssetName:   "Test Asset 1",
			Description: "Test Description 1",
			Unit:        "m/s",
			DataType:    "CHANNEL_DATA_TYPE_INT_64",
		},
		{
			ChannelId:   "channel2",
			Name:        "Test Channel 2",
			AssetId:     "asset1",
			AssetName:   "Test Asset 1",
			Description: "Test Description 2",
			Unit:        "kg",
			DataType:    "CHANNEL_DATA_TYPE_INT_64",
		},
		{
			ChannelId:   "channel3",
			Name:        "Production Channel",
			AssetId:     "asset2",
			AssetName:   "Test Asset 2",
			Description: "Production Description",
			Unit:        "m/s",
			DataType:    "CHANNEL_DATA_TYPE_INT_64",
		},
		{
			ChannelId:   "channel4",
			Name:        "Dev Channel",
			AssetId:     "asset2",
			AssetName:   "Test Asset 2",
			Description: "Dev Description",
			Unit:        "kg",
			DataType:    "CHANNEL_DATA_TYPE_UINT_64",
		},
		{
			ChannelId:   "channel5",
			Name:        "Bytes Channel",
			AssetId:     "asset2",
			AssetName:   "Test Asset 2",
			Description: "Bytes description",
			Unit:        "bytes",
			DataType:    "CHANNEL_DATA_TYPE_BYTES",
		},
	}

	// If no filter, return all channels
	if filter == "" {
		err := json.NewEncoder(w).Encode(listChannelsQueryResponse{Channels: allChannels})
		if err != nil {
			return
		}
		return
	}

	// First filter by asset_id if present
	var assetFilteredChannels []Channel
	if strings.Contains(filter, "asset_id in") {
		idStr := strings.Split(strings.Split(filter, "asset_id in [")[1], "]")[0]
		ids := strings.Split(strings.ReplaceAll(idStr, "'", ""), ",")
		for _, channel := range allChannels {
			for _, id := range ids {
				if channel.AssetId == id {
					assetFilteredChannels = append(assetFilteredChannels, channel)
					break
				}
			}
		}
	} else {
		assetFilteredChannels = allChannels
	}

	// Then apply name filter if present
	var filteredChannels []Channel
	switch {
	case strings.Contains(filter, "name.matches"):
		// Handle regex match: name.matches('pattern')
		pattern := strings.TrimSuffix(strings.Split(filter, "name.matches('")[1], "')")
		pattern = strings.ReplaceAll(pattern, "\\\\", "\\")
		regex, err := regexp.Compile(pattern)
		if err == nil {
			for _, channel := range assetFilteredChannels {
				if regex.MatchString(channel.Name) {
					filteredChannels = append(filteredChannels, channel)
				}
			}
		}
	case strings.Contains(filter, "name =="):
		// Handle exact name match: name == 'value'
		name := strings.TrimSuffix(strings.Split(filter, "name == '")[1], "'")
		for _, channel := range assetFilteredChannels {
			if channel.Name == name {
				filteredChannels = append(filteredChannels, channel)
			}
		}
	case strings.Contains(filter, "channel_id in"):
		// Handle run_id search
		idStr := strings.Split(strings.Split(filter, "channel_id in [")[1], "]")[0]
		ids := strings.Split(strings.ReplaceAll(idStr, "'", ""), ",")
		for _, channel := range assetFilteredChannels {
			for _, id := range ids {
				if channel.ChannelId == id {
					filteredChannels = append(filteredChannels, channel)
					break
				}
			}
		}
	default:
		filteredChannels = assetFilteredChannels
	}

	err := json.NewEncoder(w).Encode(listChannelsQueryResponse{Channels: filteredChannels})
	if err != nil {
		return
	}
}

// handleData handles the /api/v1/data endpoint
func (s *DatasourceTestSuite) handleData(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Queries []struct {
			RefID      string                   `json:"refId"`
			QueryType  string                   `json:"queryType"`
			SubQueries []siftApiGetDataSubQuery `json:"subQueries"`
		} `json:"queries"`
	}

	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	if len(request.Queries) == 0 || len(request.Queries[0].SubQueries) == 0 {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	response := queryResponse{
		Data: make([]queryResponseData, 0),
	}

	// Generate test data for each query
	for _, query := range request.Queries {
		for _, subQuery := range query.SubQueries {
			// Create time series data
			dataPoints := make([]struct {
				Timestamp string      `json:"timestamp"`
				Value     float64     `json:"value"`
				Error     float64     `json:"error"`
				Quality   string      `json:"quality"`
				Metadata  interface{} `json:"metadata,omitempty"`
			}, 100)

			baseTime := time.Now().Add(-1 * time.Hour)
			for i := 0; i < 100; i++ {
				timestamp := baseTime.Add(time.Duration(i) * time.Minute)
				var value, errorVal float64
				var quality string

				// Generate different patterns based on channel
				switch subQuery.Channel.ChannelId {
				case "channel1":
					// Sine wave pattern
					value = math.Sin(float64(i)/10.0) * 100
					errorVal = math.Abs(math.Sin(float64(i)/20.0)) * 5
				case "channel2":
					// Square wave pattern
					if i%20 < 10 {
						value = 100
					} else {
						value = -100
					}
					errorVal = 2.5
				case "channel3":
					// Triangle wave pattern
					value = float64(i%40-20) * 5
					errorVal = 3.0
				default:
					// Random noise pattern
					value = rand.Float64()*200 - 100
					errorVal = rand.Float64() * 10
				}

				// Alternate quality flags
				switch i % 2 {
				case 0:
					quality = "GOOD"
				case 1:
					quality = "BAD"
				}

				dataPoints[i] = struct {
					Timestamp string      `json:"timestamp"`
					Value     float64     `json:"value"`
					Error     float64     `json:"error"`
					Quality   string      `json:"quality"`
					Metadata  interface{} `json:"metadata,omitempty"`
				}{
					Timestamp: timestamp.Format(time.RFC3339),
					Value:     value,
					Error:     errorVal,
					Quality:   quality,
				}
			}

			// Convert data points to JSON
			dataJSON, err := json.Marshal(dataPoints)
			if err != nil {
				w.WriteHeader(http.StatusInternalServerError)
				return
			}

			responseData := queryResponseData{
				Metadata: queryResponseMetadata{
					DataType:  "float64",
					SampledMs: 60000, // 1 minute sampling
					Asset: struct {
						AssetId string `json:"assetId"`
						Name    string `json:"name"`
					}{
						AssetId: fmt.Sprintf("asset%s", subQuery.Channel.ChannelId[len(subQuery.Channel.ChannelId)-1:]),
						Name:    fmt.Sprintf("Test Asset %s", subQuery.Channel.ChannelId[len(subQuery.Channel.ChannelId)-1:]),
					},
					Run: struct {
						RunId string `json:"runId"`
						Name  string `json:"name"`
					}{
						RunId: fmt.Sprintf("run%s", subQuery.Channel.ChannelId[len(subQuery.Channel.ChannelId)-1:]),
						Name:  fmt.Sprintf("Test Run %s", subQuery.Channel.ChannelId[len(subQuery.Channel.ChannelId)-1:]),
					},
					Channel: struct {
						ChannelId        string                                `json:"channelId"`
						Name             string                                `json:"name"`
						EnumTypes        []queryResponseChannelEnumType        `json:"enumTypes"`
						BitFieldElements []queryResponseChannelBitFieldElement `json:"bitFieldElements"`
					}{
						ChannelId: subQuery.Channel.ChannelId,
						Name:      fmt.Sprintf("Test Channel %s", subQuery.Channel.ChannelId[len(subQuery.Channel.ChannelId)-1:]),
						EnumTypes: []queryResponseChannelEnumType{
							{
								Name: "GOOD",
								Key:  0,
							}, {
								Name: "BAD",
								Key:  1,
							},
						},
					},
				},
				Values: json.RawMessage(dataJSON),
			}

			response.Data = append(response.Data, responseData)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	err := json.NewEncoder(w).Encode(response)
	if err != nil {
		return
	}
}

// handleChannelsInternal handles the /api/v1/channels:search endpoint
func (s *DatasourceTestSuite) handleChannelsInternal(w http.ResponseWriter, r *http.Request) {
	// Get search parameters from query params
	assetIds := r.URL.Query().Get("assetIds")
	searchTerm := r.URL.Query().Get("searchTerm")
	isSearchRegexp := r.URL.Query().Get("isSearchRegexp") == "true"
	isSearchCaseSensitive := r.URL.Query().Get("isSearchCaseSensitive") == "true"

	// Create base response with all channels
	allChannels := []Channel{
		{
			ChannelId:   "channel1",
			Name:        "Test Channel 1",
			AssetId:     "asset1",
			AssetName:   "Test Asset 1",
			Description: "Test Description 1",
			Unit:        "m/s",
			DataType:    "CHANNEL_DATA_TYPE_INT_64",
		},
		{
			ChannelId:   "channel2",
			Name:        "Test Channel 2",
			AssetId:     "asset1",
			AssetName:   "Test Asset 1",
			Description: "Test Description 2",
			Unit:        "kg",
			DataType:    "CHANNEL_DATA_TYPE_INT_64",
		},
		{
			ChannelId:   "channel3",
			Name:        "Production Channel",
			AssetId:     "asset2",
			AssetName:   "Test Asset 2",
			Description: "Production Description",
			Unit:        "m/s",
			DataType:    "CHANNEL_DATA_TYPE_INT_64",
		},
		{
			ChannelId:   "channel4",
			Name:        "Dev Channel",
			AssetId:     "asset2",
			AssetName:   "Test Asset 2",
			Description: "Dev Description",
			Unit:        "kg",
			DataType:    "CHANNEL_DATA_TYPE_UINT_64",
		},
		{
			ChannelId:   "channel5",
			Name:        "Bytes Channel",
			AssetId:     "asset2",
			AssetName:   "Test Asset 2",
			Description: "Bytes description",
			Unit:        "bytes",
			DataType:    "CHANNEL_DATA_TYPE_BYTES",
		},
		{
			ChannelId:   "channel6",
			Name:        "Special-Channel",
			AssetId:     "asset3",
			AssetName:   "Production Asset",
			Description: "Special channel with hyphen",
			Unit:        "N",
			DataType:    "CHANNEL_DATA_TYPE_INT_64",
		},
	}

	// Filter by asset ID if provided
	var assetFilteredChannels []Channel
	if assetIds != "" {
		ids := strings.Split(assetIds, ",")
		for _, channel := range allChannels {
			for _, id := range ids {
				if channel.AssetId == id {
					assetFilteredChannels = append(assetFilteredChannels, channel)
					break
				}
			}
		}
	} else {
		assetFilteredChannels = allChannels
	}

	// Apply search term filter if provided
	var filteredChannels []Channel
	if searchTerm != "" {
		if isSearchRegexp {
			// Handle regex search
			regex, err := regexp.Compile(searchTerm)
			if err == nil {
				for _, channel := range assetFilteredChannels {
					if regex.MatchString(channel.Name) {
						filteredChannels = append(filteredChannels, channel)
					}
				}
			}
		} else {
			// Handle exact name search
			for _, channel := range assetFilteredChannels {
				if isSearchCaseSensitive {
					if channel.Name == searchTerm {
						filteredChannels = append(filteredChannels, channel)
					}
				} else {
					if strings.EqualFold(channel.Name, searchTerm) {
						filteredChannels = append(filteredChannels, channel)
					}
				}
			}
		}
	} else {
		filteredChannels = assetFilteredChannels
	}

	err := json.NewEncoder(w).Encode(listChannelsQueryResponse{Channels: filteredChannels})
	if err != nil {
		http.Error(w, "Failed to encode response", http.StatusInternalServerError)
		return
	}
}

// TestHandleAssets tests the asset filtering functionality
func (s *DatasourceTestSuite) TestHandleAssets() {
	tests := []struct {
		name          string
		filter        string
		expectedNames []string
		expectedCount int
		expectedError bool
	}{
		{
			name:          "no filter returns all assets",
			filter:        "",
			expectedNames: []string{"Test Asset 1", "Test Asset 2", "Production Asset", "Dev Asset"},
			expectedCount: 4,
		},
		{
			name:          "exact name match",
			filter:        "name == 'Test Asset 1'",
			expectedNames: []string{"Test Asset 1"},
			expectedCount: 1,
		},
		{
			name:          "regex name match - all test assets",
			filter:        "name.matches('Test.*')",
			expectedNames: []string{"Test Asset 1", "Test Asset 2"},
			expectedCount: 2,
		},
		{
			name:          "regex name match - production",
			filter:        "name.matches('.*Production.*')",
			expectedNames: []string{"Production Asset"},
			expectedCount: 1,
		},
		{
			name:          "asset_id in - single",
			filter:        "asset_id in ['asset1']",
			expectedNames: []string{"Test Asset 1"},
			expectedCount: 1,
		},
		{
			name:          "asset_id in - multiple",
			filter:        "asset_id in ['asset1','asset2']",
			expectedNames: []string{"Test Asset 1", "Test Asset 2"},
			expectedCount: 2,
		},
	}

	for _, tc := range tests {
		s.Run(tc.name, func() {
			// Create request with filter
			url := "/api/v1/assets"
			if tc.filter != "" {
				url += "?filter=" + neturl.QueryEscape(tc.filter)
			}
			req := httptest.NewRequest("GET", url, nil)
			w := httptest.NewRecorder()

			// Call handler
			s.handleAssets(w, req)

			// Check response
			s.Equal(http.StatusOK, w.Code)

			var response listAssetsQueryResponse
			err := json.NewDecoder(w.Body).Decode(&response)
			s.NoError(err)

			// Verify results
			s.Equal(tc.expectedCount, len(response.Assets), "expected %d assets, got %d for filter: %s",
				tc.expectedCount, len(response.Assets), tc.filter)

			// Check each expected name is present
			actualNames := make([]string, len(response.Assets))
			for i, asset := range response.Assets {
				actualNames[i] = asset.Name
			}
			for _, expectedName := range tc.expectedNames {
				s.Contains(actualNames, expectedName, "expected to find asset named %s for filter: %s",
					expectedName, tc.filter)
			}
		})
	}
}

// TestHandleRuns tests the run filtering functionality
func (s *DatasourceTestSuite) TestHandleRuns() {
	tests := []struct {
		name          string
		filter        string
		expectedNames []string
		expectedCount int
		expectedError bool
	}{
		{
			name:          "no filter returns all runs",
			filter:        "",
			expectedNames: []string{"Test Run 1", "Test Run 2", "Production Run", "Dev Run"},
			expectedCount: 4,
		},
		{
			name:          "exact name match",
			filter:        "name == 'Test Run 1'",
			expectedNames: []string{"Test Run 1"},
			expectedCount: 1,
		},
		{
			name:          "regex name match - all test runs",
			filter:        "name.matches('Test.*')",
			expectedNames: []string{"Test Run 1", "Test Run 2"},
			expectedCount: 2,
		},
		{
			name:          "filter by asset_id - single asset",
			filter:        "asset_id in ['asset1']",
			expectedNames: []string{"Test Run 1", "Test Run 2"},
			expectedCount: 2,
		},
		{
			name:          "filter by asset_id - multiple assets",
			filter:        "asset_id in ['asset1','asset2']",
			expectedNames: []string{"Test Run 1", "Test Run 2", "Production Run", "Dev Run"},
			expectedCount: 4,
		},
		{
			name:          "compound filter - asset_id and exact name",
			filter:        "asset_id in ['asset1'] && name == 'Test Run 1'",
			expectedNames: []string{"Test Run 1"},
			expectedCount: 1,
		},
		{
			name:          "compound filter - asset_id and regex name",
			filter:        "asset_id in ['asset2'] && name.matches('.*Run')",
			expectedNames: []string{"Production Run", "Dev Run"},
			expectedCount: 2,
		},
	}

	for _, tc := range tests {
		s.Run(tc.name, func() {
			// Create request with filter
			url := "/api/v2/runs"
			if tc.filter != "" {
				url += "?filter=" + neturl.QueryEscape(tc.filter)
			}
			req := httptest.NewRequest("GET", url, nil)
			w := httptest.NewRecorder()

			// Call handler
			s.handleRuns(w, req)

			// Check response
			s.Equal(http.StatusOK, w.Code)

			var response listRunsQueryResponse
			err := json.NewDecoder(w.Body).Decode(&response)
			s.NoError(err)

			// Verify results
			s.Equal(tc.expectedCount, len(response.Runs), "expected %d runs, got %d for filter: %s",
				tc.expectedCount, len(response.Runs), tc.filter)

			// Check each expected name is present
			actualNames := make([]string, len(response.Runs))
			for i, run := range response.Runs {
				actualNames[i] = run.Name
			}
			for _, expectedName := range tc.expectedNames {
				s.Contains(actualNames, expectedName, "expected to find run named %s for filter: %s",
					expectedName, tc.filter)
			}
		})
	}
}

// TestHandleChannels tests the channel filtering functionality
func (s *DatasourceTestSuite) TestHandleChannels() {
	tests := []struct {
		name          string
		filter        string
		expectedNames []string
		expectedCount int
		expectedError bool
	}{
		{
			name:          "no filter returns all channels",
			filter:        "",
			expectedNames: []string{"Test Channel 1", "Test Channel 2", "Production Channel", "Dev Channel", "Bytes Channel"},
			expectedCount: 5,
		},
		{
			name:          "exact name match",
			filter:        "name == 'Test Channel 1'",
			expectedNames: []string{"Test Channel 1"},
			expectedCount: 1,
		},
		{
			name:          "regex name match - all test channels",
			filter:        "name.matches('Test.*')",
			expectedNames: []string{"Test Channel 1", "Test Channel 2"},
			expectedCount: 2,
		},
		{
			name:          "filter by asset_id - single asset",
			filter:        "asset_id in ['asset1']",
			expectedNames: []string{"Test Channel 1", "Test Channel 2"},
			expectedCount: 2,
		},
		{
			name:          "filter by asset_id - multiple assets",
			filter:        "asset_id in ['asset1','asset2']",
			expectedNames: []string{"Test Channel 1", "Test Channel 2", "Production Channel", "Dev Channel", "Bytes Channel"},
			expectedCount: 5,
		},
		{
			name:          "compound filter - asset_id and exact name",
			filter:        "asset_id in ['asset1'] && name == 'Test Channel 1'",
			expectedNames: []string{"Test Channel 1"},
			expectedCount: 1,
		},
		{
			name:          "compound filter - asset_id and regex name",
			filter:        "asset_id in ['asset2'] && name.matches('.*Channel')",
			expectedNames: []string{"Production Channel", "Dev Channel", "Bytes Channel"},
			expectedCount: 3,
		},
	}

	for _, tc := range tests {
		s.Run(tc.name, func() {
			// Create request with filter
			url := "/api/v3/channels"
			if tc.filter != "" {
				url += "?filter=" + neturl.QueryEscape(tc.filter)
			}
			req := httptest.NewRequest("GET", url, nil)
			w := httptest.NewRecorder()

			// Call handler
			s.handleChannels(w, req)

			// Check response
			s.Equal(http.StatusOK, w.Code)

			var response listChannelsQueryResponse
			err := json.NewDecoder(w.Body).Decode(&response)
			s.NoError(err)

			// Verify results
			s.Equal(tc.expectedCount, len(response.Channels), "expected %d channels, got %d for filter: %s",
				tc.expectedCount, len(response.Channels), tc.filter)

			// Check each expected name is present
			actualNames := make([]string, len(response.Channels))
			for i, channel := range response.Channels {
				actualNames[i] = channel.Name
			}
			for _, expectedName := range tc.expectedNames {
				s.Contains(actualNames, expectedName, "expected to find channel named %s for filter: %s",
					expectedName, tc.filter)
			}
		})
	}
}

// TestHandleData tests the data endpoint functionality
func (s *DatasourceTestSuite) TestHandleData() {
	tests := []struct {
		name             string
		requestBody      string
		expectedCode     int
		expectedError    bool
		validateResponse func(*testing.T, queryResponse)
	}{
		{
			name: "valid request with single channel",
			requestBody: `{
				"queries": [{
					"refId": "A",
					"datasource": {"type": "sift-grafana-datasource"},
					"queryType": "siftApiGetData",
					"subQueries": [{
						"channel": {
							"channelId": "channel1",
							"name": "Test Channel 1"
						}
					}]
				}]
			}`,
			expectedCode:  http.StatusOK,
			expectedError: false,
			validateResponse: func(t *testing.T, resp queryResponse) {
				require.Equal(t, 1, len(resp.Data))
				data := resp.Data[0]

				// Verify metadata structure
				require.Equal(t, "float64", data.Metadata.DataType)
				require.Equal(t, int64(60000), data.Metadata.SampledMs)

				// Verify asset metadata
				require.Equal(t, "asset1", data.Metadata.Asset.AssetId)
				require.Equal(t, "Test Asset 1", data.Metadata.Asset.Name)

				// Verify run metadata
				require.Equal(t, "run1", data.Metadata.Run.RunId)
				require.Equal(t, "Test Run 1", data.Metadata.Run.Name)

				// Verify channel metadata
				require.Equal(t, "channel1", data.Metadata.Channel.ChannelId)
				require.Equal(t, "Test Channel 1", data.Metadata.Channel.Name)

				// Verify enum types structure
				require.Equal(t, 2, len(data.Metadata.Channel.EnumTypes))
				require.Equal(t, "GOOD", data.Metadata.Channel.EnumTypes[0].Name)
				require.Equal(t, "BAD", data.Metadata.Channel.EnumTypes[1].Name)
			},
		},
		{
			name: "valid request with multiple channels",
			requestBody: `{
				"queries": [{
					"refId": "A",
					"datasource": {"type": "sift-grafana-datasource"},
					"queryType": "siftApiGetData",
					"subQueries": [{
						"channel": {
							"channelId": "channel1",
							"name": "Channel 1"
						}
					}, {
						"channel": {
							"channelId": "channel2",
							"name": "Channel 2"
						}
					}]
				}]
			}`,
			expectedCode:  http.StatusOK,
			expectedError: false,
			validateResponse: func(t *testing.T, resp queryResponse) {
				require.Equal(t, 2, len(resp.Data))

				// Verify metadata for each channel
				for i, data := range resp.Data {
					channelNum := i + 1
					require.Equal(t, fmt.Sprintf("channel%d", channelNum), data.Metadata.Channel.ChannelId)
					require.Equal(t, fmt.Sprintf("Test Channel %d", channelNum), data.Metadata.Channel.Name)
					require.Equal(t, fmt.Sprintf("asset%d", channelNum), data.Metadata.Asset.AssetId)
					require.Equal(t, fmt.Sprintf("Test Asset %d", channelNum), data.Metadata.Asset.Name)
				}
			},
		},
		{
			name:          "invalid request - empty body",
			requestBody:   `{}`,
			expectedCode:  http.StatusBadRequest,
			expectedError: true,
		},
	}

	for _, tc := range tests {
		s.Run(tc.name, func() {
			// Create request
			req := httptest.NewRequest("POST", "/api/v1/data", strings.NewReader(tc.requestBody))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()

			// Call handler
			s.handleData(w, req)

			// Check response code
			s.Equal(tc.expectedCode, w.Code)

			if tc.expectedError {
				return // No need to check response body for error cases
			}

			// Parse response
			var response queryResponse
			err := json.NewDecoder(w.Body).Decode(&response)
			s.NoError(err)

			// Validate response
			if tc.validateResponse != nil {
				tc.validateResponse(s.T(), response)
			}
		})
	}
}

func (s *DatasourceTestSuite) TestGenerateDataFrameWithMultipleDataTypes() {
	now := time.Now()
	responseData := []queryResponseData{
		{
			Metadata: queryResponseMetadata{
				DataType: "CHANNEL_DATA_TYPE_DOUBLE",
				Asset: struct {
					AssetId string "json:\"assetId\""
					Name    string "json:\"name\""
				}{
					AssetId: "asset1",
					Name:    "Asset 1",
				},
				Channel: struct {
					ChannelId        string                                "json:\"channelId\""
					Name             string                                "json:\"name\""
					EnumTypes        []queryResponseChannelEnumType        "json:\"enumTypes\""
					BitFieldElements []queryResponseChannelBitFieldElement "json:\"bitFieldElements\""
				}{
					ChannelId: "channel1",
					Name:      "Temperature",
				},
			},
			Values: json.RawMessage(`[
				{"timestamp": "` + now.Format(time.RFC3339Nano) + `", "value": 23.5},
				{"timestamp": "` + now.Add(time.Second).Format(time.RFC3339Nano) + `", "value": 24.1}
			]`),
		},
		{
			Metadata: queryResponseMetadata{
				DataType: "CHANNEL_DATA_TYPE_ENUM",
				Asset: struct {
					AssetId string "json:\"assetId\""
					Name    string "json:\"name\""
				}{
					AssetId: "asset1",
					Name:    "Asset 1",
				},
				Channel: struct {
					ChannelId        string                                "json:\"channelId\""
					Name             string                                "json:\"name\""
					EnumTypes        []queryResponseChannelEnumType        "json:\"enumTypes\""
					BitFieldElements []queryResponseChannelBitFieldElement "json:\"bitFieldElements\""
				}{
					ChannelId: "channel2",
					Name:      "Status",
					EnumTypes: []queryResponseChannelEnumType{
						{Name: "ON", Key: 1},
						{Name: "OFF", Key: 2},
					},
				},
			},
			Values: json.RawMessage(`[
				{"timestamp": "` + now.Format(time.RFC3339Nano) + `", "value": 1},
				{"timestamp": "` + now.Add(time.Second).Format(time.RFC3339Nano) + `", "value": 2}
			]`),
		},
	}

	frame, err := generateDataFrame(responseData, nil, false)
	s.NoError(err)

	// Verify frame structure
	s.Equal(4, len(frame.Fields))
	s.Equal("time", frame.Fields[0].Name)
	s.Equal("Status_string", frame.Fields[1].Name)
	s.Equal("Status_value", frame.Fields[2].Name)
	s.Equal("Temperature", frame.Fields[3].Name)

	// Verify time values
	s.Equal(now.UnixNano(), frame.Fields[0].At(0).(time.Time).UnixNano())
	s.Equal(now.Add(time.Second).UnixNano(), frame.Fields[0].At(1).(time.Time).UnixNano())

	// Verify temperature values
	s.Equal(23.5, *frame.Fields[3].At(0).(*float64))
	s.Equal(24.1, *frame.Fields[3].At(1).(*float64))

	// Verify enum string values
	s.Equal("ON", *frame.Fields[1].At(0).(*string))
	s.Equal("OFF", *frame.Fields[1].At(1).(*string))

	// Verify enum numeric values
	s.Equal(uint32(1), *frame.Fields[2].At(0).(*uint32))
	s.Equal(uint32(2), *frame.Fields[2].At(1).(*uint32))
}

func (s *DatasourceTestSuite) TestGenerateDataFrameHandlesCalculatedChannels() {
	now := time.Now()
	responseData := []queryResponseData{
		{
			Metadata: queryResponseMetadata{
				DataType: "CHANNEL_DATA_TYPE_DOUBLE",
				Asset: struct {
					AssetId string "json:\"assetId\""
					Name    string "json:\"name\""
				}{
					AssetId: "asset1",
					Name:    "Asset 1",
				},
				Channel: struct {
					ChannelId        string                                "json:\"channelId\""
					Name             string                                "json:\"name\""
					EnumTypes        []queryResponseChannelEnumType        "json:\"enumTypes\""
					BitFieldElements []queryResponseChannelBitFieldElement "json:\"bitFieldElements\""
				}{
					ChannelId: "calc1",
					Name:      "Raw Calculation",
				},
			},
			Values: json.RawMessage(`[
				{"timestamp": "` + now.Format(time.RFC3339Nano) + `", "value": 47.0}
			]`),
		},
	}

	calculatedChannelKeys := map[string]calculatedChannelKey{
		"calc1": {
			channelName: "Calculated Result",
			channelReferences: []expressionChannelReference{
				{
					ChannelReference: "$1",
					ChannelName:      "Input Channel",
				},
			},
		},
	}

	frame, err := generateDataFrame(responseData, calculatedChannelKeys, false)
	s.NoError(err)

	// Verify frame structure
	s.Equal(2, len(frame.Fields))
	s.Equal("time", frame.Fields[0].Name)
	s.Equal("Calculated Result", frame.Fields[1].Name)

	// Verify labels
	s.Equal("Input Channel", frame.Fields[1].Labels["$1"])
	s.Equal("Asset 1", frame.Fields[1].Labels["asset"])

	// Verify values
	s.Equal(now.UnixNano(), frame.Fields[0].At(0).(time.Time).UnixNano())
	s.Equal(47.0, *frame.Fields[1].At(0).(*float64))
}

func (s *DatasourceTestSuite) TestGenerateDataFrameHandlesGroupByRun() {
	now := time.Now()
	responseData := []queryResponseData{
		{
			Metadata: queryResponseMetadata{
				DataType: "CHANNEL_DATA_TYPE_DOUBLE",
				Asset: struct {
					AssetId string "json:\"assetId\""
					Name    string "json:\"name\""
				}{
					AssetId: "asset1",
					Name:    "Asset 1",
				},
				Run: struct {
					RunId string "json:\"runId\""
					Name  string "json:\"name\""
				}{
					RunId: "run1",
					Name:  "Run 1",
				},
				Channel: struct {
					ChannelId        string                                "json:\"channelId\""
					Name             string                                "json:\"name\""
					EnumTypes        []queryResponseChannelEnumType        "json:\"enumTypes\""
					BitFieldElements []queryResponseChannelBitFieldElement "json:\"bitFieldElements\""
				}{
					ChannelId: "channel1",
					Name:      "Temperature",
				},
			},
			Values: json.RawMessage(`[
				{"timestamp": "` + now.Format(time.RFC3339Nano) + `", "value": 23.5}
			]`),
		},
	}

	frame, err := generateDataFrame(responseData, nil, false)
	s.NoError(err)

	// Verify frame structure
	s.Equal(2, len(frame.Fields))
	s.Equal("time", frame.Fields[0].Name)
	s.Equal("Temperature", frame.Fields[1].Name)

	// Verify run labels
	s.Equal("Run 1", frame.Fields[1].Labels["run"])
	s.Equal("run1", frame.Fields[1].Labels["run_id"])
}

func (s *DatasourceTestSuite) TestSplitQueriesIntoChunks() {
	queries := []siftApiGetDataSubQuery{
		{
			Channel: &siftApiChannel{
				ChannelId: "channel1",
			},
		},
		{
			Channel: &siftApiChannel{
				ChannelId: "channel2",
			},
		},
		{
			Channel: &siftApiChannel{
				ChannelId: "channel3",
			},
		},
	}

	chunks := splitQueries(queries, 2)
	s.Len(chunks, 2)
	s.Len(chunks[0], 2)
	s.Len(chunks[1], 1)

	// Verify contents of first chunk
	s.Equal("channel1", chunks[0][0].Channel.ChannelId)
	s.Equal("channel2", chunks[0][1].Channel.ChannelId)

	// Verify contents of second chunk
	s.Equal("channel3", chunks[1][0].Channel.ChannelId)
}

func (s *DatasourceTestSuite) TestSplitQueriesHandlesEmptyInput() {
	chunks := splitQueries([]siftApiGetDataSubQuery{}, 2)
	s.Len(chunks, 0)
}

func (s *DatasourceTestSuite) TestSplitQueriesHandlesLargeChunkSize() {
	queries := []siftApiGetDataSubQuery{
		{
			Channel: &siftApiChannel{
				ChannelId: "channel1",
			},
		},
		{
			Channel: &siftApiChannel{
				ChannelId: "channel2",
			},
		},
	}

	chunks := splitQueries(queries, 5)
	s.Len(chunks, 1)
	s.Len(chunks[0], 2)
	s.Equal("channel1", chunks[0][0].Channel.ChannelId)
	s.Equal("channel2", chunks[0][1].Channel.ChannelId)
}

func (s *DatasourceTestSuite) TestSplitQueriesHandlesChunkSizeOne() {
	queries := []siftApiGetDataSubQuery{
		{
			Channel: &siftApiChannel{
				ChannelId: "channel1",
			},
		},
		{
			Channel: &siftApiChannel{
				ChannelId: "channel2",
			},
		},
		{
			Channel: &siftApiChannel{
				ChannelId: "channel3",
			},
		},
	}

	chunks := splitQueries(queries, 1)
	s.Len(chunks, 3)
	s.Len(chunks[0], 1)
	s.Len(chunks[1], 1)
	s.Len(chunks[2], 1)

	// Verify each chunk
	s.Equal("channel1", chunks[0][0].Channel.ChannelId)
	s.Equal("channel2", chunks[1][0].Channel.ChannelId)
	s.Equal("channel3", chunks[2][0].Channel.ChannelId)
}

func (s *DatasourceTestSuite) TestGenerateQueries() {
	runIds := []string{"run1", "run2"}
	testCases := []struct {
		name                string
		input               queryModel
		expectedQueries     []siftApiGetDataSubQuery
		expectedChannelKeys map[string]calculatedChannelKey
		expectedError       string
	}{
		{
			name: "missing asset",
			input: queryModel{
				ChannelDataQueries: []channelDataQuery{
					{
						ChannelQueries: []channelQuery{
							{
								ChannelId: "channel1",
							},
						},
					},
				},
			},
			expectedQueries:     []siftApiGetDataSubQuery{},
			expectedChannelKeys: map[string]calculatedChannelKey{},
			expectedError:       "no assets found for query",
		},
		{
			name: "simple channel id query",
			input: queryModel{
				ChannelDataQueries: []channelDataQuery{
					{
						AssetQueries: []assetQuery{
							{
								AssetId: "asset1",
							},
						},
						ChannelQueries: []channelQuery{
							{
								ChannelId: "channel1",
							},
						},
					},
				},
			},
			expectedQueries: []siftApiGetDataSubQuery{
				{
					Channel: &siftApiChannel{
						ChannelId: "channel1",
					},
				},
			},
			expectedChannelKeys: map[string]calculatedChannelKey{},
			expectedError:       "",
		},
		{
			name: "channel query and asset id, omit bytes channel type",
			input: queryModel{
				ChannelDataQueries: []channelDataQuery{
					{
						AssetQueries: []assetQuery{
							{
								AssetId: "asset2",
							},
						},
						ChannelQueries: []channelQuery{
							{
								ChannelName: ".* Channel",
								NameAsRegex: true,
							},
						},
					},
				},
			},
			expectedQueries: []siftApiGetDataSubQuery{
				{
					Channel: &siftApiChannel{
						ChannelId: "channel3",
					},
				},
				{
					Channel: &siftApiChannel{
						ChannelId: "channel4",
					},
				},
			},
			expectedChannelKeys: map[string]calculatedChannelKey{},
			expectedError:       "",
		},
		{
			name: "channel query and asset id with run",
			input: queryModel{
				ChannelDataQueries: []channelDataQuery{
					{
						AssetQueries: []assetQuery{
							{
								AssetId: "asset1",
							},
						},
						RunQueries: []runQuery{
							{
								RunName:     ".* Run \\d",
								NameAsRegex: true,
							},
						},
						ChannelQueries: []channelQuery{
							{
								ChannelName: ".*Channel 1",
								NameAsRegex: true,
							},
						},
					},
				},
			},
			expectedQueries: []siftApiGetDataSubQuery{
				{
					Channel: &siftApiChannel{
						ChannelId: "channel1",
						RunId:     &runIds[0],
					},
				},
				{
					Channel: &siftApiChannel{
						ChannelId: "channel1",
						RunId:     &runIds[1],
					},
				},
			},
			expectedChannelKeys: map[string]calculatedChannelKey{},
			expectedError:       "",
		},
		{
			name: "calculated channel query",
			input: queryModel{
				ChannelDataQueries: []channelDataQuery{
					{
						AssetQueries: []assetQuery{
							{
								AssetId: "asset1",
							},
						},
						CalculatedChannelQueries: []calculatedChannelQuery{
							{
								Name:       "Calculated Channel A",
								Expression: "$1 + $2",
								ChannelReferences: []channelReferenceQuery{
									{
										channelQuery: channelQuery{
											ChannelId: "channel1",
										},
										ChannelReference: "$1",
									},
									{
										channelQuery: channelQuery{
											ChannelId: "channel2",
										},
										ChannelReference: "$2",
									},
								},
							},
						},
					},
				},
			},
			expectedQueries: []siftApiGetDataSubQuery{
				{
					CalculatedChannel: &siftApiCalculatedChannel{
						ChannelKey: "asset1-Calculated Channel A",
						ExpressionRequest: siftApiExpressionRequest{
							Expression: "$1 + $2",
							ExpressionChannelReferences: []siftApiExpressionChannelReference{
								{ChannelReference: "$1", ChannelId: "channel1"},
								{ChannelReference: "$2", ChannelId: "channel2"},
							},
						},
						CombineRunData: false,
					},
				},
			},
			expectedChannelKeys: map[string]calculatedChannelKey{
				"asset1-Calculated Channel A": {
					channelName: "Calculated Channel A",
					channelReferences: []expressionChannelReference{
						{
							ChannelReference: "$1",
							ChannelId:        "channel1",
							ChannelName:      "Test Channel 1",
						}, {
							ChannelReference: "$2",
							ChannelId:        "channel2",
							ChannelName:      "Test Channel 2",
						},
					},
				},
			},
			expectedError: "",
		},
		{
			name: "calculated channel query - regex",
			input: queryModel{
				ChannelDataQueries: []channelDataQuery{
					{
						AssetQueries: []assetQuery{
							{
								AssetId: "asset1",
							},
						},
						CalculatedChannelQueries: []calculatedChannelQuery{
							{
								Name:       "Calculated Channel A",
								Expression: "$1 + $2",
								ChannelReferences: []channelReferenceQuery{
									{
										channelQuery: channelQuery{
											ChannelName: "^Test Channel.*",
											NameAsRegex: true,
										},
										ChannelReference: "$1",
									},
									{
										channelQuery: channelQuery{
											ChannelName: "^Test Channel.*",
											NameAsRegex: true,
										},
										ChannelReference: "$2",
									},
								},
							},
						},
					},
				},
			},
			expectedQueries: []siftApiGetDataSubQuery{
				{
					CalculatedChannel: &siftApiCalculatedChannel{
						ChannelKey: "asset1-Calculated Channel A-uuid1",
						ExpressionRequest: siftApiExpressionRequest{
							Expression: "$1 + $2",
							ExpressionChannelReferences: []siftApiExpressionChannelReference{
								{ChannelReference: "$1", ChannelId: "channel1"},
								{ChannelReference: "$2", ChannelId: "channel1"},
							},
						},
						CombineRunData: false,
					},
				},
				{
					CalculatedChannel: &siftApiCalculatedChannel{
						ChannelKey: "asset1-Calculated Channel A-uuid2",
						ExpressionRequest: siftApiExpressionRequest{
							Expression: "$1 + $2",
							ExpressionChannelReferences: []siftApiExpressionChannelReference{
								{ChannelReference: "$1", ChannelId: "channel1"},
								{ChannelReference: "$2", ChannelId: "channel2"},
							},
						},
						CombineRunData: false,
					},
				},
				{
					CalculatedChannel: &siftApiCalculatedChannel{
						ChannelKey: "asset1-Calculated Channel A-uuid3",
						ExpressionRequest: siftApiExpressionRequest{
							Expression: "$1 + $2",
							ExpressionChannelReferences: []siftApiExpressionChannelReference{
								{ChannelReference: "$1", ChannelId: "channel2"},
								{ChannelReference: "$2", ChannelId: "channel1"},
							},
						},
						CombineRunData: false,
					},
				},
				{
					CalculatedChannel: &siftApiCalculatedChannel{
						ChannelKey: "asset1-Calculated Channel A-uuid4",
						ExpressionRequest: siftApiExpressionRequest{
							Expression: "$1 + $2",
							ExpressionChannelReferences: []siftApiExpressionChannelReference{
								{ChannelReference: "$1", ChannelId: "channel2"},
								{ChannelReference: "$2", ChannelId: "channel2"},
							},
						},
						CombineRunData: false,
					},
				},
			},
			expectedChannelKeys: map[string]calculatedChannelKey{
				"asset1-Calculated Channel A-uuid1": {
					channelName: "Calculated Channel A-uuid1",
					channelReferences: []expressionChannelReference{
						{
							ChannelReference: "$1",
							ChannelId:        "channel1",
							ChannelName:      "Test Channel 1",
						}, {
							ChannelReference: "$2",
							ChannelId:        "channel2",
							ChannelName:      "Test Channel 2",
						},
					},
				},
				"asset1-Calculated Channel A-uuid2": {
					channelName: "Calculated Channel A-uuid2",
					channelReferences: []expressionChannelReference{
						{
							ChannelReference: "$1",
							ChannelId:        "channel2",
							ChannelName:      "Test Channel 2",
						}, {
							ChannelReference: "$2",
							ChannelId:        "channel1",
							ChannelName:      "Test Channel 1",
						},
					},
				},
				"asset1-Calculated Channel A-uuid3": {
					channelName: "Calculated Channel A-uuid3",
					channelReferences: []expressionChannelReference{
						{
							ChannelReference: "$1",
							ChannelId:        "channel1",
							ChannelName:      "Test Channel 1",
						}, {
							ChannelReference: "$2",
							ChannelId:        "channel1",
							ChannelName:      "Test Channel 1",
						},
					},
				},
				"asset1-Calculated Channel A-uuid4": {
					channelName: "Calculated Channel A-uuid4",
					channelReferences: []expressionChannelReference{
						{
							ChannelReference: "$1",
							ChannelId:        "channel2",
							ChannelName:      "Test Channel 2",
						}, {
							ChannelReference: "$2",
							ChannelId:        "channel2",
							ChannelName:      "Test Channel 2",
						},
					},
				},
			},
			expectedError: "",
		},
		{
			name: "calculated channel query - missing name",
			input: queryModel{
				ChannelDataQueries: []channelDataQuery{
					{
						AssetQueries: []assetQuery{
							{
								AssetId: "asset1",
							},
						},
						CalculatedChannelQueries: []calculatedChannelQuery{
							{
								Expression: "$1 + $2",
								ChannelReferences: []channelReferenceQuery{
									{
										channelQuery: channelQuery{
											ChannelId: "channel1",
										},
										ChannelReference: "$1",
									},
									{
										channelQuery: channelQuery{
											ChannelId: "channel2",
										},
										ChannelReference: "$2",
									},
								},
							},
						},
					},
				},
			},
			expectedQueries: []siftApiGetDataSubQuery{
				{
					CalculatedChannel: &siftApiCalculatedChannel{
						ChannelKey: "Calculated Channel A",
						ExpressionRequest: siftApiExpressionRequest{
							Expression: "$1 + $2",
							ExpressionChannelReferences: []siftApiExpressionChannelReference{
								{ChannelReference: "$1", ChannelId: "channel1"},
								{ChannelReference: "$2", ChannelId: "channel2"},
							},
						},
						CombineRunData: false,
					},
				},
			},
			expectedChannelKeys: map[string]calculatedChannelKey{
				"asset1-Calculated Channel A": {
					channelName: "Calculated Channel A",
					channelReferences: []expressionChannelReference{
						{
							ChannelReference: "$1",
							ChannelId:        "channel1",
							ChannelName:      "Test Channel 1",
						}, {
							ChannelReference: "$2",
							ChannelId:        "channel2",
							ChannelName:      "Test Channel 2",
						},
					},
				},
			},
			expectedError: "calculated channel query name is required",
		},
		{
			name: "calculated channel query - regex runs",
			input: queryModel{
				ChannelDataQueries: []channelDataQuery{
					{
						AssetQueries: []assetQuery{
							{
								AssetId: "asset1",
							},
						},
						RunQueries: []runQuery{
							{
								RunName:     "Test Run.*",
								NameAsRegex: true,
							},
						},
						CalculatedChannelQueries: []calculatedChannelQuery{
							{
								Name:       "Calculated Channel A",
								Expression: "$1 + $2",
								ChannelReferences: []channelReferenceQuery{
									{
										channelQuery: channelQuery{
											ChannelId: "channel1",
										},
										ChannelReference: "$1",
									},
									{
										channelQuery: channelQuery{
											ChannelId: "channel2",
										},
										ChannelReference: "$2",
									},
								},
							},
						},
					},
				},
			},
			expectedQueries: []siftApiGetDataSubQuery{
				{
					CalculatedChannel: &siftApiCalculatedChannel{
						ChannelKey: "asset1-Calculated Channel A",
						ExpressionRequest: siftApiExpressionRequest{
							Expression: "$1 + $2",
							ExpressionChannelReferences: []siftApiExpressionChannelReference{
								{ChannelReference: "$1", ChannelId: "channel1"},
								{ChannelReference: "$2", ChannelId: "channel2"},
							},
						},
						RunId:          &runIds[0],
						CombineRunData: false,
					},
				},
				{
					CalculatedChannel: &siftApiCalculatedChannel{
						ChannelKey: "asset1-Calculated Channel A",
						ExpressionRequest: siftApiExpressionRequest{
							Expression: "$1 + $2",
							ExpressionChannelReferences: []siftApiExpressionChannelReference{
								{ChannelReference: "$1", ChannelId: "channel1"},
								{ChannelReference: "$2", ChannelId: "channel2"},
							},
						},
						RunId:          &runIds[1],
						CombineRunData: false,
					},
				},
			},
			expectedChannelKeys: map[string]calculatedChannelKey{
				"asset1-Calculated Channel A": {
					channelName: "Calculated Channel A",
					channelReferences: []expressionChannelReference{
						{
							ChannelReference: "$1",
							ChannelId:        "channel1",
							ChannelName:      "Test Channel 1",
						}, {
							ChannelReference: "$2",
							ChannelId:        "channel2",
							ChannelName:      "Test Channel 2",
						},
					},
				},
			},
			expectedError: "",
		},
	}

	for _, tc := range testCases {
		s.Run(tc.name, func() {
			queries, channelKeys, err := generateQueries(s.pCtx, tc.input, s.datasource)

			if tc.expectedError != "" {
				s.Error(err)
				s.Contains(err.Error(), tc.expectedError)
				s.Empty(queries)
				s.Empty(channelKeys)
				return
			}

			s.NoError(err)

			s.Equal(len(tc.expectedQueries), len(queries))

			// For each expected query, find a matching actual query by channel references
			for _, expectedQuery := range tc.expectedQueries {
				if expectedQuery.CalculatedChannel != nil {
					found := false
					for _, actualQuery := range queries {
						if actualQuery.CalculatedChannel != nil &&
							s.channelRefsMatch(
								expectedQuery.CalculatedChannel.ExpressionRequest.ExpressionChannelReferences,
								actualQuery.CalculatedChannel.ExpressionRequest.ExpressionChannelReferences) {
							found = true
							// Compare everything except the channel key
							s.Equal(expectedQuery.CalculatedChannel.ExpressionRequest, actualQuery.CalculatedChannel.ExpressionRequest)
							s.Equal(expectedQuery.CalculatedChannel.CombineRunData, actualQuery.CalculatedChannel.CombineRunData)
							break
						}
					}
					s.True(found, "No matching query found for channel references %v",
						expectedQuery.CalculatedChannel.ExpressionRequest.ExpressionChannelReferences)
				} else {
					// For non-calculated channels, do exact comparison
					found := false
					for _, actualQuery := range queries {
						if s.channelsMatch(expectedQuery.Channel, actualQuery.Channel) {
							found = true
							break
						}
					}
					s.True(found, "No matching query found for channel ID %v", expectedQuery.Channel.ChannelId)
				}
			}

			// For channel keys, verify by matching channel references
			s.Equal(len(tc.expectedChannelKeys), len(channelKeys))
			for _, expectedVal := range tc.expectedChannelKeys {
				found := false
				for _, actualVal := range channelKeys {
					expectedChannelReferences := []siftApiExpressionChannelReference{}
					actualChannelReferences := []siftApiExpressionChannelReference{}
					for _, expectedRef := range expectedVal.channelReferences {
						expectedChannelReferences = append(expectedChannelReferences, siftApiExpressionChannelReference{
							ChannelId:        expectedRef.ChannelId,
							ChannelReference: expectedRef.ChannelReference,
						})
					}
					for _, actualRef := range actualVal.channelReferences {
						actualChannelReferences = append(actualChannelReferences, siftApiExpressionChannelReference{
							ChannelId:        actualRef.ChannelId,
							ChannelReference: actualRef.ChannelReference,
						})
					}
					if s.channelRefsMatch(expectedChannelReferences, actualChannelReferences) {
						found = true
						expectedWithoutUUID := strings.Split(expectedVal.channelName, "-")[0]
						// Compare everything except the key name
						s.True(strings.HasPrefix(actualVal.channelName, expectedWithoutUUID))
						s.Equal(len(expectedVal.channelReferences), len(actualVal.channelReferences))
						for i, expectedRef := range expectedVal.channelReferences {
							s.Equal(expectedRef.ChannelId, actualVal.channelReferences[i].ChannelId)
							s.Equal(expectedRef.ChannelReference, actualVal.channelReferences[i].ChannelReference)
							if expectedRef.ChannelName != "" {
								s.Equal(expectedRef.ChannelName, actualVal.channelReferences[i].ChannelName)
							}
						}
						break
					}
				}
				s.True(found, "No matching channel key found for references %v", expectedVal.channelReferences)
			}
		})
	}
}

// Helper function to compare channel references
func (s *DatasourceTestSuite) channelRefsMatch(expected, actual []siftApiExpressionChannelReference) bool {
	if len(expected) != len(actual) {
		return false
	}
	for i := range expected {
		if expected[i].ChannelId != actual[i].ChannelId ||
			expected[i].ChannelReference != actual[i].ChannelReference {
			return false
		}
	}
	return true
}

func (s *DatasourceTestSuite) channelsMatch(expected, actual *siftApiChannel) bool {
	if expected == nil || actual == nil {
		return false
	}
	if expected.ChannelId != actual.ChannelId || expected.RunId != nil && *expected.RunId != *actual.RunId {
		return false
	}
	return true
}

func (s *DatasourceTestSuite) TestGenerateQueryMetadata() {
	testCases := []struct {
		name        string
		input       queryModel
		expect      queryMetadata
		expectError string
	}{
		{
			name: "simple channel lookup",
			input: queryModel{
				ChannelDataQueries: []channelDataQuery{
					{
						AssetQueries: []assetQuery{
							{AssetName: "Test Asset 1"},
						},
						RunQueries: []runQuery{
							{RunName: "Test Run 1"},
						},
						ChannelQueries: []channelQuery{
							{ChannelName: "Test Channel 1"},
						},
					},
				},
			},
			expect: queryMetadata{
				AssetIDs:   []string{"asset1"},
				RunIDs:     []string{"run1"},
				ChannelIDs: []string{"channel1"},
			},
		},
		{
			name: "regex channel lookup",
			input: queryModel{
				ChannelDataQueries: []channelDataQuery{
					{
						AssetQueries: []assetQuery{
							{AssetName: "Test Asset 1"},
						},
						ChannelQueries: []channelQuery{
							{ChannelName: "Test Channel .*", NameAsRegex: true},
						},
					},
				},
			},
			expect: queryMetadata{
				AssetIDs:   []string{"asset1"},
				ChannelIDs: []string{"channel1", "channel2"},
				RunIDs:     []string{},
			},
		},
		{
			name: "calculated channel references",
			input: func() queryModel {
				refs := []channelReferenceQuery{
					{ChannelReference: "$1"},
					{ChannelReference: "$2"},
				}
				refs[0].ChannelId = "channel1"
				refs[1].ChannelName = "Test Channel 2"

				return queryModel{
					ChannelDataQueries: []channelDataQuery{
						{
							AssetQueries: []assetQuery{
								{AssetId: "asset1"},
							},
							CalculatedChannelQueries: []calculatedChannelQuery{
								{
									Name:              "Calculated",
									Expression:        "$1 + $2",
									ChannelReferences: refs,
								},
							},
						},
					},
				}
			}(),
			expect: queryMetadata{
				AssetIDs:   []string{"asset1"},
				ChannelIDs: []string{"channel1", "channel2"},
				RunIDs:     []string{},
			},
		},
		{
			name: "missing assets",
			input: queryModel{
				ChannelDataQueries: []channelDataQuery{
					{
						AssetQueries: []assetQuery{
							{AssetName: "Unknown Asset"},
						},
						ChannelQueries: []channelQuery{
							{ChannelName: "Test Channel 1"},
						},
					},
				},
			},
			expectError: "no assets found",
		},
	}

	for _, tc := range testCases {
		s.Run(tc.name, func() {
			metadata, err := generateQueryMetadata(s.pCtx, tc.input, s.datasource)
			if tc.expectError != "" {
				s.Error(err)
				s.Contains(err.Error(), tc.expectError)
				return
			}

			s.NoError(err)
			s.Equal(tc.expect.AssetIDs, metadata.AssetIDs)
			s.Equal(tc.expect.RunIDs, metadata.RunIDs)
			s.Equal(tc.expect.ChannelIDs, metadata.ChannelIDs)
		})
	}
}
