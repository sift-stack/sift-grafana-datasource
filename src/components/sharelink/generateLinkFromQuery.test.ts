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
      
      expect(result).toMatch(/^https:\/\/app\.siftstack\.com\/explorer#/);
    });

    it('should handle hostname with https:// protocol', () => {
      const result = generateLinkFromQuery('https://app.siftstack.com', mockItems);
      
      expect(result).toMatch(/^https:\/\/app\.siftstack\.com\/explorer#/);
    });

    it('should handle hostname with http:// protocol', () => {
      const result = generateLinkFromQuery('http://localhost:3000', mockItems);
      
      expect(result).toMatch(/^http:\/\/localhost:3000\/explorer#/);
    });

    it('should handle hostname with port', () => {
      const result = generateLinkFromQuery('localhost:8080', mockItems);
      
      expect(result).toMatch(/^https:\/\/localhost:8080\/explorer#/);
    });

    it('should extract origin from full URL with path', () => {
      const result = generateLinkFromQuery('https://app.siftstack.com/some/path', mockItems);
      
      // Should use only the origin, not the path
      expect(result).toMatch(/^https:\/\/app\.siftstack\.com\/explorer#/);
      expect(result).not.toContain('/some/path');
    });

    it('should handle URL with query parameters by using only origin', () => {
      const result = generateLinkFromQuery('https://app.siftstack.com?foo=bar', mockItems);
      
      expect(result).toMatch(/^https:\/\/app\.siftstack\.com\/explorer#/);
      expect(result).not.toContain('?foo=bar');
    });

    it('should handle URL with trailing slash', () => {
      const result = generateLinkFromQuery('https://app.siftstack.com/', mockItems);
      
      expect(result).toMatch(/^https:\/\/app\.siftstack\.com\/explorer#/);
    });
  });

  describe('hash parameters encoding', () => {
    it('should include assets in hash', () => {
      const items: SharelinkItems = {
        channelIds: ['channel-1'],
        assetIds: ['asset-1', 'asset-2'],
        runIds: [],
        calculatedChannels: [],
      };
      
      const result = generateLinkFromQuery('app.siftstack.com', items);
      
      expect(result).toContain('assets=asset-1%2Casset-2');
    });

    it('should include runs in hash', () => {
      const items: SharelinkItems = {
        channelIds: ['channel-1'],
        assetIds: [],
        runIds: ['run-1', 'run-2'],
        calculatedChannels: [],
      };
      
      const result = generateLinkFromQuery('app.siftstack.com', items);
      
      expect(result).toContain('runs=run-1%2Crun-2');
    });

    it('should base64 encode legend configuration', () => {
      const result = generateLinkFromQuery('app.siftstack.com', mockItems);
      
      // Should contain base64 encoded legend
      expect(result).toContain('legend=');
      // Base64 strings typically contain these characters
      expect(result).toMatch(/legend=[A-Za-z0-9+/=%]+/);
    });

    it('should include time range in legend when provided', () => {
      const timeRange: SharelinkTimeRange = {
        from: '2024-01-01T00:00:00Z',
        to: '2024-01-02T00:00:00Z',
      };
      
      const result = generateLinkFromQuery('app.siftstack.com', mockItems, timeRange);
      
      // The time range should be encoded in the legend parameter
      expect(result).toContain('legend=');
    });

    it('should handle calculated channels', () => {
      const itemsWithCalc: SharelinkItems = {
        channelIds: ['channel-1'],
        assetIds: ['asset-1'],
        runIds: ['run-1'],
        calculatedChannels: [
          {
            name: 'Calculated Channel',
            sourceChannels: ['channel-1', 'channel-2'],
            expression: '$1 + $2',
            expressionDataType: 'DOUBLE',
          },
        ],
      };
      
      const result = generateLinkFromQuery('app.siftstack.com', itemsWithCalc);
      
      // Should still generate a valid URL with legend
      expect(result).toMatch(/^https:\/\/app\.siftstack\.com\/explorer#/);
      expect(result).toContain('legend=');
    });

    it('should handle multiple calculated channels', () => {
      const itemsWithMultipleCalc: SharelinkItems = {
        channelIds: ['channel-1'],
        assetIds: ['asset-1'],
        runIds: ['run-1'],
        calculatedChannels: [
          {
            name: 'Calc 1',
            sourceChannels: ['channel-1'],
            expression: '$1 * 2',
            expressionDataType: 'DOUBLE',
          },
          {
            name: 'Calc 2',
            sourceChannels: ['channel-1', 'channel-2'],
            expression: '$1 + $2',
            expressionDataType: 'DOUBLE',
          },
        ],
      };
      
      const result = generateLinkFromQuery('app.siftstack.com', itemsWithMultipleCalc);
      
      expect(result).toMatch(/^https:\/\/app\.siftstack\.com\/explorer#/);
      expect(result).toContain('legend=');
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
      
      expect(result).toMatch(/^https:\/\/app\.siftstack\.com\/explorer#/);
      // Should not include assets or runs parameters
      expect(result).not.toContain('assets=');
      expect(result).not.toContain('runs=');
    });

    it('should handle undefined asset and run arrays', () => {
      const items: SharelinkItems = {
        channelIds: ['channel-1'],
        assetIds: undefined,
        runIds: undefined,
        calculatedChannels: [],
      };
      
      const result = generateLinkFromQuery('app.siftstack.com', items);
      
      expect(result).toMatch(/^https:\/\/app\.siftstack\.com\/explorer#/);
      expect(result).not.toContain('assets=');
      expect(result).not.toContain('runs=');
    });

    it('should handle special characters in channel IDs', () => {
      const items: SharelinkItems = {
        channelIds: ['channel-with-dash', 'channel_with_underscore'],
        assetIds: ['asset-1'],
        runIds: ['run-1'],
        calculatedChannels: [],
      };
      
      const result = generateLinkFromQuery('app.siftstack.com', items);
      
      expect(result).toMatch(/^https:\/\/app\.siftstack\.com\/explorer#/);
      expect(result).toContain('legend=');
    });

    it('should handle IPv4 addresses', () => {
      const result = generateLinkFromQuery('192.168.1.1:8080', mockItems);
      
      expect(result).toMatch(/^https:\/\/192\.168\.1\.1:8080\/explorer#/);
    });

    it('should handle localhost variations', () => {
      const result1 = generateLinkFromQuery('localhost', mockItems);
      expect(result1).toMatch(/^https:\/\/localhost\/explorer#/);

      const result2 = generateLinkFromQuery('http://localhost:3000', mockItems);
      expect(result2).toMatch(/^http:\/\/localhost:3000\/explorer#/);
    });
  });

  describe('URL structure validation', () => {
    it('should generate valid URL structure', () => {
      const result = generateLinkFromQuery('app.siftstack.com', mockItems);
      
      // Should be a valid URL
      expect(() => new URL(result)).not.toThrow();
      
      const url = new URL(result);
      expect(url.protocol).toMatch(/^https?:$/);
      expect(url.pathname).toBe('/explorer');
      expect(url.hash).toMatch(/^#.+/);
    });

    it('should properly encode hash parameters', () => {
      const result = generateLinkFromQuery('app.siftstack.com', mockItems);
      const url = new URL(result);
      
      // Hash should be parseable as URLSearchParams (without the # prefix)
      const hashParams = new URLSearchParams(url.hash.slice(1));
      
      expect(hashParams.has('legend')).toBe(true);
      expect(hashParams.has('assets')).toBe(true);
      expect(hashParams.has('runs')).toBe(true);
    });

    it('should not double-encode URL components', () => {
      const result = generateLinkFromQuery('app.siftstack.com', mockItems);
      
      // Should not contain double-encoded characters like %25 (encoded %)
      expect(result).not.toContain('%25');
    });
  });
});
