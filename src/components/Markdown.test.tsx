/**
 * Markdown from somewhere else, drawn safely.
 *
 * A model card is written by whoever uploaded the model, and a setting's
 * description by whichever component serves it. The two things such text can
 * do to a reader without any script are to make their browser fetch from a
 * stranger (an image) and to hand them a link that does something other than
 * it says. Both are asserted here, on the page's own renderer.
 */

import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Markdown } from "./Markdown";

afterEach(() => vi.unstubAllGlobals());

/** Anything in a page that can ask a server for something. */
const FETCHERS = "img, picture, source, video, audio, iframe, object, embed, link, script";

describe("an image", () => {
  const SOURCE =
    "Before ![logo](https://tracker.example/pixel.png) and " +
    "![inline](data:image/png;base64,iVBORw0KGgo=) and " +
    '![titled](https://tracker.example/b.gif "title") after.';

  it("is not drawn, so the page asks nobody for it", () => {
    const fetched = vi.fn();
    vi.stubGlobal("fetch", fetched);
    const { container } = render(<Markdown>{SOURCE}</Markdown>);
    expect(container.querySelector(FETCHERS)).toBeNull();
    // Not as an element, and not as an address left on one.
    expect(container.querySelector("[src], [srcset], [poster], [data]")).toBeNull();
    expect(container.innerHTML).not.toContain("tracker.example");
    expect(fetched).not.toHaveBeenCalled();
    // The text around it is still read in order.
    expect(container).toHaveTextContent("Before and and after.");
  });

  it("is not drawn inside a link either, or in the table a model card keeps its numbers in", () => {
    const { container } = render(
      <Markdown>
        {"[![badge](https://img.example/b.svg)](https://example.com/docs)\n\n" +
          "| a | b |\n| - | - |\n| ![x](https://img.example/x.png) | 1 |"}
      </Markdown>,
    );
    expect(container.querySelector(FETCHERS)).toBeNull();
    expect(container.innerHTML).not.toContain("img.example");
    expect(container.querySelector("td:last-child")).toHaveTextContent("1");
  });

  it("is not drawn from HTML written in the text, which is shown as the text it is", () => {
    const { container } = render(
      <Markdown>{'Look: <img src="https://tracker.example/p.png" onerror="alert(1)">'}</Markdown>,
    );
    expect(container.querySelector(FETCHERS)).toBeNull();
    expect(container).toHaveTextContent('<img src="https://tracker.example/p.png"');
  });
});

describe("a link", () => {
  it("opens a web address in a new tab, without telling the page it came from", () => {
    const { container } = render(
      <Markdown>{"See [the docs](https://example.com/docs)."}</Markdown>,
    );
    const link = container.querySelector("a")!;
    expect(link).toHaveAttribute("href", "https://example.com/docs");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.getAttribute("rel")).toContain("noreferrer");
  });

  it("whose address is a script or a document is plain text, not an empty link to this page", () => {
    const { container } = render(
      <Markdown>
        {"See [this](javascript:alert(1)), [that](data:text/html;base64,PHNjcmlwdD4=), " +
          "[Mixed](JavaScript:alert(2)) and [odd](vbscript:msgbox(1))."}
      </Markdown>,
    );
    // `react-markdown` empties these addresses and an `<a href="">` is a link
    // to the page it is on: nothing of the link may be left but its words.
    expect(container.querySelector("a")).toBeNull();
    expect(container).toHaveTextContent("See this, that, Mixed and odd.");
    expect(container.innerHTML).not.toMatch(/javascript:|vbscript:|data:|href/i);
  });

  it("with no address at all is its text, and so is an angle-bracket address that is a script", () => {
    const { container } = render(
      <Markdown>{"An [empty]() one and <javascript:alert(1)>."}</Markdown>,
    );
    expect(container.querySelector("a")).toBeNull();
    expect(container).toHaveTextContent("An empty one and");
    expect(container.innerHTML).not.toMatch(/href/i);
  });

  it("keeps a good link beside a refused one", () => {
    const { container } = render(
      <Markdown>
        {"[bad](javascript:alert(1)) then [good](https://example.com) then [mail](mailto:a@b.c)."}
      </Markdown>,
    );
    const links = [...container.querySelectorAll("a")].map((a) => [
      a.textContent,
      a.getAttribute("href"),
    ]);
    expect(links).toEqual([
      ["good", "https://example.com"],
      ["mail", "mailto:a@b.c"],
    ]);
    expect(container).toHaveTextContent("bad then good then mail.");
  });
});
