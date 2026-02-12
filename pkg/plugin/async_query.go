package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/grafana/grafana-plugin-sdk-go/data"
)

const (
	asyncJobStatusStarted  = "started"
	asyncJobStatusRunning  = "running"
	asyncJobStatusComplete = "complete"
	asyncJobStatusError    = "error"

	asyncJobTTL      = 10 * time.Minute
	asyncJobReapTick = 1 * time.Minute
)

// asyncJob represents an in-flight or completed async query.
type asyncJob struct {
	Status    string
	Frames    []*data.Frame
	Error     string
	CreatedAt time.Time
	cancel    context.CancelFunc
}

// asyncJobStore manages async query jobs with TTL-based cleanup.
type asyncJobStore struct {
	mu   sync.RWMutex
	jobs map[string]*asyncJob
	done chan struct{}
}

func newAsyncJobStore() *asyncJobStore {
	s := &asyncJobStore{
		jobs: make(map[string]*asyncJob),
		done: make(chan struct{}),
	}
	go s.reapLoop()
	return s
}

func (s *asyncJobStore) reapLoop() {
	ticker := time.NewTicker(asyncJobReapTick)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			s.mu.Lock()
			now := time.Now()
			for id, job := range s.jobs {
				if now.Sub(job.CreatedAt) > asyncJobTTL {
					if job.cancel != nil {
						job.cancel()
					}
					delete(s.jobs, id)
					log.DefaultLogger.Debug("async job reaped", "id", id)
				}
			}
			s.mu.Unlock()
		case <-s.done:
			return
		}
	}
}

func (s *asyncJobStore) stop() {
	close(s.done)
}

func (s *asyncJobStore) create(cancel context.CancelFunc) string {
	id := uuid.New().String()
	s.mu.Lock()
	s.jobs[id] = &asyncJob{
		Status:    asyncJobStatusStarted,
		CreatedAt: time.Now(),
		cancel:    cancel,
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

func (s *asyncJobStore) complete(id string, frames []*data.Frame) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if job, ok := s.jobs[id]; ok {
		job.Status = asyncJobStatusComplete
		job.Frames = frames
	}
}

func (s *asyncJobStore) fail(id string, errMsg string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if job, ok := s.jobs[id]; ok {
		job.Status = asyncJobStatusError
		job.Error = errMsg
	}
}

func (s *asyncJobStore) cancel(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	job, ok := s.jobs[id]
	if !ok {
		return false
	}
	if job.cancel != nil {
		job.cancel()
	}
	delete(s.jobs, id)
	return true
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
//   - the actual data frames if complete
//   - an error response if the job failed or was not found
func (d *SiftDatasource) handleAsyncQuery(pCtx backend.PluginContext, q backend.DataQuery, fqm queryModel) backend.DataResponse {
	// Check if this query has a queryID (i.e. it's a poll request from the requestLooper)
	var queryMeta struct {
		QueryID string `json:"queryID"`
	}
	_ = json.Unmarshal(q.JSON, &queryMeta)

	if queryMeta.QueryID != "" {
		return d.pollAsyncQuery(q.RefID, queryMeta.QueryID)
	}

	return d.startAsyncQuery(pCtx, q, fqm)
}

// startAsyncQuery kicks off the query in a background goroutine and immediately
// returns a frame with status "started" and the new queryID.
func (d *SiftDatasource) startAsyncQuery(pCtx backend.PluginContext, q backend.DataQuery, fqm queryModel) backend.DataResponse {
	jobCtx, jobCancel := context.WithCancel(context.Background())
	queryID := d.asyncJobs.create(jobCancel)

	log.DefaultLogger.Debug("async query started", "queryId", queryID, "refId", q.RefID)

	go func() {
		defer func() {
			if r := recover(); r != nil {
				d.asyncJobs.fail(queryID, fmt.Sprintf("panic: %v", r))
				log.DefaultLogger.Error("async query panic", "queryId", queryID, "error", r)
			}
		}()

		// Check if cancelled before starting
		select {
		case <-jobCtx.Done():
			d.asyncJobs.fail(queryID, "query cancelled")
			return
		default:
		}

		res := d.query(pCtx, q, fqm)
		if res.Error != nil {
			d.asyncJobs.fail(queryID, res.Error.Error())
			return
		}

		for _, frame := range res.Frames {
			frame.RefID = q.RefID
		}

		d.asyncJobs.complete(queryID, res.Frames)
		log.DefaultLogger.Debug("async query complete", "queryId", queryID, "frames", len(res.Frames))
	}()

	return backend.DataResponse{
		Frames: data.Frames{asyncStatusFrame(q.RefID, queryID, asyncJobStatusStarted)},
	}
}

// pollAsyncQuery checks the status of a running async job and returns the
// appropriate response for the requestLooper.
func (d *SiftDatasource) pollAsyncQuery(refID string, queryID string) backend.DataResponse {
	job, ok := d.asyncJobs.get(queryID)
	if !ok {
		return backend.ErrDataResponse(backend.StatusBadRequest, fmt.Sprintf("async query not found: %s", queryID))
	}

	switch job.Status {
	case asyncJobStatusComplete:
		return backend.DataResponse{
			Frames: job.Frames,
		}
	case asyncJobStatusError:
		return backend.ErrDataResponse(backend.StatusInternal, job.Error)
	default:
		// Still running — return a status frame so the requestLooper keeps polling
		return backend.DataResponse{
			Frames: data.Frames{asyncStatusFrame(refID, queryID, asyncJobStatusRunning)},
		}
	}
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
