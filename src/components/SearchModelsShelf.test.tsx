import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { LibraryModel } from "@/lib/types";

import { SearchModelsShelf } from "./SearchModelsShelf";

describe("the Search models shelf", () => {
  it("lists the three models the plan names, in order, with what each is for", () => {
    render(<SearchModelsShelf />);
    const shelf = screen.getByTestId("search-models-shelf");
    expect(within(shelf).getByRole("heading", { name: "Search models" })).toBeInTheDocument();
    const rows = within(shelf).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("Qwen3-Embedding-0.6B");
    expect(rows[1]).toHaveTextContent("nomic-embed-text-v1.5");
    expect(rows[2]).toHaveTextContent("Qwen3-Reranker-0.6B");
    expect(rows[0]).toHaveTextContent("Start here");
    expect(rows[1]).toHaveTextContent("Lighter");
    expect(rows[2]).toHaveTextContent("Sorts results");
    expect(rows[2]).toHaveTextContent("result sorter");
    expect(rows[0]).toHaveTextContent("search model");
  });

  it("names the repo and the file, because the others in the repo are other sizes", () => {
    render(<SearchModelsShelf />);
    expect(screen.getByTestId("search-model-qwen3-embedding")).toHaveTextContent(
      "Qwen/Qwen3-Embedding-0.6B-GGUF · Qwen3-Embedding-0.6B-Q8_0.gguf",
    );
    expect(screen.getByTestId("search-model-qwen3-reranker")).toHaveTextContent(
      "ggml-org/Qwen3-Reranker-0.6B-Q8_0-GGUF · qwen3-reranker-0.6b-q8_0.gguf",
    );
  });

  it("says how big each download is", () => {
    render(<SearchModelsShelf />);
    expect(screen.getByTestId("search-model-qwen3-embedding")).toHaveTextContent("about 610 MB");
    expect(screen.getByTestId("search-model-nomic-embed")).toHaveTextContent("about 140 MB");
  });

  it("says the sorter is the one copy that scores right", () => {
    render(<SearchModelsShelf />);
    expect(screen.getByTestId("search-model-qwen3-reranker")).toHaveTextContent(
      "most others score wrongly",
    );
  });

  it("links each row to Discover with its repo open, from the Library", () => {
    render(<SearchModelsShelf />);
    expect(screen.getByTestId("search-model-open-qwen3-embedding")).toHaveAttribute(
      "href",
      "/discover?repo=Qwen%2FQwen3-Embedding-0.6B-GGUF",
    );
    expect(screen.getByTestId("search-model-open-nomic-embed")).toHaveAttribute(
      "href",
      "/discover?repo=nomic-ai%2Fnomic-embed-text-v1.5-GGUF",
    );
    expect(screen.getByTestId("search-model-open-qwen3-reranker")).toHaveAttribute(
      "href",
      "/discover?repo=ggml-org%2FQwen3-Reranker-0.6B-Q8_0-GGUF",
    );
    expect(screen.getByTestId("search-model-open-qwen3-embedding")).toHaveTextContent(
      "Find it in Discover",
    );
  });

  it("opens the repo in place on Discover, where a link to itself would do nothing", () => {
    const open = vi.fn();
    render(<SearchModelsShelf onOpenRepo={open} />);
    expect(screen.queryByRole("link", { name: /Discover/ })).toBeNull();
    fireEvent.click(screen.getByTestId("search-model-open-nomic-embed"));
    expect(open).toHaveBeenCalledWith("nomic-ai/nomic-embed-text-v1.5-GGUF");
    fireEvent.click(screen.getByTestId("search-model-open-qwen3-reranker"));
    expect(open).toHaveBeenLastCalledWith("ggml-org/Qwen3-Reranker-0.6B-Q8_0-GGUF");
  });

  it("says which search models the Library already holds", () => {
    const models = [
      { id: "a", name: "gemma-3", status: "present", capabilities: { chat: true } },
      {
        id: "b",
        name: "Qwen3-Embedding-0.6B-Q8_0",
        status: "present",
        capabilities: { embedding: true },
      },
      { id: "c", name: "reranker-q8", status: "present", capabilities: { rerank: true } },
    ] as unknown as LibraryModel[];
    render(<SearchModelsShelf models={models} />);
    const held = screen.getByTestId("search-models-held");
    expect(held).toHaveTextContent("Qwen3-Embedding-0.6B-Q8_0 (search model)");
    expect(held).toHaveTextContent("reranker-q8 (result sorter)");
    expect(held).not.toHaveTextContent("gemma-3");
  });

  it("says nothing of the sort when the Library holds none", () => {
    render(<SearchModelsShelf models={[]} />);
    expect(screen.queryByTestId("search-models-held")).toBeNull();
  });
});
