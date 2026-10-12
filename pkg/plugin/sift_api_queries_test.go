package plugin

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/useragent"
	"github.com/stretchr/testify/require"
)

// Sift's internal data endpoint reads full resolution unless the caller asks for downsampled
// tiers with this header. The backend still reads raw for an org without downsampled reads
// enabled, and for intervals finer than its finest tier, so sending it on every data request is safe.
func TestGetDataRequestsDownsampledTiersOnTheInternalDataEndpoint(t *testing.T) {
	var gotPaths, gotTierSelection []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPaths = append(gotPaths, r.URL.Path)
		gotTierSelection = append(gotTierSelection, r.Header.Get("Grpc-Metadata-X-Tier-Selection"))
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(queryResponse{})
	}))
	defer server.Close()

	jsonData, err := json.Marshal(map[string]string{"url": server.URL})
	require.NoError(t, err)
	pCtx := backend.PluginContext{
		DataSourceInstanceSettings: &backend.DataSourceInstanceSettings{
			JSONData:                jsonData,
			DecryptedSecureJSONData: map[string]string{"apiKey": "test-api-key"},
		},
		UserAgent: &useragent.UserAgent{},
	}
	d := &SiftDatasource{httpClient: server.Client()}
	query := backend.DataQuery{
		TimeRange: backend.TimeRange{From: time.Unix(1_700_000_000, 0), To: time.Unix(1_700_086_400, 0)},
		Interval:  time.Minute,
	}

	_, err = d.getData(context.Background(), pCtx, []siftApiGetDataSubQuery{{Channel: &siftApiChannel{ChannelId: "channel-1"}}}, query, 60_000)
	require.NoError(t, err)
	require.Equal(t, []string{"/api/v2/internal/data"}, gotPaths)
	require.Equal(t, []string{"downsampled"}, gotTierSelection)

	_, err = d.executeRequest(context.Background(), apiRequest{pCtx: pCtx, method: "GET", path: "/api/v2/runs"})
	require.NoError(t, err)
	require.Equal(t, "", gotTierSelection[1], "only data requests ask for downsampled tiers")
}
