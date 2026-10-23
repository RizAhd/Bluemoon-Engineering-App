/**
 * Jest setup for the real data layer. Wired in package.json as
 * "setupFilesAfterEnv", so every test file gets these mocks without writing any:
 *
 *   expo-sqlite            -> sqliteShim.ts   (node:sqlite, in memory or files)
 *   expo-file-system       -> fakeFs.ts       (File / Directory / Paths on a temp folder)
 *   expo-crypto            -> node:crypto     (randomUUID, digest SHA-256 ...)
 *   expo-image-manipulator -> copies the file, "compressed"
 *   expo-image-picker      -> returns what queuePhotos() queued, else "cancelled"
 *   expo-print             -> a valid one-page PDF
 *   expo-asset             -> the letterhead picture, copied into the phone cache
 *   expo-haptics, expo-sharing, expo-application, expo-localization (en),
 *   expo-background-task, expo-task-manager -> no-ops you can assert on
 *   expo-secure-store      -> in memory; expo-local-authentication -> no sensor
 *
 * Every factory is lazy, so test files that never import these modules (the
 * money / dates / utf8 tests) pay nothing. The helpers are in '@/test-utils'
 * (index.ts), not here, for the same reason.
 *
 * After each test file every phone's temp folder and database is deleted.
 */
/* eslint-disable @typescript-eslint/no-require-imports */

jest.mock('expo-sqlite', () => require('./sqliteShim'));
jest.mock('expo-file-system', () => require('./fakeFs'));
jest.mock('expo-crypto', () => require('./mocks').cryptoMock());
jest.mock('expo-image-manipulator', () => require('./mocks').imageManipulatorMock());
jest.mock('expo-image-picker', () => require('./mocks').imagePickerMock());
jest.mock('expo-asset', () => require('./mocks').assetMock());
jest.mock('expo-print', () => require('./mocks').printMock());
jest.mock('expo-haptics', () => require('./mocks').hapticsMock());
jest.mock('expo-localization', () => require('./mocks').localizationMock());
jest.mock('expo-application', () => require('./mocks').applicationMock());
jest.mock('expo-sharing', () => require('./mocks').sharingMock());
jest.mock('expo-background-task', () => require('./mocks').backgroundTaskMock());
jest.mock('expo-task-manager', () => require('./mocks').taskManagerMock());
jest.mock('expo-secure-store', () => require('./mocks').secureStoreMock());
jest.mock('expo-local-authentication', () => require('./mocks').localAuthMock());
// Tamagui without its animation driver: switches and bars jump to their end state, so no Animated update lands outside act().
jest.mock('@tamagui/config/animations-rn', () => ({ animationsReactNative: undefined }));

afterAll(() => {
  require('./world').disposeAll();
});
