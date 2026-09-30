/**
 * @scooper4711/foundry-test-kit — Playwright integration testing for
 * Foundry VTT modules.
 */
export { loadTestKitConfig, testUser, type TestKitConfig, type WorldConfig, type SeedSetting } from "./config.js";
export { defineFoundryConfig, type FoundryConfigOptions } from "./playwright-config.js";
export {
  test,
  expect,
  type FoundryTestOptions,
  type FoundryTestFixtures,
  type FoundryWorkerFixtures,
} from "./fixtures.js";
export { FOUNDRY_VIEWPORT, testBaseUrl, suiteContextOptions, disableSceneCanvas } from "./context.js";
export { clickPastPopups, dismissTours, dismissOverlays, ensureAdminAccess } from "./overlays.js";
export { adminPasswordField } from "./foundry-ui.js";
export { waitForGameReady, joinAsGamemaster, joinAsUser, joinAsPlayer } from "./join.js";
export { enterGameAsGamemaster, ensureModuleActive, withGamemasterPage } from "./session.js";
export {
  DEFAULT_GAMEMASTER_NAME,
  DEFAULT_PLAYER_NAME,
  USER_ROLE_LEVELS,
  findSeedUser,
  type UserRole,
  type SeedUser,
  type GamemasterAccount,
  type SeedUsersConfig,
} from "./users.js";
export { startCoverage, stopCoverage, coverageChunkName, moduleBundleMarker, COVERAGE_RAW_DIR } from "./coverage.js";
export {
  importPregen,
  createParty,
  deleteActorsByPrefix,
  deleteChatMessages,
  setSetting,
  updateActor,
  readActorFlag,
  assignCharacterToUser,
  renderActorSheet,
  closeAllSheets,
  gameSystemId,
  type PregenRequest,
  type SocietyIdentity,
} from "./world.js";
