package plugin

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/data"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ---------------------------------------------------------------------------
// asyncJobStore unit tests
// ---------------------------------------------------------------------------

func TestAsyncJobStore_CreateAndGet(t *testing.T) {
	store := newAsyncJobStore(defaultMaxConcurrentAsyncQueries)
	defer store.stop()

	_, cancel := context.WithCancel(context.Background())
	id := store.create(cancel)

	require.NotEmpty(t, id)

	job, ok := store.get(id)
	require.True(t, ok)
	assert.Equal(t, asyncJobStatusStarted, job.Status)
	assert.WithinDuration(t, time.Now(), job.CreatedAt, 2*time.Second)
}

func TestAsyncJobStore_GetNonExistent(t *testing.T) {
	store := newAsyncJobStore(defaultMaxConcurrentAsyncQueries)
	defer store.stop()

	_, ok := store.get("does-not-exist")
	assert.False(t, ok)
}

func TestAsyncJobStore_Complete(t *testing.T) {
	store := newAsyncJobStore(defaultMaxConcurrentAsyncQueries)
	defer store.stop()

	_, cancel := context.WithCancel(context.Background())
	id := store.create(cancel)

	frames := []*data.Frame{data.NewFrame("test-frame")}
	store.complete(id, frames)

	job, ok := store.get(id)
	require.True(t, ok)
	assert.Equal(t, asyncJobStatusComplete, job.Status)
	require.Len(t, job.Frames, 1)
	assert.Equal(t, "test-frame", job.Frames[0].Name)
}

func TestAsyncJobStore_Fail(t *testing.T) {
	store := newAsyncJobStore(defaultMaxConcurrentAsyncQueries)
	defer store.stop()

	_, cancel := context.WithCancel(context.Background())
	id := store.create(cancel)

	store.fail(id, "something went wrong")

	job, ok := store.get(id)
	require.True(t, ok)
	assert.Equal(t, asyncJobStatusError, job.Status)
	assert.Equal(t, "something went wrong", job.Error)
}

func TestAsyncJobStore_Cancel(t *testing.T) {
	store := newAsyncJobStore(defaultMaxConcurrentAsyncQueries)
	defer store.stop()

	ctx, cancel := context.WithCancel(context.Background())
	id := store.create(cancel)

	// Cancel should return true and remove the job
	ok := store.cancel(id)
	assert.True(t, ok)

	// Context should be cancelled
	select {
	case <-ctx.Done():
		// expected
	default:
		t.Fatal("expected context to be cancelled")
	}

	// Job should be gone
	_, found := store.get(id)
	assert.False(t, found)
}

func TestAsyncJobStore_CancelNonExistent(t *testing.T) {
	store := newAsyncJobStore(defaultMaxConcurrentAsyncQueries)
	defer store.stop()

	ok := store.cancel("does-not-exist")
	assert.False(t, ok)
}

func TestAsyncJobStore_CompleteNonExistent(t *testing.T) {
	store := newAsyncJobStore(defaultMaxConcurrentAsyncQueries)
	defer store.stop()

	// Should not panic
	store.complete("does-not-exist", nil)
	store.fail("does-not-exist", "error")
}

// ---------------------------------------------------------------------------
// asyncStatusFrame tests
// ---------------------------------------------------------------------------

func TestAsyncStatusFrame(t *testing.T) {
	frame := asyncStatusFrame("A", "query-123", "started")

	assert.Equal(t, "async-status", frame.Name)
	assert.Equal(t, "A", frame.RefID)
	require.NotNil(t, frame.Meta)

	custom, ok := frame.Meta.Custom.(asyncCustomMeta)
	require.True(t, ok)
	assert.Equal(t, "query-123", custom.QueryID)
	assert.Equal(t, "started", custom.Status)
}

func TestAsyncStatusFrame_JSONSerialization(t *testing.T) {
	frame := asyncStatusFrame("B", "q-456", "running")

	customBytes, err := json.Marshal(frame.Meta.Custom)
	require.NoError(t, err)

	var parsed map[string]string
	err = json.Unmarshal(customBytes, &parsed)
	require.NoError(t, err)

	assert.Equal(t, "q-456", parsed["queryID"])
	assert.Equal(t, "running", parsed["status"])
}

// ---------------------------------------------------------------------------
// pollAsyncQuery tests
// ---------------------------------------------------------------------------

func TestPollAsyncQuery_Running(t *testing.T) {
	store := newAsyncJobStore(defaultMaxConcurrentAsyncQueries)
	defer store.stop()

	ds := &SiftDatasource{asyncJobs: store}

	_, cancel := context.WithCancel(context.Background())
	id := store.create(cancel)

	resp := ds.pollAsyncQuery("A", id)
	require.Nil(t, resp.Error)
	require.Len(t, resp.Frames, 1)

	custom, ok := resp.Frames[0].Meta.Custom.(asyncCustomMeta)
	require.True(t, ok)
	assert.Equal(t, asyncJobStatusRunning, custom.Status)
	assert.Equal(t, id, custom.QueryID)
}

func TestPollAsyncQuery_Complete(t *testing.T) {
	store := newAsyncJobStore(defaultMaxConcurrentAsyncQueries)
	defer store.stop()

	ds := &SiftDatasource{asyncJobs: store}

	_, cancel := context.WithCancel(context.Background())
	id := store.create(cancel)

	resultFrame := data.NewFrame("result")
	resultFrame.Fields = append(resultFrame.Fields, data.NewField("time", nil, []time.Time{time.Now()}))
	store.complete(id, []*data.Frame{resultFrame})

	resp := ds.pollAsyncQuery("A", id)
	require.Nil(t, resp.Error)
	require.Len(t, resp.Frames, 1)
	assert.Equal(t, "result", resp.Frames[0].Name)
}

func TestPollAsyncQuery_Error(t *testing.T) {
	store := newAsyncJobStore(defaultMaxConcurrentAsyncQueries)
	defer store.stop()

	ds := &SiftDatasource{asyncJobs: store}

	_, cancel := context.WithCancel(context.Background())
	id := store.create(cancel)
	store.fail(id, "query timeout")

	resp := ds.pollAsyncQuery("A", id)
	require.NotNil(t, resp.Error)
	assert.Contains(t, resp.Error.Error(), "query timeout")
}

func TestPollAsyncQuery_NotFound(t *testing.T) {
	store := newAsyncJobStore(defaultMaxConcurrentAsyncQueries)
	defer store.stop()

	ds := &SiftDatasource{asyncJobs: store}

	resp := ds.pollAsyncQuery("A", "nonexistent-id")
	require.NotNil(t, resp.Error)
	assert.Contains(t, resp.Error.Error(), "async query not found")
}

// ---------------------------------------------------------------------------
// handleAsyncQuery routing tests
// ---------------------------------------------------------------------------

func TestHandleAsyncQuery_RoutesToPoll_WhenQueryIDPresent(t *testing.T) {
	store := newAsyncJobStore(defaultMaxConcurrentAsyncQueries)
	defer store.stop()

	ds := &SiftDatasource{asyncJobs: store}

	_, cancel := context.WithCancel(context.Background())
	id := store.create(cancel)
	store.complete(id, []*data.Frame{data.NewFrame("done")})

	queryJSON, _ := json.Marshal(map[string]interface{}{
		"queryID":      id,
		"queryVersion": "2.1",
		"refId":        "A",
	})

	q := backend.DataQuery{
		RefID: "A",
		JSON:  queryJSON,
	}

	resp := ds.handleAsyncQuery(backend.PluginContext{}, q, queryModel{})
	require.Nil(t, resp.Error)
	require.Len(t, resp.Frames, 1)
	assert.Equal(t, "done", resp.Frames[0].Name)
}

func TestHandleAsyncQuery_RoutesToStart_WhenNoQueryID(t *testing.T) {
	store := newAsyncJobStore(defaultMaxConcurrentAsyncQueries)
	defer store.stop()

	ds := &SiftDatasource{asyncJobs: store}

	queryJSON, _ := json.Marshal(map[string]interface{}{
		"queryVersion": "2.1",
		"refId":        "A",
	})

	q := backend.DataQuery{
		RefID: "A",
		JSON:  queryJSON,
	}

	resp := ds.handleAsyncQuery(backend.PluginContext{}, q, queryModel{})

	// Should return a "started" status frame
	require.Nil(t, resp.Error)
	require.Len(t, resp.Frames, 1)

	custom, ok := resp.Frames[0].Meta.Custom.(asyncCustomMeta)
	require.True(t, ok)
	assert.Equal(t, asyncJobStatusStarted, custom.Status)
	assert.NotEmpty(t, custom.QueryID)
	assert.Equal(t, "A", resp.Frames[0].RefID)
}

// ---------------------------------------------------------------------------
// callAsyncQueryCancel CallResource handler tests
// ---------------------------------------------------------------------------

func TestCallAsyncQueryCancel_Success(t *testing.T) {
	store := newAsyncJobStore(defaultMaxConcurrentAsyncQueries)
	defer store.stop()

	ds := &SiftDatasource{asyncJobs: store}

	ctx, cancel := context.WithCancel(context.Background())
	id := store.create(cancel)

	body, _ := json.Marshal(map[string]string{"queryId": id})
	req := &backend.CallResourceRequest{
		PluginContext: backend.PluginContext{},
		Path:         "cancel",
		Method:       http.MethodPost,
		Body:         body,
	}

	sender := &mockCallResourceResponseSender{}
	err := ds.callAsyncQueryCancel(context.Background(), req, sender)

	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, sender.status)
	assert.Contains(t, string(sender.body), "cancelled")

	// Context should be cancelled
	select {
	case <-ctx.Done():
		// expected
	default:
		t.Fatal("expected context to be cancelled after cancel call")
	}

	// Job should no longer exist
	_, found := store.get(id)
	assert.False(t, found)
}

func TestCallAsyncQueryCancel_NotFound(t *testing.T) {
	store := newAsyncJobStore(defaultMaxConcurrentAsyncQueries)
	defer store.stop()

	ds := &SiftDatasource{asyncJobs: store}

	body, _ := json.Marshal(map[string]string{"queryId": "nonexistent"})
	req := &backend.CallResourceRequest{
		PluginContext: backend.PluginContext{},
		Path:         "cancel",
		Method:       http.MethodPost,
		Body:         body,
	}

	sender := &mockCallResourceResponseSender{}
	err := ds.callAsyncQueryCancel(context.Background(), req, sender)

	require.NoError(t, err)
	assert.Equal(t, http.StatusNotFound, sender.status)
}

func TestCallAsyncQueryCancel_MissingQueryId(t *testing.T) {
	store := newAsyncJobStore(defaultMaxConcurrentAsyncQueries)
	defer store.stop()

	ds := &SiftDatasource{asyncJobs: store}

	req := &backend.CallResourceRequest{
		PluginContext: backend.PluginContext{},
		Path:         "cancel",
		Method:       http.MethodPost,
		Body:         []byte(`{}`),
	}

	sender := &mockCallResourceResponseSender{}
	err := ds.callAsyncQueryCancel(context.Background(), req, sender)

	require.NoError(t, err)
	assert.Equal(t, http.StatusBadRequest, sender.status)
}

func TestCallAsyncQueryCancel_InvalidBody(t *testing.T) {
	store := newAsyncJobStore(defaultMaxConcurrentAsyncQueries)
	defer store.stop()

	ds := &SiftDatasource{asyncJobs: store}

	req := &backend.CallResourceRequest{
		PluginContext: backend.PluginContext{},
		Path:         "cancel",
		Method:       http.MethodPost,
		Body:         []byte(`not json`),
	}

	sender := &mockCallResourceResponseSender{}
	err := ds.callAsyncQueryCancel(context.Background(), req, sender)

	require.NoError(t, err)
	assert.Equal(t, http.StatusBadRequest, sender.status)
}

// ---------------------------------------------------------------------------
// QueryData integration: async routing (all non-annotation queries are async)
// ---------------------------------------------------------------------------

func TestQueryData_StandardQuery_RoutesToAsync(t *testing.T) {
	store := newAsyncJobStore(defaultMaxConcurrentAsyncQueries)
	defer store.stop()

	ds := &SiftDatasource{asyncJobs: store}

	// A standard data query (no annotationType) should go through async path
	queryJSON, _ := json.Marshal(map[string]interface{}{
		"queryVersion":       "2.1",
		"refId":              "A",
		"channelDataQueries": []interface{}{},
	})

	req := &backend.QueryDataRequest{
		PluginContext: backend.PluginContext{},
		Queries: []backend.DataQuery{
			{
				RefID: "A",
				JSON:  queryJSON,
				TimeRange: backend.TimeRange{
					From: time.Now().Add(-1 * time.Hour),
					To:   time.Now(),
				},
			},
		},
	}

	resp, err := ds.QueryData(context.Background(), req)
	require.NoError(t, err)

	result, ok := resp.Responses["A"]
	require.True(t, ok)
	require.Nil(t, result.Error)
	require.Len(t, result.Frames, 1)

	// Verify the response is an async status frame with "started"
	custom, ok := result.Frames[0].Meta.Custom.(asyncCustomMeta)
	require.True(t, ok)
	assert.Equal(t, asyncJobStatusStarted, custom.Status)
	assert.NotEmpty(t, custom.QueryID)
}

func TestQueryData_PollReturnsComplete(t *testing.T) {
	store := newAsyncJobStore(defaultMaxConcurrentAsyncQueries)
	defer store.stop()

	ds := &SiftDatasource{asyncJobs: store}

	// Pre-create a completed job
	_, cancel := context.WithCancel(context.Background())
	jobID := store.create(cancel)
	resultFrame := data.NewFrame("my-result")
	resultFrame.RefID = "A"
	store.complete(jobID, []*data.Frame{resultFrame})

	// Build a poll query with queryID set
	queryJSON, _ := json.Marshal(map[string]interface{}{
		"queryVersion":       "2.1",
		"refId":              "A",
		"queryID":            jobID,
		"channelDataQueries": []interface{}{},
	})

	req := &backend.QueryDataRequest{
		PluginContext: backend.PluginContext{},
		Queries: []backend.DataQuery{
			{
				RefID: "A",
				JSON:  queryJSON,
				TimeRange: backend.TimeRange{
					From: time.Now().Add(-1 * time.Hour),
					To:   time.Now(),
				},
			},
		},
	}

	resp, err := ds.QueryData(context.Background(), req)
	require.NoError(t, err)

	result, ok := resp.Responses["A"]
	require.True(t, ok)
	require.Nil(t, result.Error)
	require.Len(t, result.Frames, 1)
	assert.Equal(t, "my-result", result.Frames[0].Name)
}

func TestQueryData_AnnotationQuery_RunsSync(t *testing.T) {
	store := newAsyncJobStore(defaultMaxConcurrentAsyncQueries)
	defer store.stop()

	ds := &SiftDatasource{asyncJobs: store}

	// An annotation query should NOT go through the async path
	queryJSON, _ := json.Marshal(map[string]interface{}{
		"queryVersion":       "2.1",
		"refId":              "A",
		"annotationType":     "annotationsQuery",
		"channelDataQueries": []interface{}{},
	})

	req := &backend.QueryDataRequest{
		PluginContext: backend.PluginContext{},
		Queries: []backend.DataQuery{
			{
				RefID: "A",
				JSON:  queryJSON,
				TimeRange: backend.TimeRange{
					From: time.Now().Add(-1 * time.Hour),
					To:   time.Now(),
				},
			},
		},
	}

	resp, err := ds.QueryData(context.Background(), req)
	require.NoError(t, err)

	result, ok := resp.Responses["A"]
	require.True(t, ok)

	// Annotation queries should not produce async-status frames
	for _, frame := range result.Frames {
		assert.NotEqual(t, "async-status", frame.Name, "annotation query should not produce async-status frames")
	}
}

// ---------------------------------------------------------------------------
// concurrency limit configuration
// ---------------------------------------------------------------------------

func TestAsyncMaxConcurrentQueries(t *testing.T) {
	t.Run("default when unset", func(t *testing.T) {
		t.Setenv(maxConcurrentAsyncQueriesEnvVar, "")
		assert.Equal(t, int64(defaultMaxConcurrentAsyncQueries), asyncMaxConcurrentQueries())
	})
	t.Run("valid override", func(t *testing.T) {
		t.Setenv(maxConcurrentAsyncQueriesEnvVar, "16")
		assert.Equal(t, int64(16), asyncMaxConcurrentQueries())
	})
	t.Run("non-numeric falls back to default", func(t *testing.T) {
		t.Setenv(maxConcurrentAsyncQueriesEnvVar, "not-a-number")
		assert.Equal(t, int64(defaultMaxConcurrentAsyncQueries), asyncMaxConcurrentQueries())
	})
	t.Run("non-positive falls back to default", func(t *testing.T) {
		t.Setenv(maxConcurrentAsyncQueriesEnvVar, "0")
		assert.Equal(t, int64(defaultMaxConcurrentAsyncQueries), asyncMaxConcurrentQueries())
	})
}

func TestNewAsyncJobStore_ConcurrencyBound(t *testing.T) {
	store := newAsyncJobStore(2)
	defer store.stop()

	require.True(t, store.sem.TryAcquire(2))
	assert.False(t, store.sem.TryAcquire(1), "should be at the concurrency limit")
	store.sem.Release(1)
	assert.True(t, store.sem.TryAcquire(1), "permit should be reclaimable after release")
}

func TestNewAsyncJobStore_ClampsToMinimum(t *testing.T) {
	// A non-positive limit is clamped to at least 1 so the store is always usable.
	store := newAsyncJobStore(0)
	defer store.stop()
	assert.True(t, store.sem.TryAcquire(1))
	assert.False(t, store.sem.TryAcquire(1))
}

// ---------------------------------------------------------------------------
// poll removes terminal jobs (delivered once, freed without waiting for reaper)
// ---------------------------------------------------------------------------

func TestPoll_RemovesCompletedJob(t *testing.T) {
	store := newAsyncJobStore(defaultMaxConcurrentAsyncQueries)
	defer store.stop()

	_, cancel := context.WithCancel(context.Background())
	id := store.create(cancel)
	store.complete(id, []*data.Frame{data.NewFrame("done")})

	status, frames, _, ok := store.poll(id)
	require.True(t, ok)
	assert.Equal(t, asyncJobStatusComplete, status)
	require.Len(t, frames, 1)

	// Gone after its terminal result is delivered.
	_, found := store.get(id)
	assert.False(t, found)
	_, _, _, ok = store.poll(id)
	assert.False(t, ok)
}

func TestPoll_RemovesErroredJob(t *testing.T) {
	store := newAsyncJobStore(defaultMaxConcurrentAsyncQueries)
	defer store.stop()

	_, cancel := context.WithCancel(context.Background())
	id := store.create(cancel)
	store.fail(id, "boom")

	status, _, errMsg, ok := store.poll(id)
	require.True(t, ok)
	assert.Equal(t, asyncJobStatusError, status)
	assert.Equal(t, "boom", errMsg)

	_, found := store.get(id)
	assert.False(t, found)
}

func TestPoll_KeepsRunningJob(t *testing.T) {
	store := newAsyncJobStore(defaultMaxConcurrentAsyncQueries)
	defer store.stop()

	_, cancel := context.WithCancel(context.Background())
	id := store.create(cancel)

	status, _, _, ok := store.poll(id)
	require.True(t, ok)
	assert.Equal(t, asyncJobStatusStarted, status)

	// Still tracked so the client can keep polling.
	_, found := store.get(id)
	assert.True(t, found)
}

// ---------------------------------------------------------------------------
// startAsyncQuery honors the concurrency bound and cancellation
// ---------------------------------------------------------------------------

func TestStartAsyncQuery_GatedByConcurrencyLimit(t *testing.T) {
	store := newAsyncJobStore(1)
	defer store.stop()
	ds := &SiftDatasource{asyncJobs: store}

	// Saturate the only slot so a new query must wait.
	require.True(t, store.sem.TryAcquire(1))

	q := backend.DataQuery{
		RefID:     "A",
		JSON:      []byte(`{"refId":"A"}`),
		TimeRange: backend.TimeRange{From: time.Now().Add(-time.Hour), To: time.Now()},
	}
	resp := ds.startAsyncQuery(backend.PluginContext{}, q, queryModel{})
	id := resp.Frames[0].Meta.Custom.(asyncCustomMeta).QueryID

	// Slot held: the goroutine is blocked on Acquire and cannot reach a terminal state.
	time.Sleep(50 * time.Millisecond)
	status, _, _, ok := store.poll(id)
	require.True(t, ok)
	assert.Equal(t, asyncJobStatusStarted, status)

	// Free the slot; the query now runs to a terminal state (empty query completes fast).
	store.sem.Release(1)
	assert.Eventually(t, func() bool {
		status, _, _, ok := store.poll(id)
		return !ok || status == asyncJobStatusComplete || status == asyncJobStatusError
	}, 2*time.Second, 10*time.Millisecond)
}

func TestStartAsyncQuery_CancelWhileQueued(t *testing.T) {
	store := newAsyncJobStore(1)
	defer store.stop()
	ds := &SiftDatasource{asyncJobs: store}

	// Saturate the slot so the new query queues on Acquire.
	require.True(t, store.sem.TryAcquire(1))

	q := backend.DataQuery{
		RefID:     "A",
		JSON:      []byte(`{"refId":"A"}`),
		TimeRange: backend.TimeRange{From: time.Now().Add(-time.Hour), To: time.Now()},
	}
	resp := ds.startAsyncQuery(backend.PluginContext{}, q, queryModel{})
	id := resp.Frames[0].Meta.Custom.(asyncCustomMeta).QueryID

	// Cancel while queued: the goroutine's Acquire observes the cancelled context and exits
	// without executing the backend query. The job is removed and the test completing proves
	// there is no deadlock.
	require.True(t, store.cancel(id))
	assert.Eventually(t, func() bool {
		_, ok := store.get(id)
		return !ok
	}, 2*time.Second, 10*time.Millisecond)
}
