import type { Message, PassRecord } from "@/lib/types";

/**
 * Seed data loaded when the page mounts with `?demo=1`. Used to verify
 * layout, markdown rendering, and the hemisphere rail without standing
 * up the four-service backend stack.
 */

export const DEMO_CONVERSATION_ID = "demo-0000-0000-0000-0000-00000000";

export const DEMO_MESSAGES: Message[] = [
  {
    role: "user",
    content: "Hi Eugene. What can you tell me about the structure of The Lord of the Rings?",
  },
  {
    role: "assistant",
    content: `**The Lord of the Rings** is a single novel that Tolkien split into three volumes for publishing reasons — it isn't really a trilogy in the structural sense.

### The six books

Each volume contains two books:

1. *The Fellowship of the Ring* — Books I & II
2. *The Two Towers* — Books III & IV
3. *The Return of the King* — Books V & VI

### Why split it?

Post-WWII paper shortages in the UK made a single 1,200-page hardcover commercially unviable. Tolkien resisted the split but his publisher won. He later wrote:

> I am sorry to leave the title in such a state, but the book *cannot* be one volume. It is now one book in six books.

### A small reading note

If you're approaching it for the first time, the appendices in *Return of the King* are load-bearing — \`Appendix A\` covers the post-War of the Ring history of Aragorn and Arwen, and \`Appendix B\` is the chronology of the Third Age.

| Volume | Books | Approx. word count |
| --- | --- | --- |
| Fellowship | I, II | ~187,000 |
| Two Towers | III, IV | ~156,000 |
| Return of the King | V, VI | ~137,000 |

---

Want me to go deeper on any of these — the legendarium framing, the publication history, or the structure of an individual book?`,
  },
  {
    role: "user",
    content: "What about The Hobbit? How does it relate?",
  },
  {
    role: "assistant",
    content: `*The Hobbit* (1937) was published seventeen years before *The Lord of the Rings* (1954–55) and was originally a standalone children's book — not part of the legendarium Tolkien had been quietly building since 1917.

Three things happened to bind them:

- The success of *The Hobbit* prompted Allen & Unwin to ask for a sequel.
- Tolkien used the sequel commission as cover to finally publish material from his "real" mythology — what would become *LotR* and (posthumously) *The Silmarillion*.
- He retroactively revised Chapter 5 of *The Hobbit* — Bilbo's riddle game — in the 1951 second edition, to make Gollum's behavior consistent with the Ring being *the* One Ring rather than a generic magic ring.

So *The Hobbit* is best read as the prequel that forced its own backstory into existence.`,
  },
];

export const DEMO_PASSES: PassRecord[] = [
  {
    passIndex: 0,
    hemispheres: [
      {
        role: "hemisphere",
        driverName: "left",
        content:
          "The Hobbit (1937) precedes LotR (1954-55) by 17 years. Originally standalone children's literature; the Ring in The Hobbit was a generic invisibility ring. Tolkien revised Chapter 5 in the 1951 second edition to make Gollum's behavior consistent with the One Ring of LotR. The relationship is best described as 'retroactive prequel' — The Hobbit drew Tolkien's pre-existing legendarium (the Silmarillion mythology, in development since 1917) into commercial print.",
        passIndex: 0,
      },
      {
        role: "hemisphere",
        driverName: "right",
        content: `Key relationship points:

- **Publication**: Hobbit 1937 → LotR 1954-55
- **Origin**: Hobbit was standalone children's lit, not part of the legendarium
- **Continuity retrofit**: Ch. 5 ("Riddles in the Dark") rewritten in 1951 ed. so Bilbo's encounter with Gollum aligns with One Ring lore
- **Causal chain**: Hobbit's commercial success → publisher requests sequel → Tolkien uses sequel slot to publish the legendarium he'd been building since WWI

So they're connected but the connection is partly post-hoc.`,
        passIndex: 0,
      },
    ],
    callosum: {
      agreement: 0.71,
      decision: "another_pass",
    },
  },
  {
    passIndex: 1,
    hemispheres: [
      {
        role: "hemisphere",
        driverName: "left",
        content:
          "Both passes converge on: 17-year publication gap, retroactive Chapter 5 revision in 1951, and the 'Hobbit success → sequel commission → legendarium publication' causal chain. The right hemisphere's framing ('retroactive prequel') is a cleaner one-line summary than my prose version.",
        passIndex: 1,
      },
      {
        role: "hemisphere",
        driverName: "right",
        content:
          "Agreement seems high. Both passes hit the same load-bearing facts: 1937 vs 1954, the Ch. 5 revision, the commission-as-cover-for-legendarium. Suggest terminating with a blended response that leads with the temporal/structural relationship and uses the bullet form for the three causal steps.",
        passIndex: 1,
      },
    ],
    callosum: {
      agreement: 0.93,
      decision: "terminate",
    },
  },
];
