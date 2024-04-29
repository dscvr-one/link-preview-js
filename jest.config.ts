import type { Config } from 'jest';

const config: Config = {
  modulePathIgnorePatterns: ['<rootDir>/build/'],
  extensionsToTreatAsEsm: ['.ts'],
  preset: 'ts-jest',
  testEnvironment: 'node',
  globals: {
    'ts-jest': {
      useESM: true,
    },
  },
};

export default config;
