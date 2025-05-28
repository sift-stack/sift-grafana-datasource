package plugin

import (
	"testing"
	"time"
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
