import { generateLinkFromQuery } from './generateLinkFromQuery';
import type { SharelinkItems, SharelinkTimeRange } from '../../types';

describe('generateLinkFromQuery', () => {
  const mockItems: SharelinkItems = {
    channelIds: ['channel-1', 'channel-2'],
    assetIds: ['asset-1'],
    runIds: ['run-1'],
    calculatedChannels: [],
  };

  describe('URL construction with hostname normalization', () => {
    it('should handle hostname without protocol and prepend https://', () => {
      const result = generateLinkFromQuery('app.siftstack.com', mockItems);
      
      expect(result).toMatch(/^https:\/\/app\.siftstack\.com\/explore\?/);
    });

    it('should handle hostname with https:// protocol', () => {
      const result = generateLinkFromQuery('https://app.siftstack.com', mockItems);
      
      expect(result).toMatch(/^https:\/\/app\.siftstack\.com\/explore\?/);
    });

    it('should handle hostname with http:// protocol', () => {
      const result = generateLinkFromQuery('http://localhost:3000', mockItems);
      
      expect(result).toMatch(/^http:\/\/localhost:3000\/explore\?/);
    });

    it('should handle hostname with port', () => {
      const result = generateLinkFromQuery('localhost:8080', mockItems);
      
      expect(result).toMatch(/^https:\/\/localhost:8080\/explore\?/);
    });

    it('should extract origin from full URL with path', () => {
      const result = generateLinkFromQuery('https://app.siftstack.com/some/path', mockItems);
      
      // Should use only the origin, not the path
      expect(result).toMatch(/^https:\/\/app\.siftstack\.com\/explore\?/);
      expect(result).not.toContain('/some/path');
    });

    it('should handle URL with query parameters by using only origin', () => {
      const result = generateLinkFromQuery('https://app.siftstack.com?foo=bar', mockItems);
      
      expect(result).toMatch(/^https:\/\/app\.siftstack\.com\/explore\?/);
      expect(result).not.toContain('?foo=bar');
    });

    it('should handle URL with trailing slash', () => {
      const result = generateLinkFromQuery('https://app.siftstack.com/', mockItems);
      
      expect(result).toMatch(/^https:\/\/app\.siftstack\.com\/explore\?/);
    });
  });

  describe('dynamic URL parameters', () => {
    it('should include the required method and panel type', () => {
      const result = generateLinkFromQuery('app.siftstack.com', mockItems);
      const url = new URL(result);

      expect(url.searchParams.get('method')).toBe('single');
      expect(url.searchParams.get('panelType')).toBe('timeseries');
    });

    it('should include assets in the query string', () => {
      const items: SharelinkItems = {
        channelIds: ['channel-1'],
        assetIds: ['asset-1', 'asset-2'],
        runIds: [],
        calculatedChannels: [],
      };
      
      const result = generateLinkFromQuery('app.siftstack.com', items);
      const url = new URL(result);
      
      expect(url.searchParams.get('assetIds')).toBe('asset-1,asset-2');
    });

    it('should include runs in the query string', () => {
      const items: SharelinkItems = {
        channelIds: ['channel-1'],
        assetIds: [],
        runIds: ['run-1', 'run-2'],
        calculatedChannels: [],
      };
      
      const result = generateLinkFromQuery('app.siftstack.com', items);
      const url = new URL(result);
      
      expect(url.searchParams.get('runIds')).toBe('run-1,run-2');
    });

    it('should include channels in the query string', () => {
      const result = generateLinkFromQuery('app.siftstack.com', mockItems);
      const url = new URL(result);
      
      expect(url.searchParams.get('channelIds')).toBe('channel-1,channel-2');
    });

    it('should include time range when provided', () => {
      const timeRange: SharelinkTimeRange = {
        from: '2024-01-01T00:00:00Z',
        to: '2024-01-02T00:00:00Z',
      };
      
      const result = generateLinkFromQuery('app.siftstack.com', mockItems, timeRange);
      const url = new URL(result);
      
      expect(url.searchParams.get('startTime')).toBe(timeRange.from);
      expect(url.searchParams.get('endTime')).toBe(timeRange.to);
    });

    it('should ignore calculated channels when building the URL', () => {
      const itemsWithCalc: SharelinkItems = {
        channelIds: ['channel-1'],
        assetIds: ['asset-1'],
        runIds: ['run-1'],
        calculatedChannels: [
          {
            name: 'calc-1',
            sourceChannels: ['channel-1'],
            expression: '$1',
            expressionDataType: 'double',
          },
          {
            name: 'calc-2',
            sourceChannels: ['channel-1'],
            expression: '$1 * 2',
            expressionDataType: 'double',
          },
        ],
      };

      const result = generateLinkFromQuery('app.siftstack.com', itemsWithCalc);
      const url = new URL(result);

      expect(url.searchParams.get('channelIds')).toBe('channel-1');
      expect(url.toString()).not.toContain('expression');
    });
  });

  describe('edge cases', () => {
    it('should handle empty asset and run arrays', () => {
      const items: SharelinkItems = {
        channelIds: ['channel-1'],
        assetIds: [],
        runIds: [],
        calculatedChannels: [],
      };
      
      const result = generateLinkFromQuery('app.siftstack.com', items);
      const url = new URL(result);
      
      expect(result).toMatch(/^https:\/\/app\.siftstack\.com\/explore\?/);
      expect(url.searchParams.has('assetIds')).toBe(false);
      expect(url.searchParams.has('runIds')).toBe(false);
    });

    it('should handle undefined asset and run arrays', () => {
      const items: SharelinkItems = {
        channelIds: ['channel-1'],
        assetIds: undefined,
        runIds: undefined,
        calculatedChannels: [],
      };
      
      const result = generateLinkFromQuery('app.siftstack.com', items);
      const url = new URL(result);
      
      expect(result).toMatch(/^https:\/\/app\.siftstack\.com\/explore\?/);
      expect(url.searchParams.has('assetIds')).toBe(false);
      expect(url.searchParams.has('runIds')).toBe(false);
    });

    it('should handle special characters in channel IDs', () => {
      const items: SharelinkItems = {
        channelIds: ['channel-with-dash', 'channel_with_underscore'],
        assetIds: ['asset-1'],
        runIds: ['run-1'],
        calculatedChannels: [],
      };
      
      const result = generateLinkFromQuery('app.siftstack.com', items);
      const url = new URL(result);
      
      expect(result).toMatch(/^https:\/\/app\.siftstack\.com\/explore\?/);
      expect(url.searchParams.get('channelIds')).toBe('channel-with-dash,channel_with_underscore');
    });

    it('should handle IPv4 addresses', () => {
      const result = generateLinkFromQuery('192.168.1.1:8080', mockItems);
      
      expect(result).toMatch(/^https:\/\/192\.168\.1\.1:8080\/explore\?/);
    });

    it('should handle localhost variations', () => {
      const result1 = generateLinkFromQuery('localhost', mockItems);
      expect(result1).toMatch(/^https:\/\/localhost\/explore\?/);

      const result2 = generateLinkFromQuery('http://localhost:3000', mockItems);
      expect(result2).toMatch(/^http:\/\/localhost:3000\/explore\?/);
    });
  });

  describe('URL structure validation', () => {
    it('should generate valid URL structure', () => {
      const result = generateLinkFromQuery('app.siftstack.com', mockItems);
      
      // Should be a valid URL
      expect(() => new URL(result)).not.toThrow();
      
      const url = new URL(result);
      expect(url.protocol).toMatch(/^https?:$/);
      expect(url.pathname).toBe('/explore');
      expect(url.search).toMatch(/^\?.+/);
    });

    it('should properly encode query parameters', () => {
      const result = generateLinkFromQuery('app.siftstack.com', mockItems);
      const url = new URL(result);
      
      expect(url.searchParams.has('method')).toBe(true);
      expect(url.searchParams.has('channelIds')).toBe(true);
      expect(url.searchParams.has('assetIds')).toBe(true);
      expect(url.searchParams.has('runIds')).toBe(true);
    });

    it('should not double-encode URL components', () => {
      const result = generateLinkFromQuery('app.siftstack.com', mockItems);
      
      // Should not contain double-encoded characters like %25 (encoded %)
      expect(result).not.toContain('%25');
    });
  });
});
