// Marks the module as loaded so the kit's end-to-end spec can see it ran.
Hooks.once("ready", () => {
  globalThis.foundryTestKitFixtureReady = true;
});
