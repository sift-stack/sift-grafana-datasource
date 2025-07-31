package plugin

import (
	"fmt"
	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/patrickmn/go-cache"
	"math/rand"
	"sync"
	"time"
)

// TypedCache is a type-safe wrapper around go-cache
type TypedCache[K comparable, V any] struct {
	cache  *cache.Cache
	maxTtl time.Duration
	minTtl time.Duration
}

// NewTypedCache creates a new typed cache with the specified expiration and cleanup interval
func NewTypedCache[K comparable, V any](defaultExpiration time.Duration, cleanupInterval time.Duration) *TypedCache[K, V] {
	return &TypedCache[K, V]{
		cache:  cache.New(defaultExpiration, cleanupInterval),
		maxTtl: defaultExpiration,
		minTtl: defaultExpiration,
	}
}

func NewTypedCacheWithRandomTtl[K comparable, V any](maxTtl, minTtl time.Duration, cleanupInterval time.Duration) *TypedCache[K, V] {
	return &TypedCache[K, V]{
		cache:  cache.New(maxTtl, cleanupInterval),
		maxTtl: maxTtl,
		minTtl: minTtl,
	}
}

// Set adds an item to the cache. Always calls getRandomizedTimeToLive, but if instantiated with NewTypedCache, this is always the default
func (tc *TypedCache[K, V]) Set(key K, value V) {
	d := tc.getRandomizedTimeToLive()
	tc.cache.Set(fmt.Sprintf("%v", key), value, d)
}

// Get retrieves an item from the cache with automatic type conversion
func (tc *TypedCache[K, V]) Get(key K) (V, bool) {
	var result V
	value, _, found := tc.cache.GetWithExpiration(fmt.Sprintf("%v", key))
	if !found {
		return result, false
	}

	// Type assertion
	typedValue, ok := value.(V)
	if !ok {
		return result, false
	}

	return typedValue, true
}

// Delete removes an item from the cache
func (tc *TypedCache[K, V]) Delete(key K) {
	tc.cache.Delete(fmt.Sprintf("%v", key))
}

// Flush deletes all items from the cache
func (tc *TypedCache[K, V]) Flush() {
	tc.cache.Flush()
}

// randomly computes a time to live between minTtl and maxTtl
func (tc *TypedCache[K, V]) getRandomizedTimeToLive() time.Duration {
	if tc.minTtl == tc.maxTtl || tc.maxTtl < tc.minTtl {
		return tc.minTtl
	}
	return time.Duration(rand.Intn(int(tc.maxTtl-tc.minTtl))) + tc.minTtl
}

type TypedCacheWithLoader[K any, V any, C comparable] struct {
	*TypedCache[C, V]
	mu              *sync.Mutex
	keyToComparable func(K) C
	loading         map[C]func() (V, error)
	loader          func(*SiftDatasource, backend.PluginContext, K) (V, error)
}

func NewTypedCacheWithLoader[K any, V any, C comparable](typedCache *TypedCache[C, V], loader func(*SiftDatasource, backend.PluginContext, K) (V, error), keyToComparable func(K) C) *TypedCacheWithLoader[K, V, C] {
	return &TypedCacheWithLoader[K, V, C]{
		TypedCache:      typedCache,
		mu:              &sync.Mutex{},
		keyToComparable: keyToComparable,
		loading:         make(map[C]func() (V, error)),
		loader:          loader,
	}
}

// GetOrWait retrieves an item from the cache and waits on any other goroutine that is setting the value
func (tc *TypedCacheWithLoader[K, V, C]) GetOrWait(d *SiftDatasource, ctx backend.PluginContext, key K) (V, error) {
	tc.mu.Lock()
	comparableKey := tc.keyToComparable(key)
	value, found := tc.cache.Get(fmt.Sprintf("%v", comparableKey))
	if found {
		log.DefaultLogger.Debug("found in cache", "key", key)
		return value, nil
	}

	// Check if we are already loading the value
	load := tc.loading[comparableKey]
	if load != nil {
		tc.mu.Unlock()
		log.DefaultLogger.Debug("waiting for pending cache load", "key", key)
		return load()
	}

	// Haven't started loading it
	log.DefaultLogger.Debug("initiating new cache load", "key", key)
	load = sync.OnceValues(func() (V, error) {
		v, err := tc.loader(d, ctx, key)
		tc.mu.Lock()
		defer tc.mu.Unlock()

		delete(tc.loading, comparableKey)
		if err != nil {
			return v, err
		}
		tc.Set(comparableKey, v)
		return v, nil
	})
	tc.loading[comparableKey] = load
	tc.mu.Unlock()
	return load()

}
