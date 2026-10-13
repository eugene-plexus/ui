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

const LONG =
  "How the control root keeps its key between restarts.\n\n" +
  "**The keyring is host-bound.** The key lives in *this* machine's store.\n\n" +
  "A file is `not` host-bound.\n\n" +
  "- first reason\n- second reason";

describe("Help", () => {
  it("shows the first sentence, and keeps the rest closed until it is opened", async () => {
    render(<Help text={LONG} />);
    expect(screen.getByText("How the control root keeps its key between restarts.")).toBeVisible();
    expect(screen.getByText("The keyring is host-bound.")).not.toBeVisible();
    const toggle = screen.getByText("More");
    expect(toggle.closest("details")).not.toHaveAttribute("open");

    await userEvent.click(toggle);
    expect(toggle.closest("details")).toHaveAttribute("open");
    expect(screen.getByText("The keyring is host-bound.")).toBeVisible();
    // The label says what a click does now, and the summary never went away.
    expect(screen.getByText("Less")).toBe(toggle);
    expect(screen.getByText("How the control root keeps its key between restarts.")).toBeVisible();

    await userEvent.click(toggle);
    expect(screen.getByText("The keyring is host-bound.")).not.toBeVisible();
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
    expect(screen.getByText("The keyring is host-bound.").tagName).toBe("STRONG");
    expect(screen.getByText("this").tagName).toBe("EM");
    expect(screen.getByText("not").tagName).toBe("CODE");
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "first reason",
      "second reason",
    ]);
    // Paragraphs stay paragraphs: the blank lines were what the page lost.
    const details = document.querySelector("details")!;
    expect(details.querySelectorAll("p")).toHaveLength(2);
    expect(document.body.textContent).not.toContain("**");
    expect(document.body.textContent).not.toContain("`");
  });

  it("puts the id on the summary alone, so an input is described by the line and not the wall", () => {
    render(<Help id="the-line" text={LONG} />);
    const line = document.getElementById("the-line")!;
    expect(line).toHaveTextContent("How the control root keeps its key between restarts.");
    expect(line).not.toHaveTextContent("host-bound");
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
