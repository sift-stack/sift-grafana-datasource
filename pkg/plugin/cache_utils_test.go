package plugin

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

func TestTypedCache_BasicOperations(t *testing.T) {
	cache := NewTypedCache[string, string](5*time.Minute, 10*time.Minute)

	// Test Set and Get
	cache.Set("key1", "value1")
	value, found := cache.Get("key1")
	if !found {
		t.Error("Expected to find key1, but it wasn't found")
	}
	if value != "value1" {
		t.Errorf("Expected value1, got %s", value)
	}

	// Test Delete
	cache.Delete("key1")
	_, found = cache.Get("key1")
	if found {
		t.Error("Expected key1 to be deleted, but it was found")
	}

	// Test Flush
	cache.Flush()
	_, found = cache.Get("key2")
	if found {
		t.Error("Expected all keys to be flushed, but key2 was found")
	}
}

func TestTypedCache_WithStructKeys(t *testing.T) {
	type TestKey struct {
		ID   string
		Name string
	}

	// Implement String method for TestKey
	cache := NewTypedCache[TestKey, int](5*time.Minute, 10*time.Minute)

	key1 := TestKey{ID: "1", Name: "Test1"}
	key2 := TestKey{ID: "1", Name: "Test2"}

	// Test with struct keys
	cache.Set(key1, 100)
	cache.Set(key2, 200)

	value, found := cache.Get(key1)
	if !found {
		t.Error("Expected to find key1, but it wasn't found")
	}
	if value != 100 {
		t.Errorf("Expected 100, got %d", value)
	}

	value, found = cache.Get(key2)
	if !found {
		t.Error("Expected to find key2, but it wasn't found")
	}
	if value != 200 {
		t.Errorf("Expected 200, got %d", value)
	}
}

func TestTypedCacheWithLoader_GetOrWait_CacheHit(t *testing.T) {
	// Create a typed cache
	cache := NewTypedCache[string, string](5*time.Minute, 10*time.Minute)

	// Pre-populate the cache
	cache.Set("test-key", "cached-value")

	// Create a loader that should not be called
	loader := func(ctx context.Context, d *SiftDatasource, pCtx backend.PluginContext, key string) (string, error) {
		t.Error("Loader should not be called when value is in cache")
		return "", errors.New("should not be called")
	}

	// Create cache with loader
	cacheWithLoader := NewTypedCacheWithLoader(cache, loader, func(k string) string { return k })

	// Mock datasource and context
	mockDatasource := &SiftDatasource{}
	mockContext := backend.PluginContext{}

	// Test GetOrWait - should return cached value
	result, err := cacheWithLoader.GetOrWait(context.Background(), mockDatasource, mockContext, "test-key")

	if err != nil {
		t.Errorf("Expected no error, got %v", err)
	}
	if result != "cached-value" {
		t.Errorf("Expected 'cached-value', got %s", result)
	}
}

func TestTypedCacheWithLoader_GetOrWait_CacheMiss(t *testing.T) {
	// Create an empty typed cache
	cache := NewTypedCache[string, string](5*time.Minute, 10*time.Minute)

	// Create a loader that returns a value
	loaderCalled := false
	loader := func(ctx context.Context, d *SiftDatasource, pCtx backend.PluginContext, key string) (string, error) {
		loaderCalled = true
		if key == "test-key" {
			return "loaded-value", nil
		}
		return "", errors.New("unexpected key")
	}

	// Create cache with loader
	cacheWithLoader := NewTypedCacheWithLoader(cache, loader, func(k string) string { return k })

	// Mock datasource and context
	mockDatasource := &SiftDatasource{}
	mockContext := backend.PluginContext{}

	// Test GetOrWait - should call loader and return loaded value
	result, err := cacheWithLoader.GetOrWait(context.Background(), mockDatasource, mockContext, "test-key")

	if err != nil {
		t.Errorf("Expected no error, got %v", err)
	}
	if result != "loaded-value" {
		t.Errorf("Expected 'loaded-value', got %s", result)
	}
	if !loaderCalled {
		t.Error("Expected loader to be called")
	}

	// Verify value was cached
	cachedValue, found := cache.Get("test-key")
	if !found {
		t.Error("Expected value to be cached")
	}
	if cachedValue != "loaded-value" {
		t.Errorf("Expected cached value 'loaded-value', got %s", cachedValue)
	}
}

func TestTypedCacheWithLoader_GetOrWait_LoaderError(t *testing.T) {
	// Create an empty typed cache
	cache := NewTypedCache[string, string](5*time.Minute, 10*time.Minute)

	// Create a loader that returns an error
	expectedError := errors.New("loader failed")
	loader := func(ctx context.Context, d *SiftDatasource, pCtx backend.PluginContext, key string) (string, error) {
		return "", expectedError
	}

	// Create cache with loader
	cacheWithLoader := NewTypedCacheWithLoader(cache, loader, func(k string) string { return k })

	// Mock datasource and context
	mockDatasource := &SiftDatasource{}
	mockContext := backend.PluginContext{}

	// Test GetOrWait - should return error from loader
	result, err := cacheWithLoader.GetOrWait(context.Background(), mockDatasource, mockContext, "test-key")

	if err != expectedError {
		t.Errorf("Expected error %v, got %v", expectedError, err)
	}
	if result != "" {
		t.Errorf("Expected empty result on error, got %s", result)
	}

	// Verify value was not cached on error
	_, found := cache.Get("test-key")
	if found {
		t.Error("Expected value not to be cached on loader error")
	}
}

func TestTypedCacheWithLoader_GetOrWait_ConcurrentLoads(t *testing.T) {
	// Create an empty typed cache
	cache := NewTypedCache[string, string](5*time.Minute, 10*time.Minute)

	// Create a loader that simulates slow loading
	loaderCallCount := 0
	var loaderMutex sync.Mutex
	loader := func(ctx context.Context, d *SiftDatasource, pCtx backend.PluginContext, key string) (string, error) {
		loaderMutex.Lock()
		loaderCallCount++
		loaderMutex.Unlock()

		// Simulate slow operation
		time.Sleep(100 * time.Millisecond)
		return "loaded-value", nil
	}

	// Create cache with loader
	cacheWithLoader := NewTypedCacheWithLoader(cache, loader, func(k string) string { return k })

	// Mock datasource and context
	mockDatasource := &SiftDatasource{}
	mockContext := backend.PluginContext{}

	// Launch multiple concurrent GetOrWait calls
	const numGoroutines = 5
	var wg sync.WaitGroup
	results := make([]string, numGoroutines)
	errors := make([]error, numGoroutines)

	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			result, err := cacheWithLoader.GetOrWait(context.Background(), mockDatasource, mockContext, "test-key")
			results[index] = result
			errors[index] = err
		}(i)
	}

	wg.Wait()

	// Verify all calls succeeded and returned the same value
	for i := 0; i < numGoroutines; i++ {
		if errors[i] != nil {
			t.Errorf("Goroutine %d got error: %v", i, errors[i])
		}
		if results[i] != "loaded-value" {
			t.Errorf("Goroutine %d got result %s, expected 'loaded-value'", i, results[i])
		}
	}

	// Verify loader was called only once despite multiple concurrent requests
	loaderMutex.Lock()
	if loaderCallCount != 1 {
		t.Errorf("Expected loader to be called exactly once, but was called %d times", loaderCallCount)
	}
	loaderMutex.Unlock()

	// Verify value was cached
	cachedValue, found := cache.Get("test-key")
	if !found {
		t.Error("Expected value to be cached")
	}
	if cachedValue != "loaded-value" {
		t.Errorf("Expected cached value 'loaded-value', got %s", cachedValue)
	}
}

func TestTypedCacheWithLoader_GetOrWait_WithComplexTypes(t *testing.T) {
	// Test with complex key and value types
	type TestKey struct {
		AssetID string
		RunID   string
	}

	type TestValue struct {
		Data      string
		Timestamp time.Time
	}

	// Create cache with complex types
	cache := NewTypedCache[string, TestValue](5*time.Minute, 10*time.Minute)

	// Create a loader
	loader := func(ctx context.Context, d *SiftDatasource, pCtx backend.PluginContext, key TestKey) (TestValue, error) {
		return TestValue{
			Data:      "complex-data-" + key.AssetID,
			Timestamp: time.Now(),
		}, nil
	}

	// Key conversion function
	keyToComparable := func(k TestKey) string {
		return k.AssetID + ":" + k.RunID
	}

	// Create cache with loader
	cacheWithLoader := NewTypedCacheWithLoader(cache, loader, keyToComparable)

	// Mock datasource and context
	mockDatasource := &SiftDatasource{}
	mockContext := backend.PluginContext{}

	// Test with complex key
	testKey := TestKey{AssetID: "asset123", RunID: "run456"}
	result, err := cacheWithLoader.GetOrWait(context.Background(), mockDatasource, mockContext, testKey)

	if err != nil {
		t.Errorf("Expected no error, got %v", err)
	}
	if result.Data != "complex-data-asset123" {
		t.Errorf("Expected 'complex-data-asset123', got %s", result.Data)
	}

	// Verify caching with the converted key
	cachedValue, found := cache.Get("asset123:run456")
	if !found {
		t.Error("Expected value to be cached with converted key")
	}
	if cachedValue.Data != "complex-data-asset123" {
		t.Errorf("Expected cached data 'complex-data-asset123', got %s", cachedValue.Data)
	}
}
