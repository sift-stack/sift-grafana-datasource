package plugin

import (
	"fmt"
	"math/rand"
	"time"

	"github.com/patrickmn/go-cache"
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

// Set adds an item to the cache,on
func (tc *TypedCache[K, V]) Set(key K, value V) {
	d = tc.getRandomizedTimeToLive()
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

func (tc *TypedCache[K, V]) getRandomizedTimeToLive() time.Duration {
	if tc.minTtl == tc.maxTtl || tc.maxTtl < tc.minTtl {
		return tc.minTtl
	}
	return time.Duration(rand.Intn(int(tc.maxTtl-tc.minTtl))) + tc.minTtl
}
