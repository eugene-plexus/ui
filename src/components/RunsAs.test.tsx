import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RunsAs } from "./RunsAs";

const SEARCH = { chat: false, embedding: true, rerank: false };
const SORTER = { chat: false, embedding: false, rerank: true };
const CHAT = { chat: true, embedding: false, rerank: false };

describe("Runs as, said under Run", () => {
  it("says what the file's header said, and where it came from", () => {
    render(<RunsAs capabilities={SEARCH} mode={undefined} />);
    expect(screen.getByTestId("runs-as-line")).toHaveTextContent(
      "Runs as: search model (found in the file)",
    );
  });

  it("is only a sentence without an onChange: nothing to change it with", () => {
    render(<RunsAs capabilities={SEARCH} mode={undefined} />);
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("says what a search model starts with, in the contract's numbers", () => {
    render(<RunsAs capabilities={SEARCH} mode={undefined} />);
    const starts = screen.getByTestId("runs-as-starts");
    expect(starts).toHaveTextContent("stays running");
    expect(starts).toHaveTextContent("4 requests of 1,024 tokens");
  });

  it("says nothing about starting for a chat model", () => {
    render(<RunsAs capabilities={CHAT} mode={undefined} />);
    expect(screen.queryByTestId("runs-as-starts")).toBeNull();
    expect(screen.getByTestId("runs-as-line")).toHaveTextContent("chat model (found in the file)");
  });

  it("tells a search model's owner what to do when it is really a result sorter", () => {
    render(<RunsAs capabilities={SEARCH} mode={undefined} />);
    expect(screen.getByTestId("runs-as-sorter-hint")).toHaveTextContent("choose Sort results");
  });

  it("does not say that once a person has chosen, or for a sorter, or for a chat model", () => {
    const { rerender } = render(<RunsAs capabilities={SEARCH} mode="reranking" />);
    expect(screen.queryByTestId("runs-as-sorter-hint")).toBeNull();
    rerender(<RunsAs capabilities={SORTER} mode={undefined} />);
    expect(screen.queryByTestId("runs-as-sorter-hint")).toBeNull();
    rerender(<RunsAs capabilities={CHAT} mode={undefined} />);
    expect(screen.queryByTestId("runs-as-sorter-hint")).toBeNull();
  });

  it("says a choice is the person's, and that it beats the file", () => {
    render(<RunsAs capabilities={SEARCH} mode="chat" />);
    expect(screen.getByTestId("runs-as-line")).toHaveTextContent(
      "Runs as: chat model (you chose this)",
    );
    expect(screen.getByTestId("runs-as")).toHaveAttribute("data-source", "chosen");
    expect(screen.getByTestId("runs-as")).toHaveAttribute("data-kind", "chat");
  });
});

describe("Runs as, as a control", () => {
  it("offers Auto, Chat, Search and Sort results, with Auto showing for a profile that says nothing", () => {
    render(<RunsAs capabilities={SEARCH} mode={undefined} onChange={() => {}} />);
    const select = screen.getByRole("combobox", { name: "Runs as" });
    expect(select).toHaveValue("auto");
    const options = within(select).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["Auto", "Chat", "Search", "Sort results"]);
    expect(options.map((o) => (o as HTMLOptionElement).value)).toEqual([
      "auto",
      "chat",
      "embedding",
      "reranking",
    ]);
  });

  it("reports the contract's value, not the label", () => {
    const onChange = vi.fn();
    render(<RunsAs capabilities={CHAT} mode="auto" onChange={onChange} />);
    const select = screen.getByRole("combobox", { name: "Runs as" });
    fireEvent.change(select, { target: { value: "reranking" } });
    expect(onChange).toHaveBeenLastCalledWith("reranking");
    fireEvent.change(select, { target: { value: "embedding" } });
    expect(onChange).toHaveBeenLastCalledWith("embedding");
    fireEvent.change(select, { target: { value: "chat" } });
    expect(onChange).toHaveBeenLastCalledWith("chat");
  });

  it("shows the person's choice as chosen", () => {
    render(<RunsAs capabilities={CHAT} mode="embedding" onChange={() => {}} />);
    expect(screen.getByRole("combobox", { name: "Runs as" })).toHaveValue("embedding");
    expect(screen.getByTestId("runs-as-line")).toHaveTextContent("search model (you chose this)");
  });

  it("is off while a save is in flight", () => {
    render(<RunsAs capabilities={CHAT} mode="auto" onChange={() => {}} disabled />);
    expect(screen.getByRole("combobox", { name: "Runs as" })).toBeDisabled();
  });
});
