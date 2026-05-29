import type { Config } from "jest";

const config: Config = {
  testEnvironment: "node",
  rootDir: ".",
  testMatch: ["<rootDir>/src/__tests__/**/*.test.ts"],
  globalSetup: "<rootDir>/src/__tests__/setup/global.ts",
  setupFiles: ["<rootDir>/src/__tests__/setup/env.ts"],
  setupFilesAfterEnv: ["<rootDir>/src/__tests__/setup/db.ts"],
  testTimeout: 15000,
  clearMocks: true,
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: "tsconfig.test.json" }],
  },
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/__tests__/**",
  ],
  coverageReporters: ["text", "lcov"],
};

export default config;
