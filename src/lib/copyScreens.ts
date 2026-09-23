/** The golden path and the shared components that carry its visible copy. */
export const COPY_SCREENS: Record<string, string[]> = {
  home: ["app/page.tsx", "components/home", "components/SetupGateScreen.tsx"],
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
