// force timezone to UTC to allow tests to work regardless of local timezone
// generally used by snapshots, but can affect specific tests
process.env.TZ = 'UTC';

const { grafanaESModules, nodeModulesToTransform } = require('./.config/jest/utils');

module.exports = {
  // Jest configuration provided by Grafana scaffolding
  ...require('./.config/jest.config'),
  // Increase default timeout for all tests to 15 seconds
  testTimeout: 15000,
  // Add nanoid and leven to the list of ES modules to transform
  transformIgnorePatterns: [nodeModulesToTransform([...grafanaESModules, 'nanoid', 'leven'])],
};
