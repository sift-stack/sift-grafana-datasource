import { getFrontendHostnameDefaults } from './getFrontendHostnameDefaults';

describe('getFrontendHostnameDefaults', () => {
  describe('known API endpoints', () => {
    it('should map api.siftstack.com to app.siftstack.com', () => {
      expect(getFrontendHostnameDefaults('api.siftstack.com')).toBe('app.siftstack.com');
    });

    it('should map api.siftstack.com with https:// to app.siftstack.com', () => {
      expect(getFrontendHostnameDefaults('https://api.siftstack.com')).toBe('app.siftstack.com');
    });

    it('should map api.siftstack.com with http:// to app.siftstack.com', () => {
      expect(getFrontendHostnameDefaults('http://api.siftstack.com')).toBe('app.siftstack.com');
    });

    it('should map gov.api.siftstack.com to gov.siftstack.com', () => {
      expect(getFrontendHostnameDefaults('gov.api.siftstack.com')).toBe('gov.siftstack.com');
    });

    it('should map gov.api.siftstack.com with https:// to gov.siftstack.com', () => {
      expect(getFrontendHostnameDefaults('https://gov.api.siftstack.com')).toBe('gov.siftstack.com');
    });

    it('should map localhost:8080 to http://localhost:3000', () => {
      expect(getFrontendHostnameDefaults('localhost:8080')).toBe('http://localhost:3000');
    });

    it('should map localhost:8080 with http:// to http://localhost:3000', () => {
      expect(getFrontendHostnameDefaults('http://localhost:8080')).toBe('http://localhost:3000');
    });

    it('should map host.docker.internal:8080 to http://localhost:3000', () => {
      expect(getFrontendHostnameDefaults('host.docker.internal:8080')).toBe('http://localhost:3000');
    });

    it('should map host.docker.internal:8080 with http:// to http://localhost:3000', () => {
      expect(getFrontendHostnameDefaults('http://host.docker.internal:8080')).toBe('http://localhost:3000');
    });
  });

  describe('URL parsing with protocol', () => {
    it('should extract host from URL with https protocol', () => {
      expect(getFrontendHostnameDefaults('https://api.siftstack.com')).toBe('app.siftstack.com');
    });

    it('should extract host from URL with http protocol', () => {
      expect(getFrontendHostnameDefaults('http://api.siftstack.com')).toBe('app.siftstack.com');
    });

    it('should extract host from URL with path', () => {
      expect(getFrontendHostnameDefaults('https://api.siftstack.com/some/path')).toBe('app.siftstack.com');
    });

    it('should extract host from URL with query parameters', () => {
      expect(getFrontendHostnameDefaults('https://api.siftstack.com?foo=bar')).toBe('app.siftstack.com');
    });

    it('should extract host from URL with port', () => {
      expect(getFrontendHostnameDefaults('https://api.siftstack.com:8443')).toBe(null);
    });

    it('should handle URL with trailing slash', () => {
      expect(getFrontendHostnameDefaults('https://api.siftstack.com/')).toBe('app.siftstack.com');
    });
  });

  describe('hostname without protocol', () => {
    it('should handle plain hostname', () => {
      expect(getFrontendHostnameDefaults('api.siftstack.com')).toBe('app.siftstack.com');
    });

    it('should handle hostname with port', () => {
      expect(getFrontendHostnameDefaults('localhost:8080')).toBe('http://localhost:3000');
    });

    it('should handle hostname with subdomain', () => {
      expect(getFrontendHostnameDefaults('gov.api.siftstack.com')).toBe('gov.siftstack.com');
    });
  });

  describe('unknown endpoints', () => {
    it('should return null for unknown hostname', () => {
      expect(getFrontendHostnameDefaults('unknown.example.com')).toBe(null);
    });

    it('should return null for unknown hostname with https://', () => {
      expect(getFrontendHostnameDefaults('https://unknown.example.com')).toBe(null);
    });

    it('should return null for unknown hostname with port', () => {
      expect(getFrontendHostnameDefaults('unknown.example.com:8080')).toBe(null);
    });

    it('should return null for unknown localhost port', () => {
      expect(getFrontendHostnameDefaults('localhost:9999')).toBe(null);
    });
  });

  describe('edge cases', () => {
    it('should return null for empty string', () => {
      expect(getFrontendHostnameDefaults('')).toBe(null);
    });

    it('should return null for whitespace only', () => {
      expect(getFrontendHostnameDefaults('   ')).toBe(null);
    });

    it('should handle URL with extra whitespace', () => {
      expect(getFrontendHostnameDefaults('  https://api.siftstack.com  ')).toBe('app.siftstack.com');
    });

    it('should handle hostname with extra whitespace', () => {
      expect(getFrontendHostnameDefaults('  api.siftstack.com  ')).toBe('app.siftstack.com');
    });

    it('should handle IPv4 address', () => {
      expect(getFrontendHostnameDefaults('192.168.1.1:8080')).toBe(null);
    });

    it('should handle IPv4 address with protocol', () => {
      expect(getFrontendHostnameDefaults('http://192.168.1.1:8080')).toBe(null);
    });
  });

  describe('URL constructor behavior', () => {
    it('should properly extract host from full URL', () => {
      const result = getFrontendHostnameDefaults('https://api.siftstack.com:443/api/v1');
      // Port 443 is default for https, so it should be stripped by URL.host
      expect(result).toBe('app.siftstack.com');
    });

    it('should preserve non-default ports in host extraction', () => {
      const result = getFrontendHostnameDefaults('http://localhost:8080/api');
      expect(result).toBe('http://localhost:3000');
    });

    it('should handle URLs with fragments', () => {
      const result = getFrontendHostnameDefaults('https://api.siftstack.com#section');
      expect(result).toBe('app.siftstack.com');
    });

    it('should handle URLs with authentication', () => {
      const result = getFrontendHostnameDefaults('https://user:pass@api.siftstack.com');
      expect(result).toBe('app.siftstack.com');
    });
  });

  describe('protocol variations', () => {
    it('should handle uppercase protocol', () => {
      expect(getFrontendHostnameDefaults('HTTPS://api.siftstack.com')).toBe('app.siftstack.com');
    });

    it('should handle mixed case protocol', () => {
      expect(getFrontendHostnameDefaults('HtTpS://api.siftstack.com')).toBe('app.siftstack.com');
    });

    it('should handle http protocol for known endpoint', () => {
      expect(getFrontendHostnameDefaults('http://api.siftstack.com')).toBe('app.siftstack.com');
    });
  });

  describe('special localhost cases', () => {
    it('should map localhost:8080 regardless of protocol', () => {
      expect(getFrontendHostnameDefaults('localhost:8080')).toBe('http://localhost:3000');
      expect(getFrontendHostnameDefaults('http://localhost:8080')).toBe('http://localhost:3000');
      expect(getFrontendHostnameDefaults('https://localhost:8080')).toBe('http://localhost:3000');
    });

    it('should map host.docker.internal:8080 regardless of protocol', () => {
      expect(getFrontendHostnameDefaults('host.docker.internal:8080')).toBe('http://localhost:3000');
      expect(getFrontendHostnameDefaults('http://host.docker.internal:8080')).toBe('http://localhost:3000');
      expect(getFrontendHostnameDefaults('https://host.docker.internal:8080')).toBe('http://localhost:3000');
    });
  });
});
