const path = require('path');

const domainTsconfig = path.join(__dirname, 'packages/domain/tsconfig.json');
const domainTransform = [
  '^.+[\\\\/]packages[\\\\/]domain[\\\\/].+\\.ts$',
  ['ts-jest', { tsconfig: domainTsconfig }],
];

/** @type {import('jest').Config} */
module.exports = {
  projects: [
    {
      displayName: 'domain',
      rootDir: path.join(__dirname, 'packages/domain'),
      testRegex: '.*\\.spec\\.ts$',
      transform: {
        '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
      },
      testEnvironment: 'node',
    },
    {
      displayName: 'transaction-api',
      rootDir: path.join(__dirname, 'src'),
      testRegex: '.*\\.spec\\.ts$',
      transform: {
        [domainTransform[0]]: domainTransform[1],
        '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.json' }],
      },
      testEnvironment: 'node',
      moduleNameMapper: {
        '^@eventsourcing/domain$': '<rootDir>/../packages/domain/src/index.ts',
      },
    },
    {
      displayName: 'history-api',
      rootDir: path.join(__dirname, 'history'),
      testRegex: '.*\\.spec\\.ts$',
      transform: {
        [domainTransform[0]]: domainTransform[1],
        '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
      },
      testEnvironment: 'node',
      testTimeout: 30000,
      moduleNameMapper: {
        '^@eventsourcing/domain$': '<rootDir>/../packages/domain/src/index.ts',
      },
    },
  ],
};
