package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/useragent"
	"github.com/grafana/grafana-plugin-sdk-go/data"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// dataServerBehavior decides, per channel id, how the mock Sift data endpoint responds.
type dataServerBehavior struct {
	// failChannels are answered with a 500.
	failChannels map[string]bool
	// delay is applied to every channel not in failChannels, so a test can prove a slow
	// sibling chunk is not aborted by a fast failure elsewhere.
	delay time.Duration
	// served counts the requests that returned data.
	served atomic.Int32
}

// newDataServer stands in for the Sift data API. It answers /api/v2/internal/data with one
// row per requested channel, failing the channels the behavior names.
func newDataServer(t *testing.T, behavior *dataServerBehavior) (*httptest.Server, backend.PluginContext) {
	t.Helper()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v2/internal/data" {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}

		var req siftApiGetDataQuery
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}

		for _, sub := range req.Queries {
			if sub.Channel != nil && behavior.failChannels[sub.Channel.ChannelId] {
				http.Error(w, fmt.Sprintf("channel %s is unavailable", sub.Channel.ChannelId), http.StatusInternalServerError)
				return
			}
		}

		if behavior.delay > 0 {
			select {
			case <-time.After(behavior.delay):
			case <-r.Context().Done():
				// The client went away. Returning without writing lets the test observe
				// the cancellation as a failed request rather than as data.
				return
			}
		}

		response := queryResponse{}
		for _, sub := range req.Queries {
			row := queryResponseData{Values: json.RawMessage(`[]`)}
			row.Metadata.DataType = "CHANNEL_DATA_TYPE_DOUBLE"
			row.Metadata.Channel.ChannelId = sub.Channel.ChannelId
			row.Metadata.Channel.Name = sub.Channel.ChannelId
			response.Data = append(response.Data, row)
		}
		behavior.served.Add(1)
		w.Header().Set("Content-Type", "application/json")
		require.NoError(t, json.NewEncoder(w).Encode(response))
	}))
	t.Cleanup(server.Close)

	jsonDataBytes, err := json.Marshal(map[string]interface{}{"url": server.URL})
	require.NoError(t, err)

	pCtx := backend.PluginContext{
		DataSourceInstanceSettings: &backend.DataSourceInstanceSettings{
			JSONData:                jsonDataBytes,
			DecryptedSecureJSONData: map[string]string{"apiKey": "test-api-key"},
		},
		PluginVersion: "X.X.X",
		UserAgent:     &useragent.UserAgent{},
		User:          &backend.User{},
	}
	return server, pCtx
}

func channelSubQueries(ids ...string) []siftApiGetDataSubQuery {
	queries := make([]siftApiGetDataSubQuery, 0, len(ids))
	for _, id := range ids {
		queries = append(queries, siftApiGetDataSubQuery{Channel: &siftApiChannel{ChannelId: id}})
	}
	return queries
}

func testDataQuery() backend.DataQuery {
	return backend.DataQuery{
		RefID:     "A",
		TimeRange: backend.TimeRange{From: time.Now().Add(-time.Hour), To: time.Now()},
		Interval:  time.Second,
	}
}

// One failing channel used to blank the whole panel: errgroup.WithContext cancelled the
// sibling chunks and every row already collected was discarded. Now the good channel's
// rows survive and the failure comes back alongside them.
func TestRunDataQueries_ReturnsPartialDataAndErrors(t *testing.T) {
	behavior := &dataServerBehavior{failChannels: map[string]bool{"bad": true}}
	server, pCtx := newDataServer(t, behavior)
	ds := &SiftDatasource{httpClient: server.Client()}

	rows, errs := runDataQueries(context.Background(), pCtx, channelSubQueries("good", "bad"), testDataQuery(), ds)

	require.Len(t, errs, 1)
	assert.Contains(t, errs[0].Error(), "channel bad is unavailable")
	require.Len(t, rows, 1)
	assert.Equal(t, "good", rows[0].Metadata.Channel.ChannelId)
}

// The regression test for the fail-fast removal: a chunk that fails immediately must not
// cancel a slower sibling that is still fetching.
func TestRunDataQueries_FailureDoesNotAbortSiblings(t *testing.T) {
	behavior := &dataServerBehavior{
		failChannels: map[string]bool{"bad": true},
		delay:        150 * time.Millisecond,
	}
	server, pCtx := newDataServer(t, behavior)
	ds := &SiftDatasource{httpClient: server.Client()}

	rows, errs := runDataQueries(context.Background(), pCtx, channelSubQueries("bad", "slow"), testDataQuery(), ds)

	require.Len(t, errs, 1)
	require.Len(t, rows, 1)
	assert.Equal(t, "slow", rows[0].Metadata.Channel.ChannelId)
	assert.Equal(t, int32(1), behavior.served.Load(), "the slow chunk ran to completion")
}

func TestRunDataQueries_AllChunksFail(t *testing.T) {
	behavior := &dataServerBehavior{failChannels: map[string]bool{"a": true, "b": true}}
	server, pCtx := newDataServer(t, behavior)
	ds := &SiftDatasource{httpClient: server.Client()}

	rows, errs := runDataQueries(context.Background(), pCtx, channelSubQueries("a", "b"), testDataQuery(), ds)

	assert.Empty(t, rows)
	assert.Len(t, errs, 2)
}

func TestRunDataQueries_AllChunksSucceed(t *testing.T) {
	server, pCtx := newDataServer(t, &dataServerBehavior{})
	ds := &SiftDatasource{httpClient: server.Client()}

	rows, errs := runDataQueries(context.Background(), pCtx, channelSubQueries("a", "b"), testDataQuery(), ds)

	assert.Empty(t, errs)
	assert.Len(t, rows, 2)
}

func TestRunDataQueries_NoQueries(t *testing.T) {
	server, pCtx := newDataServer(t, &dataServerBehavior{})
	ds := &SiftDatasource{httpClient: server.Client()}

	rows, errs := runDataQueries(context.Background(), pCtx, nil, testDataQuery(), ds)

	assert.Empty(t, rows)
	assert.Empty(t, errs)
}

// Real cancellation still reaches every chunk, unlike a single chunk's failure.
func TestRunDataQueries_CancellationReachesEveryChunk(t *testing.T) {
	server, pCtx := newDataServer(t, &dataServerBehavior{delay: time.Minute})
	ds := &SiftDatasource{httpClient: server.Client()}

	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(50 * time.Millisecond)
		cancel()
	}()

	start := time.Now()
	rows, errs := runDataQueries(ctx, pCtx, channelSubQueries("a", "b"), testDataQuery(), ds)

	assert.Less(t, time.Since(start), 10*time.Second, "cancellation should abort the in-flight reads")
	assert.Empty(t, rows)
	assert.Len(t, errs, 2)
}

// ---------------------------------------------------------------------------
// notices
// ---------------------------------------------------------------------------

func TestPartialDataNotice(t *testing.T) {
	t.Run("no failures", func(t *testing.T) {
		_, ok := partialDataNotice(context.Background(), nil)
		assert.False(t, ok)
	})

	t.Run("some requests failed", func(t *testing.T) {
		errs := []error{fmt.Errorf("channel bad is unavailable"), fmt.Errorf("timeout")}
		notice, ok := partialDataNotice(context.Background(), errs)
		require.True(t, ok)
		assert.Equal(t, data.NoticeSeverityWarning, notice.Severity)
		assert.Contains(t, notice.Text, "2 data request(s) failed")
		assert.Contains(t, notice.Text, "channel bad is unavailable")
	})

	// A reaped job explains itself, so the panel says why it has less data than expected
	// rather than showing an opaque failure.
	t.Run("aborted with a cause", func(t *testing.T) {
		ctx, cancel := context.WithCancelCause(context.Background())
		cancel(errAsyncJobExpired)

		notice, ok := partialDataNotice(ctx, []error{context.Canceled})
		require.True(t, ok)
		assert.Contains(t, notice.Text, "Showing partial data")
		assert.Contains(t, notice.Text, "maximum async job duration")
	})

	// A context cancelled after every request already returned lost nothing, so the panel
	// must not be marked partial.
	t.Run("cancelled but nothing failed", func(t *testing.T) {
		ctx, cancel := context.WithCancelCause(context.Background())
		cancel(errAsyncJobCancelled)

		_, ok := partialDataNotice(ctx, nil)
		assert.False(t, ok)
	})
}

func TestAppendFrameNotice(t *testing.T) {
	t.Run("creates meta when absent", func(t *testing.T) {
		frame := data.NewFrame("f")
		appendFrameNotice(frame, data.Notice{Severity: data.NoticeSeverityWarning, Text: "first"})

		require.NotNil(t, frame.Meta)
		require.Len(t, frame.Meta.Notices, 1)
		assert.Equal(t, "first", frame.Meta.Notices[0].Text)
	})

	t.Run("appends to existing notices", func(t *testing.T) {
		frame := data.NewFrame("f")
		frame.Meta = &data.FrameMeta{Notices: []data.Notice{{Text: "existing"}}}
		appendFrameNotice(frame, data.Notice{Text: "second"})

		require.Len(t, frame.Meta.Notices, 2)
		assert.Equal(t, "second", frame.Meta.Notices[1].Text)
	})

	t.Run("tolerates a nil frame", func(t *testing.T) {
		appendFrameNotice(nil, data.Notice{Text: "ignored"})
	})
}

// ---------------------------------------------------------------------------
// query-level behaviour
// ---------------------------------------------------------------------------

// A panic must surface as an error rather than as a silently empty panel. Before this the
// deferred recover only logged, so query returned the zero DataResponse and the async job
// recorded a successful result with no frames.
func TestQuery_PanicBecomesAnError(t *testing.T) {
	ds := &SiftDatasource{} // nil httpClient and nil settings force a panic inside the query path

	res := ds.query(context.Background(), backend.PluginContext{}, testDataQuery(), queryModel{
		ChannelDataQueries: []channelDataQuery{{
			AssetQueries:   []assetQuery{{AssetId: "asset1"}},
			ChannelQueries: []channelQuery{{ChannelId: "channel1"}},
		}},
	})

	require.NotNil(t, res.Error)
	assert.Contains(t, res.Error.Error(), "panic while running query")
	assert.Equal(t, backend.StatusInternal, res.Status)
	assert.Empty(t, res.Frames)
}

func TestRunsSynchronously(t *testing.T) {
	cases := []struct {
		name    string
		headers map[string]string
		want    bool
	}{
		{"browser panel query", nil, false},
		{"alert rule", map[string]string{"FromAlert": "true"}, true},
		{"alert rule mixed case", map[string]string{"FromAlert": "True"}, true},
		{"server-side expression", map[string]string{"http_X-Grafana-From-Expr": "true"}, true},
		{"unrelated header", map[string]string{"http_X-Other": "true"}, false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, runsSynchronously(&backend.QueryDataRequest{Headers: tc.headers}))
		})
	}

	assert.False(t, runsSynchronously(nil))
}
