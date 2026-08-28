// Global test setup
require('dotenv').config({ path: '.env.test' });

// Increase timeout for integration tests
jest.setTimeout(30000);

// Clean up after tests
afterAll(async () => {
  // Close any open connections
});

// Mock console methods in tests
global.console = {
  ...console,
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
};
