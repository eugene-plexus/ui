"use client";

/**
 * Wizard screen: What is about to be set up, in plain language.
 *
 * One screen per module since M9. Nothing here reads or writes the
 * install - a screen renders the draft and reports edits upwards, and
 * every write happens once, in `page.tsx`, when Start is pressed.
 */

export function ScreenWelcome() {
  return (
    <section>
      <h2 className="font-ui mb-2 text-xl font-semibold">Welcome</h2>
      <p className="mb-4 text-sm leading-relaxed">
        Eugene Plexus is a control plane for local inference. It doesn&rsquo;t run models itself —
        it supervises the engines that do, and puts one endpoint in front of them. The pieces:
      </p>
      <ul className="mb-4 ml-6 list-disc text-sm leading-relaxed text-[color:var(--muted)]">
        <li>
          <span className="text-[color:var(--foreground)]">Supervisor</span> — starts and watches
          engine processes, holds the topology, serves this UI.
        </li>
        <li>
          <span className="text-[color:var(--foreground)]">Gateway</span> — one OpenAI-compatible
          endpoint. It works out which backend serves which model from the topology, so there is no
          routing table to maintain by hand.
        </li>
        <li>
          <span className="text-[color:var(--foreground)]">Drivers</span> — one per backend. A
          driver knows how to talk to its own engine and nothing else. Setup configures one; add
          more from Config whenever.
        </li>
      </ul>
      <p className="text-sm leading-relaxed text-[color:var(--muted)]">
        Every step has a sensible default and nothing here is permanent — the Config page edits all
        of it later.
      </p>
    </section>
  );
}
