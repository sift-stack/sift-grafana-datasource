package plugin

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestIsChannelInCache(t *testing.T) {
	// Create a new datasource instance for testing
	ds := &SiftDatasource{
		channelsIdSearchCache: NewTypedCache[string, Channel](0, 0),
	}

	// Test channel data
	testChannel := Channel{
		ChannelId: "test-channel-123",
		Name:      "Test Channel",
		AssetId:   "test-asset-456",
		AssetName: "Test Asset",
		DataType:  "CHANNEL_DATA_TYPE_DOUBLE",
	}

	t.Run("channel not in cache", func(t *testing.T) {
		found, channel := ds.isChannelInCache("non-existent-channel", []string{"test-asset-456"})
		assert.False(t, found)
		assert.Nil(t, channel)
	})

	t.Run("channel in cache with matching asset ID", func(t *testing.T) {
		// Add channel to cache
		ds.channelsIdSearchCache.Set(testChannel.ChannelId, testChannel)

		found, channel := ds.isChannelInCache("test-channel-123", []string{"test-asset-456"})
		assert.True(t, found)
		assert.NotNil(t, channel)
		assert.Equal(t, testChannel.ChannelId, channel.ChannelId)
		assert.Equal(t, testChannel.AssetId, channel.AssetId)
	})

	t.Run("channel in cache but wrong asset ID", func(t *testing.T) {
		// Add channel to cache
		ds.channelsIdSearchCache.Set(testChannel.ChannelId, testChannel)

		found, channel := ds.isChannelInCache("test-channel-123", []string{"wrong-asset-789"})
		assert.False(t, found)
		assert.Nil(t, channel)
	})

	t.Run("channel in cache but asset ID not in list", func(t *testing.T) {
		// Add channel to cache
		ds.channelsIdSearchCache.Set(testChannel.ChannelId, testChannel)

		found, channel := ds.isChannelInCache("test-channel-123", []string{"asset-1", "asset-2", "asset-3"})
		assert.False(t, found)
		assert.Nil(t, channel)
	})

	t.Run("channel in cache with empty asset ID list", func(t *testing.T) {
		// Add channel to cache
		ds.channelsIdSearchCache.Set(testChannel.ChannelId, testChannel)

		found, channel := ds.isChannelInCache("test-channel-123", []string{})
		assert.False(t, found)
		assert.Nil(t, channel)
	})

	t.Run("multiple channels in cache", func(t *testing.T) {
		// Clear cache and add multiple channels
		ds.channelsIdSearchCache.Flush()

		channel1 := Channel{
			ChannelId: "channel-1",
			Name:      "Channel 1",
			AssetId:   "asset-1",
			DataType:  "CHANNEL_DATA_TYPE_DOUBLE",
		}

		channel2 := Channel{
			ChannelId: "channel-2",
			Name:      "Channel 2",
			AssetId:   "asset-2",
			DataType:  "CHANNEL_DATA_TYPE_STRING",
		}

		ds.channelsIdSearchCache.Set(channel1.ChannelId, channel1)
		ds.channelsIdSearchCache.Set(channel2.ChannelId, channel2)

		// Test channel1 with correct asset
		found, channel := ds.isChannelInCache("channel-1", []string{"asset-1"})
		assert.True(t, found)
		assert.Equal(t, channel1.ChannelId, channel.ChannelId)

		// Test channel2 with correct asset
		found, channel = ds.isChannelInCache("channel-2", []string{"asset-2"})
		assert.True(t, found)
		assert.Equal(t, channel2.ChannelId, channel.ChannelId)

		// Test channel1 with wrong asset
		found, channel = ds.isChannelInCache("channel-1", []string{"asset-2"})
		assert.False(t, found)
		assert.Nil(t, channel)
	})

	t.Run("channel with different asset IDs", func(t *testing.T) {
		// Clear cache and add a channel
		ds.channelsIdSearchCache.Flush()

		channel := Channel{
			ChannelId: "multi-asset-channel",
			Name:      "Multi Asset Channel",
			AssetId:   "asset-abc",
			DataType:  "CHANNEL_DATA_TYPE_INT_64",
		}

		ds.channelsIdSearchCache.Set(channel.ChannelId, channel)

		// Test with matching asset ID
		found, foundChannel := ds.isChannelInCache("multi-asset-channel", []string{"asset-abc"})
		assert.True(t, found)
		assert.Equal(t, channel.ChannelId, foundChannel.ChannelId)

		// Test with non-matching asset ID
		found, foundChannel = ds.isChannelInCache("multi-asset-channel", []string{"asset-def"})
		assert.False(t, found)
		assert.Nil(t, foundChannel)

		// Test with multiple asset IDs including the correct one
		found, foundChannel = ds.isChannelInCache("multi-asset-channel", []string{"asset-xyz", "asset-abc", "asset-123"})
		assert.True(t, found)
		assert.Equal(t, channel.ChannelId, foundChannel.ChannelId)
	})
}
