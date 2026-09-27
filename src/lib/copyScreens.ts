/** The golden path and the shared components that carry its visible copy. */
export const COPY_SCREENS: Record<string, string[]> = {
  home: [
    "app/page.tsx",
    "components/home",
    "components/SetupGateScreen.tsx",
    // Home's Try it card renders both, and the wait is where a first-time
    // person reads the most words (2026-09-27).
    "components/ChatLog.tsx",
    "components/WorkingIndicator.tsx",
    "lib/workingState.ts",
  ],
  wizard: ["app/setup"],
  discover: [
    "app/discover",
    "components/StarterSetPanel.tsx",
    "components/ModelCard.tsx",
    "components/DownloadsPanel.tsx",
    "components/FitBadge.tsx",
  ],
  library: [
    "app/library",
    "components/RunButton.tsx",
    "components/RunDialog.tsx",
    "components/ProfileEditor.tsx",
    "components/ProfileBenchmark.tsx",
  ],
  playground: ["app/playground"],
  // Not on the golden path, but a screen a person with two machines
  // meets, and it carried "epoch", "Mint" and "topology" in plain view.
  nodes: ["app/nodes"],
};
