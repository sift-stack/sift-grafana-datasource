package plugin

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/data"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// testAsyncConfig is the default configuration, used by every test that does not care
// about the tunables themselves.
func testAsyncConfig() asyncConfig {
	return asyncConfig{
		MaxConcurrent: defaultMaxConcurrentAsyncQueries,
		IdleTimeout:   defaultAsyncJobIdleTimeout,
		JobTTL:        defaultAsyncJobTTL,
	}
}

func testStore(t *testing.T) *asyncJobStore {
	t.Helper()
	store := newAsyncJobStore(testAsyncConfig())
	t.Cleanup(store.stop)
	return store
}

// newTestJob creates a job and returns its id plus the context the job would run on.
func newTestJob(t *testing.T, store *asyncJobStore) (string, context.Context) {
	t.Helper()
	ctx, cancel := context.WithCancelCause(context.Background())
	t.Cleanup(func() { cancel(nil) })
	return store.create(cancel), ctx
}

func frameResponse(names ...string) backend.DataResponse {
	frames := make(data.Frames, 0, len(names))
	for _, name := range names {
		frames = append(frames, data.NewFrame(name))
	}
	return backend.DataResponse{Frames: frames}
}

// ---------------------------------------------------------------------------
// asyncJobStore unit tests
// ---------------------------------------------------------------------------

func TestAsyncJobStore_CreateAndGet(t *testing.T) {
	store := testStore(t)
	id, _ := newTestJob(t, store)

	require.NotEmpty(t, id)

	job, ok := store.get(id)
	require.True(t, ok)
	assert.Equal(t, asyncJobStatusStarted, job.Status)
	assert.WithinDuration(t, time.Now(), job.CreatedAt, 2*time.Second)
	assert.True(t, job.StartedAt.IsZero(), "a queued job has not started yet")
}

func TestAsyncJobStore_GetNonExistent(t *testing.T) {
	store := testStore(t)

	_, ok := store.get("does-not-exist")
	assert.False(t, ok)
}

func TestAsyncJobStore_MarkStarted(t *testing.T) {
	store := testStore(t)
	id, _ := newTestJob(t, store)

	store.markStarted(id)

	job, ok := store.get(id)
	require.True(t, ok)
	assert.Equal(t, asyncJobStatusRunning, job.Status)
	assert.False(t, job.StartedAt.IsZero())
}

func TestAsyncJobStore_FinishWithFrames(t *testing.T) {
	store := testStore(t)
	id, _ := newTestJob(t, store)

	store.finish(id, frameResponse("test-frame"))

	job, ok := store.get(id)
	require.True(t, ok)
	assert.Equal(t, asyncJobStatusComplete, job.Status)
	require.Len(t, job.Response.Frames, 1)
	assert.Equal(t, "test-frame", job.Response.Frames[0].Name)
}

func TestAsyncJobStore_FinishWithError(t *testing.T) {
	store := testStore(t)
	id, _ := newTestJob(t, store)

	store.finish(id, backend.ErrDataResponse(backend.StatusInternal, "something went wrong"))

	job, ok := store.get(id)
	require.True(t, ok)
	assert.Equal(t, asyncJobStatusError, job.Status)
	require.NotNil(t, job.Response.Error)
	assert.Contains(t, job.Response.Error.Error(), "something went wrong")
}

// A response carrying both frames and an error is partial data, not a failure: the client
// must still receive the frames.
func TestAsyncJobStore_FinishPartialCountsAsComplete(t *testing.T) {
	store := testStore(t)
	id, _ := newTestJob(t, store)

	res := frameResponse("partial")
	res.Error = errors.New("one channel failed")
	store.finish(id, res)

	job, ok := store.get(id)
	require.True(t, ok)
	assert.Equal(t, asyncJobStatusComplete, job.Status)
}

func TestAsyncJobStore_Cancel(t *testing.T) {
	store := testStore(t)
	id, ctx := newTestJob(t, store)

	assert.True(t, store.cancel(id))

	select {
	case <-ctx.Done():
		assert.ErrorIs(t, context.Cause(ctx), errAsyncJobCancelled)
	default:
		t.Fatal("expected context to be cancelled")
	}

	_, found := store.get(id)
	assert.False(t, found, "a client cancel removes the job; nobody is left to poll it")
}

func TestAsyncJobStore_CancelNonExistent(t *testing.T) {
	store := testStore(t)
	assert.False(t, store.cancel("does-not-exist"))
}

func TestAsyncJobStore_FinishNonExistent(t *testing.T) {
	store := testStore(t)
	// Should not panic.
	store.finish("does-not-exist", frameResponse())
	store.finish("does-not-exist", backend.ErrDataResponse(backend.StatusInternal, "error"))
}

func TestAsyncJobStore_StopIsIdempotentAndCancels(t *testing.T) {
	store := newAsyncJobStore(testAsyncConfig())
	_, ctx := newTestJob(t, store)

	store.stop()
	store.stop() // a second Dispose must not panic on a closed channel

	select {
	case <-ctx.Done():
		assert.ErrorIs(t, context.Cause(ctx), errAsyncStoreClosed)
	default:
		t.Fatal("expected stop to cancel outstanding jobs")
	}
	assert.Empty(t, store.jobs)
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

	// @grafana/async-query-data requires both keys, with this exact casing, to recognise
	// the frame as an async status marker and keep polling.
	assert.Equal(t, "q-456", parsed["queryID"])
	assert.Equal(t, "running", parsed["status"])
}

// ---------------------------------------------------------------------------
// pollAsyncQuery tests
// ---------------------------------------------------------------------------

func TestPollAsyncQuery_Running(t *testing.T) {
	store := testStore(t)
	ds := &SiftDatasource{asyncJobs: store}
	id, _ := newTestJob(t, store)

	resp := ds.pollAsyncQuery("A", id)
	require.Nil(t, resp.Error)
	require.Len(t, resp.Frames, 1)

	custom, ok := resp.Frames[0].Meta.Custom.(asyncCustomMeta)
	require.True(t, ok)
	assert.Equal(t, asyncJobStatusRunning, custom.Status)
	assert.Equal(t, id, custom.QueryID)
}

func TestPollAsyncQuery_Complete(t *testing.T) {
	store := testStore(t)
	ds := &SiftDatasource{asyncJobs: store}
	id, _ := newTestJob(t, store)

	resultFrame := data.NewFrame("result")
	resultFrame.Fields = append(resultFrame.Fields, data.NewField("time", nil, []time.Time{time.Now()}))
	store.finish(id, backend.DataResponse{Frames: data.Frames{resultFrame}})

	resp := ds.pollAsyncQuery("A", id)
	require.Nil(t, resp.Error)
	require.Len(t, resp.Frames, 1)
	assert.Equal(t, "result", resp.Frames[0].Name)
}

func TestPollAsyncQuery_Error(t *testing.T) {
	store := testStore(t)
	ds := &SiftDatasource{asyncJobs: store}
	id, _ := newTestJob(t, store)

	store.finish(id, backend.ErrDataResponse(backend.StatusInternal, "query timeout"))

	resp := ds.pollAsyncQuery("A", id)
	require.NotNil(t, resp.Error)
	assert.Contains(t, resp.Error.Error(), "query timeout")
	assert.Equal(t, backend.StatusInternal, resp.Status)
}

// A reaped job is a server-side timeout, so it must not be reported to Grafana as a
// client error: that would book a slow Sift read as a 4xx in the plugin's request metrics.
func TestPollAsyncQuery_TimeoutClassification(t *testing.T) {
	store := testStore(t)
	ds := &SiftDatasource{asyncJobs: store}
	id, _ := newTestJob(t, store)

	store.finish(id, contextCauseResponse(errAsyncJobExpired))

	resp := ds.pollAsyncQuery("A", id)
	require.NotNil(t, resp.Error)
	assert.Equal(t, backend.StatusTimeout, resp.Status)
	assert.Equal(t, backend.ErrorSourceDownstream, resp.ErrorSource)
	assert.Contains(t, resp.Error.Error(), "maximum async job duration")
}

// A reaped job that had already collected some rows delivers them, with the reason
// attached as a notice, instead of throwing the data away.
func TestPollAsyncQuery_PartialDataAfterReap(t *testing.T) {
	store := testStore(t)
	ds := &SiftDatasource{asyncJobs: store}
	id, _ := newTestJob(t, store)

	frame := data.NewFrame("partial")
	appendFrameNotice(frame, data.Notice{
		Severity: data.NoticeSeverityWarning,
		Text:     "Showing partial data: " + errAsyncJobExpired.Error(),
	})
	store.finish(id, backend.DataResponse{Frames: data.Frames{frame}})

	resp := ds.pollAsyncQuery("A", id)
	require.Nil(t, resp.Error, "partial data is delivered as data, not as a panel error")
	require.Len(t, resp.Frames, 1)
	require.Len(t, resp.Frames[0].Meta.Notices, 1)
	assert.Contains(t, resp.Frames[0].Meta.Notices[0].Text, "partial data")
}

func TestPollAsyncQuery_NotFound(t *testing.T) {
	store := testStore(t)
	ds := &SiftDatasource{asyncJobs: store}

	resp := ds.pollAsyncQuery("A", "nonexistent-id")
	require.NotNil(t, resp.Error)
	assert.Contains(t, resp.Error.Error(), "async query not found")
	assert.Equal(t, backend.StatusBadRequest, resp.Status)
}

// ---------------------------------------------------------------------------
// handleAsyncQuery routing tests
// ---------------------------------------------------------------------------

func TestHandleAsyncQuery_RoutesToPoll_WhenQueryIDPresent(t *testing.T) {
	store := testStore(t)
	ds := &SiftDatasource{asyncJobs: store}
	id, _ := newTestJob(t, store)
	store.finish(id, frameResponse("done"))

	queryJSON, _ := json.Marshal(map[string]interface{}{
		"queryID":      id,
		"queryVersion": "2.1",
		"refId":        "A",
	})

	resp := ds.handleAsyncQuery(backend.PluginContext{}, backend.DataQuery{RefID: "A", JSON: queryJSON}, queryModel{})
	require.Nil(t, resp.Error)
	require.Len(t, resp.Frames, 1)
	assert.Equal(t, "done", resp.Frames[0].Name)
}

func TestHandleAsyncQuery_RoutesToStart_WhenNoQueryID(t *testing.T) {
	store := testStore(t)
	ds := &SiftDatasource{asyncJobs: store}

	queryJSON, _ := json.Marshal(map[string]interface{}{
		"queryVersion": "2.1",
		"refId":        "A",
	})

	resp := ds.handleAsyncQuery(backend.PluginContext{}, backend.DataQuery{RefID: "A", JSON: queryJSON}, queryModel{})

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

func newCancelRequest(body []byte) *backend.CallResourceRequest {
	return &backend.CallResourceRequest{
		PluginContext: backend.PluginContext{},
		Path:          "cancel",
		Method:        http.MethodPost,
		Body:          body,
	}
}

func TestCallAsyncQueryCancel_Success(t *testing.T) {
	store := testStore(t)
	ds := &SiftDatasource{asyncJobs: store}
	id, ctx := newTestJob(t, store)

	body, _ := json.Marshal(map[string]string{"queryId": id})
	sender := &mockCallResourceResponseSender{}
	require.NoError(t, ds.callAsyncQueryCancel(context.Background(), newCancelRequest(body), sender))

	assert.Equal(t, http.StatusOK, sender.status)
	assert.Contains(t, string(sender.body), "cancelled")

	select {
	case <-ctx.Done():
	default:
		t.Fatal("expected context to be cancelled after cancel call")
	}

	_, found := store.get(id)
	assert.False(t, found)
}

func TestCallAsyncQueryCancel_NotFound(t *testing.T) {
	store := testStore(t)
	ds := &SiftDatasource{asyncJobs: store}

	body, _ := json.Marshal(map[string]string{"queryId": "nonexistent"})
	sender := &mockCallResourceResponseSender{}
	require.NoError(t, ds.callAsyncQueryCancel(context.Background(), newCancelRequest(body), sender))

	assert.Equal(t, http.StatusNotFound, sender.status)
}

func TestCallAsyncQueryCancel_MissingQueryId(t *testing.T) {
	store := testStore(t)
	ds := &SiftDatasource{asyncJobs: store}

	sender := &mockCallResourceResponseSender{}
	require.NoError(t, ds.callAsyncQueryCancel(context.Background(), newCancelRequest([]byte(`{}`)), sender))

	assert.Equal(t, http.StatusBadRequest, sender.status)
}

func TestCallAsyncQueryCancel_InvalidBody(t *testing.T) {
	store := testStore(t)
	ds := &SiftDatasource{asyncJobs: store}

	sender := &mockCallResourceResponseSender{}
	require.NoError(t, ds.callAsyncQueryCancel(context.Background(), newCancelRequest([]byte(`not json`)), sender))

	assert.Equal(t, http.StatusBadRequest, sender.status)
}

// ---------------------------------------------------------------------------
// QueryData integration: async routing
// ---------------------------------------------------------------------------

func queryDataRequest(t *testing.T, queryJSON []byte) *backend.QueryDataRequest {
	t.Helper()
	return &backend.QueryDataRequest{
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
}

func TestQueryData_StandardQuery_RoutesToAsync(t *testing.T) {
	store := testStore(t)
	ds := &SiftDatasource{asyncJobs: store}

	queryJSON, _ := json.Marshal(map[string]interface{}{
		"queryVersion":       "2.1",
		"refId":              "A",
		"channelDataQueries": []interface{}{},
	})

	resp, err := ds.QueryData(context.Background(), queryDataRequest(t, queryJSON))
	require.NoError(t, err)

	result, ok := resp.Responses["A"]
	require.True(t, ok)
	require.Nil(t, result.Error)
	require.Len(t, result.Frames, 1)

	custom, ok := result.Frames[0].Meta.Custom.(asyncCustomMeta)
	require.True(t, ok)
	assert.Equal(t, asyncJobStatusStarted, custom.Status)
	assert.NotEmpty(t, custom.QueryID)
}

func TestQueryData_PollReturnsComplete(t *testing.T) {
	store := testStore(t)
	ds := &SiftDatasource{asyncJobs: store}

	jobID, _ := newTestJob(t, store)
	resultFrame := data.NewFrame("my-result")
	resultFrame.RefID = "A"
	store.finish(jobID, backend.DataResponse{Frames: data.Frames{resultFrame}})

	queryJSON, _ := json.Marshal(map[string]interface{}{
		"queryVersion":       "2.1",
		"refId":              "A",
		"queryID":            jobID,
		"channelDataQueries": []interface{}{},
	})

	resp, err := ds.QueryData(context.Background(), queryDataRequest(t, queryJSON))
	require.NoError(t, err)

	result, ok := resp.Responses["A"]
	require.True(t, ok)
	require.Nil(t, result.Error)
	require.Len(t, result.Frames, 1)
	assert.Equal(t, "my-result", result.Frames[0].Name)
}

func TestQueryData_AnnotationQuery_RunsSync(t *testing.T) {
	store := testStore(t)
	ds := &SiftDatasource{asyncJobs: store}

	queryJSON, _ := json.Marshal(map[string]interface{}{
		"queryVersion":       "2.1",
		"refId":              "A",
		"annotationType":     "annotationsQuery",
		"channelDataQueries": []interface{}{},
	})

	resp, err := ds.QueryData(context.Background(), queryDataRequest(t, queryJSON))
	require.NoError(t, err)

	result, ok := resp.Responses["A"]
	require.True(t, ok)
	for _, frame := range result.Frames {
		assert.NotEqual(t, "async-status", frame.Name, "annotation query should not produce async-status frames")
	}
}

// Alert rules and server-side expressions are evaluated inside Grafana's backend, with no
// browser to poll, so they must never receive a "started" marker frame.
func TestQueryData_NonPollingCallers_RunSync(t *testing.T) {
	queryJSON, _ := json.Marshal(map[string]interface{}{
		"queryVersion":       "2.1",
		"refId":              "A",
		"channelDataQueries": []interface{}{},
	})

	cases := map[string]map[string]string{
		"alerting":   {"FromAlert": "true"},
		"expression": {"http_X-Grafana-From-Expr": "true"},
	}

	for name, headers := range cases {
		t.Run(name, func(t *testing.T) {
			store := testStore(t)
			ds := &SiftDatasource{asyncJobs: store}

			req := queryDataRequest(t, queryJSON)
			req.Headers = headers

			resp, err := ds.QueryData(context.Background(), req)
			require.NoError(t, err)

			result, ok := resp.Responses["A"]
			require.True(t, ok)
			for _, frame := range result.Frames {
				assert.NotEqual(t, "async-status", frame.Name)
			}
			assert.Empty(t, store.jobs, "no async job should have been created")
		})
	}
}

// ---------------------------------------------------------------------------
// configuration
// ---------------------------------------------------------------------------

func TestAsyncConfigFromEnv(t *testing.T) {
	t.Run("defaults when unset", func(t *testing.T) {
		t.Setenv(maxConcurrentAsyncQueriesEnvVar, "")
		t.Setenv(asyncJobTTLEnvVar, "")
		t.Setenv(asyncJobIdleTimeoutEnvVar, "")

		cfg := asyncConfigFromEnv()
		assert.Equal(t, int64(defaultMaxConcurrentAsyncQueries), cfg.MaxConcurrent)
		assert.Equal(t, defaultAsyncJobTTL, cfg.JobTTL)
		assert.Equal(t, defaultAsyncJobIdleTimeout, cfg.IdleTimeout)
	})

	t.Run("valid overrides", func(t *testing.T) {
		t.Setenv(maxConcurrentAsyncQueriesEnvVar, "16")
		t.Setenv(asyncJobTTLEnvVar, "5m")
		t.Setenv(asyncJobIdleTimeoutEnvVar, "90s")

		cfg := asyncConfigFromEnv()
		assert.Equal(t, int64(16), cfg.MaxConcurrent)
		assert.Equal(t, 5*time.Minute, cfg.JobTTL)
		assert.Equal(t, 90*time.Second, cfg.IdleTimeout)
	})

	t.Run("zero TTL disables the execution ceiling", func(t *testing.T) {
		t.Setenv(asyncJobTTLEnvVar, "0s")
		assert.Equal(t, time.Duration(0), asyncConfigFromEnv().JobTTL)
	})

	t.Run("unparseable values fall back to defaults", func(t *testing.T) {
		t.Setenv(maxConcurrentAsyncQueriesEnvVar, "not-a-number")
		t.Setenv(asyncJobTTLEnvVar, "ten minutes")
		t.Setenv(asyncJobIdleTimeoutEnvVar, "60")

		cfg := asyncConfigFromEnv()
		assert.Equal(t, int64(defaultMaxConcurrentAsyncQueries), cfg.MaxConcurrent)
		assert.Equal(t, defaultAsyncJobTTL, cfg.JobTTL)
		assert.Equal(t, defaultAsyncJobIdleTimeout, cfg.IdleTimeout)
	})

	t.Run("out of range values fall back to defaults", func(t *testing.T) {
		t.Setenv(maxConcurrentAsyncQueriesEnvVar, "0")
		t.Setenv(asyncJobIdleTimeoutEnvVar, "0s")

		cfg := asyncConfigFromEnv()
		assert.Equal(t, int64(defaultMaxConcurrentAsyncQueries), cfg.MaxConcurrent)
		assert.Equal(t, defaultAsyncJobIdleTimeout, cfg.IdleTimeout)
	})
}

func TestNewAsyncJobStore_ConcurrencyBound(t *testing.T) {
	cfg := testAsyncConfig()
	cfg.MaxConcurrent = 2
	store := newAsyncJobStore(cfg)
	defer store.stop()

	require.True(t, store.sem.TryAcquire(2))
	assert.False(t, store.sem.TryAcquire(1), "should be at the concurrency limit")
	store.sem.Release(1)
	assert.True(t, store.sem.TryAcquire(1), "permit should be reclaimable after release")
}

func TestNewAsyncJobStore_ClampsToMinimum(t *testing.T) {
	// A non-positive limit is clamped to at least 1 so the store is always usable.
	store := newAsyncJobStore(asyncConfig{MaxConcurrent: 0})
	defer store.stop()
	assert.True(t, store.sem.TryAcquire(1))
	assert.False(t, store.sem.TryAcquire(1))
	assert.Equal(t, defaultAsyncJobIdleTimeout, store.cfg.IdleTimeout)
}

// ---------------------------------------------------------------------------
// poll: delivery and tombstoning
// ---------------------------------------------------------------------------

func TestPoll_DeliversCompletedJobOnceAndFreesFrames(t *testing.T) {
	store := testStore(t)
	id, _ := newTestJob(t, store)
	store.finish(id, frameResponse("done"))

	status, res, ok := store.poll(id)
	require.True(t, ok)
	assert.Equal(t, asyncJobStatusComplete, status)
	require.Len(t, res.Frames, 1)

	job, found := store.get(id)
	require.True(t, found, "the entry survives so a duplicate poll gets a clear answer")
	assert.Empty(t, job.Response.Frames, "frames are freed once delivered")

	// A duplicate poll says so, instead of the misleading "async query not found".
	_, second, ok := store.poll(id)
	require.True(t, ok)
	require.NotNil(t, second.Error)
	assert.Contains(t, second.Error.Error(), "already delivered")
}

func TestPoll_DeliversErroredJob(t *testing.T) {
	store := testStore(t)
	id, _ := newTestJob(t, store)
	store.finish(id, backend.ErrDataResponse(backend.StatusInternal, "boom"))

	status, res, ok := store.poll(id)
	require.True(t, ok)
	assert.Equal(t, asyncJobStatusError, status)
	require.NotNil(t, res.Error)
	assert.Contains(t, res.Error.Error(), "boom")
}

func TestPoll_KeepsRunningJob(t *testing.T) {
	store := testStore(t)
	id, _ := newTestJob(t, store)

	status, res, ok := store.poll(id)
	require.True(t, ok)
	assert.Equal(t, asyncJobStatusStarted, status)
	assert.Empty(t, res.Frames)

	_, found := store.get(id)
	assert.True(t, found)
}

func TestPoll_UpdatesLastPolledAt(t *testing.T) {
	store := testStore(t)
	id, _ := newTestJob(t, store)

	store.jobs[id].LastPolledAt = time.Now().Add(-store.cfg.IdleTimeout)
	before := store.jobs[id].LastPolledAt

	_, _, ok := store.poll(id)
	require.True(t, ok)
	assert.True(t, store.jobs[id].LastPolledAt.After(before), "poll should refresh LastPolledAt")
}

// ---------------------------------------------------------------------------
// startAsyncQuery honors the concurrency bound and cancellation
// ---------------------------------------------------------------------------

func TestStartAsyncQuery_GatedByConcurrencyLimit(t *testing.T) {
	cfg := testAsyncConfig()
	cfg.MaxConcurrent = 1
	store := newAsyncJobStore(cfg)
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
	status, _, ok := store.poll(id)
	require.True(t, ok)
	assert.Equal(t, asyncJobStatusStarted, status)
	job, _ := store.get(id)
	assert.True(t, job.StartedAt.IsZero(), "a queued job has not started, so the TTL clock has not begun")

	// Free the slot; the query now runs to a terminal state (an empty query completes fast).
	store.sem.Release(1)
	assert.Eventually(t, func() bool {
		status, _, ok := store.poll(id)
		return !ok || isTerminalAsyncStatus(status)
	}, 2*time.Second, 10*time.Millisecond)
}

func TestStartAsyncQuery_CancelWhileQueued(t *testing.T) {
	cfg := testAsyncConfig()
	cfg.MaxConcurrent = 1
	store := newAsyncJobStore(cfg)
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

// ---------------------------------------------------------------------------
// idle / TTL reaping (server-side reclamation of abandoned jobs)
// ---------------------------------------------------------------------------

// A reaped job is cancelled but kept, so its goroutine can unwind the backend read and
// record whatever data it collected. Deleting it here is what produced the opaque
// "async query not found" the client used to see.
func TestReapOnce_CancelsIdleJobWithoutDeletingIt(t *testing.T) {
	store := testStore(t)
	id, ctx := newTestJob(t, store)
	store.markStarted(id)
	store.jobs[id].LastPolledAt = time.Now().Add(-2 * store.cfg.IdleTimeout)

	store.reapOnce(time.Now())

	job, ok := store.get(id)
	require.True(t, ok, "a reaped job is kept until it records its terminal state")
	assert.False(t, job.reapedAt.IsZero())
	select {
	case <-ctx.Done():
		assert.ErrorIs(t, context.Cause(ctx), errAsyncJobIdle)
	default:
		t.Fatal("expected job context to be cancelled on idle reap")
	}
}

func TestReapOnce_KeepsRecentlyPolledJob(t *testing.T) {
	store := testStore(t)
	id, ctx := newTestJob(t, store) // LastPolledAt = now

	store.reapOnce(time.Now())

	job, ok := store.get(id)
	require.True(t, ok, "recently-polled job should be kept")
	assert.True(t, job.reapedAt.IsZero())
	assert.NoError(t, ctx.Err())
}

// The TTL is measured from the moment the job acquired a slot, so time spent queued
// behind other work is not charged against it.
func TestReapOnce_TtlMeasuredFromExecutionStart(t *testing.T) {
	cfg := testAsyncConfig()
	cfg.JobTTL = time.Minute
	store := newAsyncJobStore(cfg)
	defer store.stop()

	id, ctx := newTestJob(t, store)
	now := time.Now()
	// Created long ago but only just started running, and still being polled.
	store.jobs[id].CreatedAt = now.Add(-time.Hour)
	store.jobs[id].StartedAt = now.Add(-time.Second)
	store.jobs[id].LastPolledAt = now
	store.jobs[id].Status = asyncJobStatusRunning

	store.reapOnce(now)
	assert.NoError(t, ctx.Err(), "a long queue wait must not expire a job that just started")

	// Once it has genuinely been executing past the TTL, it is reaped.
	store.jobs[id].StartedAt = now.Add(-2 * cfg.JobTTL)
	store.reapOnce(now)
	require.Error(t, ctx.Err())
	assert.ErrorIs(t, context.Cause(ctx), errAsyncJobExpired)
}

func TestReapOnce_ZeroTtlNeverExpires(t *testing.T) {
	cfg := testAsyncConfig()
	cfg.JobTTL = 0
	store := newAsyncJobStore(cfg)
	defer store.stop()

	id, ctx := newTestJob(t, store)
	now := time.Now()
	store.jobs[id].StartedAt = now.Add(-24 * time.Hour)
	store.jobs[id].LastPolledAt = now
	store.jobs[id].Status = asyncJobStatusRunning

	store.reapOnce(now)

	assert.NoError(t, ctx.Err(), "a TTL of 0 lets a query run for as long as the client polls it")
	_, ok := store.get(id)
	assert.True(t, ok)
}

func TestReapOnce_QueuedJobIsStillIdleReaped(t *testing.T) {
	cfg := testAsyncConfig()
	cfg.JobTTL = 0
	store := newAsyncJobStore(cfg)
	defer store.stop()

	id, ctx := newTestJob(t, store) // never started
	store.jobs[id].LastPolledAt = time.Now().Add(-2 * store.cfg.IdleTimeout)

	store.reapOnce(time.Now())

	require.Error(t, ctx.Err())
	assert.ErrorIs(t, context.Cause(ctx), errAsyncJobIdle)
}

func TestReapOnce_DeletesUnpolledTerminalJob(t *testing.T) {
	store := testStore(t)
	id, _ := newTestJob(t, store)
	store.finish(id, frameResponse("done"))
	store.jobs[id].LastPolledAt = time.Now().Add(-2 * store.cfg.IdleTimeout)

	store.reapOnce(time.Now())

	_, ok := store.get(id)
	assert.False(t, ok, "a finished job nobody collected is garbage collected")
}

func TestReapOnce_ForceRemovesJobThatNeverUnwinds(t *testing.T) {
	store := testStore(t)
	id, _ := newTestJob(t, store)
	store.markStarted(id)

	now := time.Now()
	store.jobs[id].reapedAt = now.Add(-2 * asyncJobReapGrace)
	store.jobs[id].LastPolledAt = now.Add(-2 * store.cfg.IdleTimeout)

	store.reapOnce(now)

	_, ok := store.get(id)
	assert.False(t, ok, "a goroutine that never records a terminal state must not leak an entry")
}

func TestReapOnce_DoesNotCancelTwice(t *testing.T) {
	store := testStore(t)
	id, _ := newTestJob(t, store)
	store.markStarted(id)
	store.jobs[id].LastPolledAt = time.Now().Add(-2 * store.cfg.IdleTimeout)

	store.reapOnce(time.Now())
	firstReap := store.jobs[id].reapedAt

	store.reapOnce(time.Now().Add(time.Second))
	assert.Equal(t, firstReap, store.jobs[id].reapedAt, "a job is only reaped once")
}

// ---------------------------------------------------------------------------
// error classification
// ---------------------------------------------------------------------------

func TestContextCauseResponse(t *testing.T) {
	cases := []struct {
		name   string
		cause  error
		status backend.Status
		source backend.ErrorSource
	}{
		{"idle reap", errAsyncJobIdle, backend.StatusTimeout, backend.ErrorSourceDownstream},
		{"ttl reap", errAsyncJobExpired, backend.StatusTimeout, backend.ErrorSourceDownstream},
		// A client closing the connection is neither our fault nor Sift's, so the source
		// is left unset and the SDK applies its default.
		{"client cancel", errAsyncJobCancelled, backend.Status(499), backend.ErrorSource("")},
		{"datasource reload", errAsyncStoreClosed, backend.Status(499), backend.ErrorSource("")},
		{"plain cancellation", context.Canceled, backend.Status(499), backend.ErrorSource("")},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			res := contextCauseResponse(tc.cause)
			require.NotNil(t, res.Error)
			assert.Equal(t, tc.status, res.Status)
			assert.Equal(t, tc.source, res.ErrorSource)
			assert.Empty(t, res.Frames)
		})
	}
}
