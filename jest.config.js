// force timezone to UTC to allow tests to work regardless of local timezone
// generally used by snapshots, but can affect specific tests
process.env.TZ = 'UTC';

const baseConfig = require('./.config/jest.config');

module.exports = {
  // Jest configuration provided by Grafana scaffolding
  ...baseConfig,
  moduleNameMapper: {
    ...baseConfig.moduleNameMapper,
    '\\.(svg)$': '<rootDir>/jest/mocks/svgMock.ts',
  },
  // Increase default timeout for all tests to 15 seconds
  testTimeout: 15000,
};
