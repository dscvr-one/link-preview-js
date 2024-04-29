import type { Config } from 'jest';

const config: Config = {
  preset: `ts-jest`,
  testEnvironment: `node`,
  extensionsToTreatAsEsm: ['.ts'],
  globals: { 'ts-jest': { diagnostics: false } },
  modulePathIgnorePatterns: ['<rootDir>/build/', '<rootDir>/node_modules/'],
};

export default config;
