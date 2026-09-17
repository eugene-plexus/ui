/**
 * The licence and copyright line, in the three places it belongs.
 *
 * **There is deliberately no footer.** A footer on a control plane is a
 * band of chrome on every screen carrying one sentence nobody reads,
 * and it costs vertical space on the screens that need it most -- the
 * playground's transcript, the library's list. So the line appears
 * where someone would actually go looking for it: the foot of the layer
 * map (the panel that explains what this thing is), the Login card (the
 * first screen anyone sees, and the one with room), and a Config -> UI
 * About row (where a person looks for a version).
 *
 * One module because the string is a legal notice, and three copies of
 * a legal notice are three chances for one of them to drift. The
 * component takes a className so each site keeps its own type scale
 * rather than forcing a shared one on three different contexts.
 *
 * NOT a link. Apache-2.0's own text is the obvious target and it lives
 * on the internet; this UI is built to run on a tailnet, behind a home
 * firewall, and on a machine with no route out at all. A dead link in a
 * licence notice is worse than no link.
 */
export const ATTRIBUTION = "Apache-2.0 · Copyright 2026 Eugene Plexus contributors";

export function Attribution({ className = "" }: { className?: string }) {
  return (
    <p data-testid="attribution" className={`font-ui text-[color:var(--muted)] ${className}`}>
      {ATTRIBUTION}
    </p>
  );
}
