/**
 * Help that is short until someone asks (Troy, 2026-10-13).
 *
 * "A massive wall of text... it looks like you wrote Markdown that didn't
 * get converted into HTML so your spacing was lost. Also when a setting
 * description exceeds two lines, you generally want to hide it in an
 * accordion." Both halves are tested here: the Markdown is drawn, and the
 * long part is closed until it is opened.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { Help, More } from "./Help";

/**
 * The shape the control root writes its long settings in now (a44c772, the
 * Security mode text, shortened): one sentence, a blank line, a list with
 * bold lead-ins and a code span, and a closing paragraph.
 */
const SENTENCE = "How this control root keeps its master encryption key between restarts.";
const LONG =
  `${SENTENCE}\n\n` +
  "- **Prompt on startup**: every restart asks for the passphrase.\n" +
  "- **OS keyring**: unlocks from *this* machine's keyring. It is host-bound.\n" +
  "- **Passphrase file**: set `EUGENE_PLEXUS_CONTROL_PASSPHRASE_FILE` to its path.\n\n" +
  "Either auto-unlock mode lets anyone who can read the keyring or the file unlock this install.";

describe("Help", () => {
  it("shows the first sentence, and keeps the rest closed until it is opened", async () => {
    render(<Help text={LONG} />);
    expect(screen.getByText(SENTENCE)).toBeVisible();
    expect(screen.getByText("OS keyring")).not.toBeVisible();
    const toggle = screen.getByText("More");
    expect(toggle.closest("details")).not.toHaveAttribute("open");

    await userEvent.click(toggle);
    expect(toggle.closest("details")).toHaveAttribute("open");
    expect(screen.getByText("OS keyring")).toBeVisible();
    // The label says what a click does now, and the summary never went away.
    expect(screen.getByText("Less")).toBe(toggle);
    expect(screen.getByText(SENTENCE)).toBeVisible();

    await userEvent.click(toggle);
    expect(screen.getByText("OS keyring")).not.toBeVisible();
    expect(screen.getByText("More")).toBe(toggle);
  });

  it("offers no More for a sentence that says all there is", () => {
    render(<Help text="Where updates come from." />);
    expect(screen.getByText("Where updates come from.")).toBeVisible();
    expect(screen.queryByText("More")).toBeNull();
    expect(document.querySelector("details")).toBeNull();
  });

  it("draws nothing for text that is empty", () => {
    const { container } = render(<Help text={"  \n\n "} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("draws Markdown, not the marks it is written with", async () => {
    render(<Help text={LONG} />);
    await userEvent.click(screen.getByText("More"));
    expect(screen.getByText("OS keyring").tagName).toBe("STRONG");
    expect(screen.getByText("this").tagName).toBe("EM");
    expect(screen.getByText("EUGENE_PLEXUS_CONTROL_PASSPHRASE_FILE").tagName).toBe("CODE");
    // A list is a list, and its marks are not printed.
    expect(
      screen.getAllByRole("listitem").map((li) => li.querySelector("strong")?.textContent),
    ).toEqual(["Prompt on startup", "OS keyring", "Passphrase file"]);
    // Paragraphs stay paragraphs: the blank lines were what the page lost.
    const details = document.querySelector("details")!;
    expect(details.querySelectorAll("p")).toHaveLength(1);
    expect(document.body.textContent).not.toContain("**");
    expect(document.body.textContent).not.toContain("`");
    expect(document.body.textContent).not.toContain("- ");
  });

  it("puts the id on the summary alone, so an input is described by the line and not the wall", () => {
    render(<Help id="the-line" text={LONG} />);
    const line = document.getElementById("the-line")!;
    expect(line).toHaveTextContent(SENTENCE);
    expect(line).not.toHaveTextContent("host-bound");
    expect(line).not.toHaveTextContent("Prompt on startup");
    expect(line.closest("details")).toBeNull();
  });

  it("says what the More is about, to a screen reader", () => {
    render(<Help text={LONG} label="Security mode" />);
    const toggle = screen.getByText("More");
    expect(toggle).toHaveTextContent("More about Security mode");
    expect(toggle.querySelector(".sr-only")).not.toBeNull();
  });

  it("does not draw HTML written in the text", () => {
    const { container } = render(
      <Help
        text={'A <b>bold</b> claim <img src="x" onerror="alert(1)"> and <script>no()</script>.'}
      />,
    );
    expect(container.querySelector("b, img, script")).toBeNull();
    expect(container).toHaveTextContent("<b>bold</b>");
  });

  it("links open in a new tab and a script link goes nowhere", () => {
    render(
      <Help text="See [the docs](https://example.com/docs) or [this](javascript:alert(1))." />,
    );
    const docs = screen.getByRole("link", { name: "the docs" });
    expect(docs).toHaveAttribute("href", "https://example.com/docs");
    expect(docs).toHaveAttribute("target", "_blank");
    expect(docs.getAttribute("rel")).toContain("noopener");
    const bad = screen.queryByRole("link", { name: "this" });
    expect(bad?.getAttribute("href") ?? "").not.toContain("javascript");
  });

  it("does not turn an example address into a link, or a tilde into strikethrough", () => {
    const { container } = render(
      <Help text="Models go in ~/models, for example http://192.168.1.5:8083 and ~/more." />,
    );
    expect(container.querySelector("a, del, s")).toBeNull();
    expect(container).toHaveTextContent(
      "~/models, for example http://192.168.1.5:8083 and ~/more.",
    );
  });
});

describe("More", () => {
  it("keeps JSX behind a click, with the same two labels", async () => {
    render(
      <More label="Proxies">
        <p>
          Give the proxy a <a href="/x">fixed address</a>.
        </p>
      </More>,
    );
    expect(screen.getByText("fixed address")).not.toBeVisible();
    await userEvent.click(screen.getByText("More"));
    expect(screen.getByText("fixed address")).toBeVisible();
    expect(screen.getByText("Less")).toHaveTextContent("Less about Proxies");
  });
});
