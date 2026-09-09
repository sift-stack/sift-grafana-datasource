package plugin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/grafana/grafana-plugin-sdk-go/data"
	"golang.org/x/sync/semaphore"
)

const (
	asyncJobStatusStarted  = "started"
	asyncJobStatusRunning  = "running"
	asyncJobStatusComplete = "complete"
	asyncJobStatusError    = "error"

	// asyncJobReapTick is how often abandoned and expired jobs are swept.
	asyncJobReapTick = 10 * time.Second

	// asyncJobReapGrace bounds how long a reaped job may take to unwind its backend read
	// and write its terminal state. A job still present after this is force-removed so a
	// wedged goroutine cannot hold an entry forever.
	asyncJobReapGrace = 60 * time.Second

	// defaultMaxConcurrentAsyncQueries bounds how many async queries (query blocks)
	// execute against the Sift backend at once across every panel and dashboard served by
	// this plugin instance. Without a bound, a dashboard with many panels would fan out
	// unbounded concurrent reads into read-service, which has no admission control. The
	// effective worst-case in-flight backend request count is this value times the
	// per-target chunk parallelism (maxParallelDataQueries). The default is set high
	// enough not to reduce concurrency below the previous synchronous model for typical
	// dashboards.
	defaultMaxConcurrentAsyncQueries = 32

	// defaultAsyncJobIdleTimeout reclaims async jobs the frontend has stopped polling.
	// The poll interval backs off exponentially and caps at 10s, so this window is six
	// missed polls: enough headroom for a throttled background tab, short enough that an
	// abandoned panel frees its concurrency slot promptly. The frontend does post an
	// explicit cancel on unsubscribe, so this is a backstop for the cases where the
	// browser never gets to send one (tab closed, network dropped, page reloaded).
	defaultAsyncJobIdleTimeout = 60 * time.Second

	// defaultAsyncJobTTL is a ceiling on how long a single job may execute, measured from
	// the moment it acquires a concurrency slot rather than from when it was created, so
	// time spent queued behind other jobs is not charged against it. It exists only to
	// stop a wedged backend read from holding a slot indefinitely; set the TTL to 0 to
	// remove the ceiling entirely and let a query run for as long as the client keeps
	// polling it.
	defaultAsyncJobTTL = 30 * time.Minute

	maxConcurrentAsyncQueriesEnvVar = "SIFT_ASYNC_MAX_CONCURRENT_QUERIES"
	asyncJobTTLEnvVar               = "SIFT_ASYNC_JOB_TTL"
	asyncJobIdleTimeoutEnvVar       = "SIFT_ASYNC_JOB_IDLE_TIMEOUT"
)

// Causes attached to a job's context when it is aborted. Their messages are surfaced to
// the user, either as the panel error or as a notice alongside partial data, so they are
// written to read well in a panel.
var (
	errAsyncJobIdle      = errors.New("query abandoned: the panel stopped polling for results")
	errAsyncJobExpired   = errors.New("query exceeded the maximum async job duration")
	errAsyncJobCancelled = errors.New("query cancelled by the client")
	errAsyncStoreClosed  = errors.New("query cancelled: the datasource was reloaded")
)

// asyncConfig holds the tunables for async query execution.
type asyncConfig struct {
	MaxConcurrent int64
	IdleTimeout   time.Duration
	// JobTTL of 0 disables the execution ceiling.
	JobTTL time.Duration
}

// asyncConfigFromEnv reads the async tunables from the environment, falling back to the
// defaults when an override is unset or unparseable.
func asyncConfigFromEnv() asyncConfig {
	return asyncConfig{
		MaxConcurrent: envInt64(maxConcurrentAsyncQueriesEnvVar, defaultMaxConcurrentAsyncQueries, 1),
		IdleTimeout:   envDuration(asyncJobIdleTimeoutEnvVar, defaultAsyncJobIdleTimeout, time.Second),
		JobTTL:        envDuration(asyncJobTTLEnvVar, defaultAsyncJobTTL, 0),
	}
}

// envInt64 reads an integer environment override, rejecting values below min.
func envInt64(name string, fallback, minValue int64) int64 {
	raw := os.Getenv(name)
	if raw == "" {
		return fallback
	}
	n, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || n < minValue {
		log.DefaultLogger.Warn("invalid async config override, using default",
			"env", name, "value", raw, "default", fallback)
		return fallback
	}
	return n
}

// envDuration reads a Go duration environment override (for example "45s" or "10m"),
// rejecting values below minValue. A minValue of 0 permits 0, which callers use to disable
// a limit.
func envDuration(name string, fallback, minValue time.Duration) time.Duration {
	raw := os.Getenv(name)
	if raw == "" {
		return fallback
	}
	d, err := time.ParseDuration(raw)
	if err != nil || d < minValue {
		log.DefaultLogger.Warn("invalid async config override, using default",
			"env", name, "value", raw, "default", fallback)
		return fallback
	}
	return d
}

// asyncJob represents an in-flight or finished async query.
type asyncJob struct {
	Status string
	// Response is the finished query's full response: frames, error, status code and
	// error source. A partially successful query carries frames and no error, with the
	// failure recorded as a frame notice.
	Response backend.DataResponse

	CreatedAt    time.Time
	StartedAt    time.Time
	LastPolledAt time.Time

	// reapedAt records when the reaper cancelled this job, so it is not cancelled twice
	// and cannot linger if its goroutine never writes a terminal state.
	reapedAt time.Time
	// delivered marks a terminal result already handed to the client. The frames are
	// dropped at that point; the entry survives briefly so a duplicate poll gets a clear
	// answer rather than "async query not found".
	delivered bool

	cancel context.CancelCauseFunc
}

// asyncJobStore manages async query jobs with idle/TTL-based cleanup and bounds the
// number of concurrently executing backend queries via a weighted semaphore.
type asyncJobStore struct {
	mu       sync.RWMutex
	jobs     map[string]*asyncJob
	done     chan struct{}
	stopOnce sync.Once
	sem      *semaphore.Weighted
	cfg      asyncConfig
}

func newAsyncJobStore(cfg asyncConfig) *asyncJobStore {
	if cfg.MaxConcurrent < 1 {
		cfg.MaxConcurrent = 1
	}
	if cfg.IdleTimeout <= 0 {
		cfg.IdleTimeout = defaultAsyncJobIdleTimeout
	}
	if cfg.JobTTL < 0 {
		cfg.JobTTL = 0
	}
	s := &asyncJobStore{
		jobs: make(map[string]*asyncJob),
		done: make(chan struct{}),
		sem:  semaphore.NewWeighted(cfg.MaxConcurrent),
		cfg:  cfg,
	}
	go s.reapLoop()
	return s
}

func isTerminalAsyncStatus(status string) bool {
	return status == asyncJobStatusComplete || status == asyncJobStatusError
}

func (s *asyncJobStore) reapLoop() {
	ticker := time.NewTicker(asyncJobReapTick)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			s.reapOnce(time.Now())
		case <-s.done:
			return
		}
	}
}

// reapOnce reclaims jobs the frontend has abandoned (not polled within the idle timeout)
// and jobs that have been executing longer than the TTL.
//
// A running job is cancelled but deliberately not deleted: cancelling aborts the in-flight
// backend read, and the job's goroutine then unwinds and records whatever data it had
// already collected, so a client still polling receives partial data and a reason rather
// than an opaque "async query not found". Finished jobs are deleted once they too go
// unpolled for the idle window.
func (s *asyncJobStore) reapOnce(now time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for id, job := range s.jobs {
		if isTerminalAsyncStatus(job.Status) {
			if now.Sub(job.LastPolledAt) > s.cfg.IdleTimeout {
				delete(s.jobs, id)
			}
			continue
		}

		if !job.reapedAt.IsZero() {
			// Already cancelled and still unwinding. Force-remove a goroutine that never
			// reached a terminal state rather than leaking the entry.
			if now.Sub(job.reapedAt) > asyncJobReapGrace {
				delete(s.jobs, id)
				log.DefaultLogger.Warn("async job removed without a terminal state", "id", id)
			}
			continue
		}

		idle := now.Sub(job.LastPolledAt) > s.cfg.IdleTimeout
		expired := s.cfg.JobTTL > 0 && !job.StartedAt.IsZero() && now.Sub(job.StartedAt) > s.cfg.JobTTL
		if !idle && !expired {
			continue
		}

		cause, reason := errAsyncJobIdle, "idle"
		if expired {
			cause, reason = errAsyncJobExpired, "ttl"
		}
		job.reapedAt = now
		if job.cancel != nil {
			job.cancel(cause)
		}
		log.DefaultLogger.Info("async job reaped", "id", id, "reason", reason,
			"status", job.Status, "idleMs", now.Sub(job.LastPolledAt).Milliseconds())
	}
}

// stop halts the reaper and cancels every outstanding job so a datasource reload does not
// leave goroutines and in-flight Sift reads running. It is safe to call more than once.
func (s *asyncJobStore) stop() {
	s.stopOnce.Do(func() {
		close(s.done)
		s.mu.Lock()
		defer s.mu.Unlock()
		for id, job := range s.jobs {
			if job.cancel != nil {
				job.cancel(errAsyncStoreClosed)
			}
			delete(s.jobs, id)
		}
	})
}

func (s *asyncJobStore) create(cancel context.CancelCauseFunc) string {
	id := uuid.New().String()
	now := time.Now()
	s.mu.Lock()
	s.jobs[id] = &asyncJob{
		Status:       asyncJobStatusStarted,
		CreatedAt:    now,
		LastPolledAt: now,
		cancel:       cancel,
	}
	s.mu.Unlock()
	return id
}

func (s *asyncJobStore) get(id string) (*asyncJob, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	job, ok := s.jobs[id]
	return job, ok
}

// markStarted records that a job has acquired a concurrency slot and begun executing.
// The TTL is measured from this moment, not from job creation, so a job does not lose
// budget while queued behind other work.
func (s *asyncJobStore) markStarted(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if job, ok := s.jobs[id]; ok {
		job.Status = asyncJobStatusRunning
		job.StartedAt = time.Now()
	}
}

// finish records a job's terminal response. A response carrying frames is complete even
// when it also carries a notice about partial failure; only a response with an error and
// no frames is an error.
func (s *asyncJobStore) finish(id string, res backend.DataResponse) {
	s.mu.Lock()
	defer s.mu.Unlock()
	job, ok := s.jobs[id]
	if !ok {
		return
	}
	job.Response = res
	if res.Error != nil && len(res.Frames) == 0 {
		job.Status = asyncJobStatusError
	} else {
		job.Status = asyncJobStatusComplete
	}
}

// cancel aborts a job at the client's request and drops it. Unlike a reap there is nobody
// left to deliver a partial result to, so the entry is removed immediately.
func (s *asyncJobStore) cancel(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	job, ok := s.jobs[id]
	if !ok {
		return false
	}
	if job.cancel != nil {
		job.cancel(errAsyncJobCancelled)
	}
	delete(s.jobs, id)
	return true
}

// poll returns a job's current status under a single lock, along with its response once
// the job is finished. The frames are handed over exactly once and dropped from the store
// so they are freed without waiting for the reaper; the entry itself survives until the
// idle sweep so a duplicate poll gets a clear answer instead of a not-found error.
func (s *asyncJobStore) poll(id string) (status string, res backend.DataResponse, ok bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	job, exists := s.jobs[id]
	if !exists {
		return "", backend.DataResponse{}, false
	}

	// Track liveness: the frontend polls a live job continually. When it stops (panel
	// superseded / abandoned), reapOnce cancels the job by idle timeout.
	job.LastPolledAt = time.Now()

	if !isTerminalAsyncStatus(job.Status) {
		return job.Status, backend.DataResponse{}, true
	}

	if job.delivered {
		return job.Status, job.Response, true
	}

	status, res = job.Status, job.Response
	job.delivered = true
	job.Status = asyncJobStatusError
	job.Response = backend.ErrDataResponse(backend.StatusBadRequest,
		fmt.Sprintf("async query result already delivered: %s", id))
	return status, res, true
}

// contextCauseResponse turns the reason a query's context was aborted into a classified
// error response. Reaping is a server-side timeout, not a malformed request, so it must
// not be reported as a client error: that would book a slow Sift read as a 4xx and skew
// the plugin's request metrics.
func contextCauseResponse(cause error) backend.DataResponse {
	switch {
	case errors.Is(cause, errAsyncJobIdle), errors.Is(cause, errAsyncJobExpired):
		return backend.ErrDataResponseWithSource(backend.StatusTimeout, backend.ErrorSourceDownstream, cause.Error())
	case errors.Is(cause, errAsyncJobCancelled), errors.Is(cause, errAsyncStoreClosed):
		return backend.ErrDataResponse(backend.Status(499), cause.Error()) // 499 Client Closed Request
	case cause == nil:
		return backend.ErrDataResponse(backend.Status(499), "request cancelled")
	default:
		return backend.ErrDataResponse(backend.Status(499), cause.Error())
	}
}

// asyncCustomMeta is the frame metadata format expected by @grafana/async-query-data.
// The library checks for meta.custom.queryID and meta.custom.status on each frame.
type asyncCustomMeta struct {
	QueryID string `json:"queryID"`
	Status  string `json:"status"`
}

// asyncStatusFrame builds an empty frame with the async status metadata that
// DatasourceWithAsyncBackend's requestLooper inspects to decide whether to keep polling.
func asyncStatusFrame(refID string, queryID string, status string) *data.Frame {
	frame := data.NewFrame("async-status")
	frame.RefID = refID
	frame.Meta = &data.FrameMeta{
		Custom: asyncCustomMeta{
			QueryID: queryID,
			Status:  status,
		},
	}
	return frame
}

// handleAsyncQuery is called from QueryData. It inspects the query JSON for a
// "queryID" field to determine whether this is an initial request or a poll.
//
// Initial request (no queryID): starts the query in a goroutine, returns a frame
// with status "started".
//
// Poll request (has queryID): checks job status and returns:
//   - status "running" frame if still in progress
//   - the job's response if it has finished, partial frames and notices included
//   - an error response if the job failed or was not found
func (d *SiftDatasource) handleAsyncQuery(pCtx backend.PluginContext, q backend.DataQuery, fqm queryModel) backend.DataResponse {
	// Check if this query has a queryID (i.e. it's a poll request from the requestLooper)
	var queryMeta struct {
		QueryID string `json:"queryID"`
	}
	if err := json.Unmarshal(q.JSON, &queryMeta); err != nil {
		log.DefaultLogger.Debug("could not read queryID from query JSON, treating as a new query",
			"refId", q.RefID, "error", err)
	}

	if queryMeta.QueryID != "" {
		return d.pollAsyncQuery(q.RefID, queryMeta.QueryID)
	}

	return d.startAsyncQuery(pCtx, q, fqm)
}

// startAsyncQuery kicks off the query in a background goroutine and immediately
// returns a frame with status "started" and the new queryID. The goroutine runs on
// its own cancelable context (not the request context, which ends as soon as this
// function returns), so cancellation and reaping can abort the in-flight backend
// read via the same context plumbing used by the synchronous path.
func (d *SiftDatasource) startAsyncQuery(pCtx backend.PluginContext, q backend.DataQuery, fqm queryModel) backend.DataResponse {
	jobCtx, jobCancel := context.WithCancelCause(context.Background())
	queryID := d.asyncJobs.create(jobCancel)

	log.DefaultLogger.Debug("async query started", "queryId", queryID, "refId", q.RefID)

	go func() {
		defer jobCancel(nil)
		defer func() {
			if r := recover(); r != nil {
				d.asyncJobs.finish(queryID, backend.ErrDataResponse(backend.StatusInternal, fmt.Sprintf("panic: %v", r)))
				log.DefaultLogger.Error("async query panic", "queryId", queryID, "error", r)
			}
		}()

		// Bound concurrent backend queries. Acquire blocks until a slot frees or the job
		// is cancelled/reaped (jobCtx done), so queued jobs don't pile work onto
		// read-service and a job cancelled while waiting never starts.
		if err := d.asyncJobs.sem.Acquire(jobCtx, 1); err != nil {
			d.asyncJobs.finish(queryID, contextCauseResponse(context.Cause(jobCtx)))
			return
		}
		defer d.asyncJobs.sem.Release(1)
		d.asyncJobs.markStarted(queryID)

		res := d.query(jobCtx, pCtx, q, fqm)
		for _, frame := range res.Frames {
			frame.RefID = q.RefID
		}

		d.asyncJobs.finish(queryID, res)
		log.DefaultLogger.Debug("async query finished", "queryId", queryID,
			"frames", len(res.Frames), "error", res.Error)
	}()

	return backend.DataResponse{
		Frames: data.Frames{asyncStatusFrame(q.RefID, queryID, asyncJobStatusStarted)},
	}
}

// pollAsyncQuery checks the status of a running async job and returns the
// appropriate response for the requestLooper.
func (d *SiftDatasource) pollAsyncQuery(refID string, queryID string) backend.DataResponse {
	status, res, ok := d.asyncJobs.poll(queryID)
	if !ok {
		return backend.ErrDataResponse(backend.StatusBadRequest, fmt.Sprintf("async query not found: %s", queryID))
	}

	if !isTerminalAsyncStatus(status) {
		// Still running — return a status frame so the requestLooper keeps polling
		return backend.DataResponse{
			Frames: data.Frames{asyncStatusFrame(refID, queryID, asyncJobStatusRunning)},
		}
	}

	// Finished. Replay the job's response as-is: it already carries the frames (whole or
	// partial), any notices, and the error classification produced by the query path.
	return res
}

// callAsyncQueryCancel handles the "cancel" CallResource endpoint.
// DatasourceWithAsyncBackend calls postResource('cancel', { queryId }) on unsubscribe.
func (d *SiftDatasource) callAsyncQueryCancel(ctx context.Context, req *backend.CallResourceRequest, sender backend.CallResourceResponseSender) error {
	var body struct {
		QueryID string `json:"queryId"`
	}
	if err := json.Unmarshal(req.Body, &body); err != nil || body.QueryID == "" {
		return sender.Send(&backend.CallResourceResponse{
			Status: http.StatusBadRequest,
			Body:   []byte(`{"error":"missing queryId"}`),
		})
	}

	if d.asyncJobs.cancel(body.QueryID) {
		log.DefaultLogger.Debug("async query cancelled", "queryId", body.QueryID)
		return sender.Send(&backend.CallResourceResponse{
			Status: http.StatusOK,
			Body:   []byte(`{"status":"cancelled"}`),
		})
	}

	return sender.Send(&backend.CallResourceResponse{
		Status: http.StatusNotFound,
		Body:   []byte(`{"error":"query not found"}`),
	})
}
