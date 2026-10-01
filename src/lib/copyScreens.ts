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
    // A3c: the fit words the badge, the starter set, Home and the
    // Library's panel all render.
    "lib/fitWords.ts",
  ],
  library: [
    "app/library",
    "components/RunButton.tsx",
    "components/RunDialog.tsx",
    "components/ProfileEditor.tsx",
    "components/ProfileBenchmark.tsx",
    // PB2: the settings builder, its shared stop question, and its words.
    "components/ProfileBuilder.tsx",
    "components/AskBeforeStopping.tsx",
    "lib/profileBuild.ts",
    // A3d: Low's smaller-file offer.
    "components/SmallerFileOffer.tsx",
    "lib/smallerFile.ts",
  ],
  // The other doors (playground-doors.md) are a person's first look at
  // speech, pictures and video, so their words are held to the same rules.
  playground: [
    "app/playground",
    "components/doors",
    "components/SpokenReplyPanel.tsx",
    "lib/completionDoor.ts",
    "lib/mediaAttachments.ts",
    "lib/imageDoor.ts",
    "lib/speechDoor.ts",
    "lib/transcriptionDoor.ts",
    "lib/videoDoor.ts",
  ],
  // Not on the golden path, but a screen a person with two machines
  // meets, and it carried "epoch", "Mint" and "topology" in plain view.
  nodes: ["app/nodes", "components/NodeUpdateCard.tsx", "lib/updates.ts"],
  // C2: the owner of a small business reads this page to add the people
  // who sign in to the apps.
  people: ["app/people", "lib/people.ts"],
};
