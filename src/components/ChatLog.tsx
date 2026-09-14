"use client";

import { Children, isValidElement, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { CopyButton } from "@/components/CopyButton";
import { JumpToBottomButton } from "@/components/JumpToBottomButton";
import { argumentsParse, exampleResultFor } from "@/lib/diagnostic";
import type { ChatCompletionMessage, ToolCall } from "@/lib/types";
import { useAutoScroll } from "@/lib/useAutoScroll";

export interface ToolResult {
  tool_call_id: string;
  content: string;
}

/**
 * The playground transcript.
 *
 * Sticky-bottom scroll: stays pinned when the user is at the bottom and
 * a new message arrives, but doesn't yank them back if they've scrolled
 * up to re-read earlier content.
 *
 * Where the turn was routed is rendered by the page, not here — it
 * belongs to the request, not to a message.
 *
 * Since the diagnostic, three more things are messages a person reads:
 * an assistant turn's **tool calls** (as cards, filling in as fragments
 * stream), the **tool results** the operator typed back (as their own
 * bubbles, because a harness sends them as messages and the transcript
 * is the request), and a long **attachment** inlined into a user
 * message, collapsed for display without changing what was sent.
 */
export function ChatLog({
  messages,
  pending,
  onRegenerate,
  onEditUserMessage,
  onToolResults,
}: {
  messages: ChatCompletionMessage[];
  pending: boolean;
  /** Re-run the last turn. Omitted while there is nothing to re-run. */
  onRegenerate?: () => void;
  /** Put a previous message back in the composer, dropping everything after
   * it. The transcript is the caller's to carry, so editing it is just a
   * different history for the next request. */
  onEditUserMessage?: (index: number, content: string) => void;
  /** Send the operator's results for the newest assistant turn's tool
   * calls, one `tool` message per call. Omitted when tool calls are not
   * in play. */
  onToolResults?: (results: ToolResult[]) => void;
}) {
  // System messages are part of the request but not of the conversation
  // a person is reading. Tool results are: a harness sends them, and a
  // transcript that hid them would not be the request.
  const visible = messages.filter(
    (m) => m.role === "user" || m.role === "assistant" || m.role === "tool",
  );
  const { scrollRef, isAtBottom, scrollToBottom } = useAutoScroll(messages);

  if (visible.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[color:var(--muted)]">
        Send a message to start a conversation.
      </div>
    );
  }

  const last = visible[visible.length - 1];
  const awaitingResults =
    !pending &&
    onToolResults !== undefined &&
    last?.role === "assistant" &&
    (last.tool_calls?.length ?? 0) > 0;

  return (
    <div className="relative h-full">
      <div ref={scrollRef} className="flex h-full flex-col gap-4 overflow-y-auto p-4">
        {visible.map((msg, i) => (
          <ChatBubble
            key={i}
            message={msg}
            // Only the newest assistant turn can be regenerated: re-running
            // an older one would silently discard everything after it.
            onRegenerate={
              !pending && msg.role === "assistant" && i === visible.length - 1
                ? onRegenerate
                : undefined
            }
            onEdit={
              !pending && msg.role === "user" && onEditUserMessage
                ? () => onEditUserMessage(messages.indexOf(msg), msg.content ?? "")
                : undefined
            }
          />
        ))}
        {awaitingResults && last?.tool_calls && (
          <ToolResultsForm
            key={`results-${messages.indexOf(last)}`}
            calls={last.tool_calls}
            onSubmit={onToolResults}
          />
        )}
        {pending && (
          <p className="font-ui text-xs text-[color:var(--muted)]">Waiting on the backend…</p>
        )}
      </div>
      {!isAtBottom && <JumpToBottomButton onClick={scrollToBottom} />}
    </div>
  );
}

// Past this a user message is collapsed for display. A 60 KB attachment
// otherwise makes the transcript unreadable, and collapsing the display
// changes nothing on the wire.
const COLLAPSE_LINES = 40;
const SHOWN_LINES = 16;

function ChatBubble({
  message,
  onRegenerate,
  onEdit,
}: {
  message: ChatCompletionMessage;
  onRegenerate?: () => void;
  onEdit?: () => void;
}) {
  const isUser = message.role === "user";
  const isTool = message.role === "tool";
  // `content` is nullable since tool calling landed: an assistant turn
  // that only calls a tool has no text, and its calls are rendered as
  // cards below the (then empty) bubble.
  const text = message.content ?? "";
  const calls = message.role === "assistant" ? (message.tool_calls ?? []) : [];

  return (
    <div className={`group flex flex-col ${isUser ? "items-end" : "items-start"}`}>
      {isTool ? (
        <div
          data-testid="tool-result-message"
          className="max-w-[80%] rounded-[var(--radius)] border border-dashed border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-xs"
        >
          <p className="font-ui mb-1 text-[11px] text-[color:var(--muted)]">
            tool result{message.tool_call_id ? ` · ${message.tool_call_id}` : ""}
          </p>
          <pre className="font-mono break-all whitespace-pre-wrap">{text}</pre>
        </div>
      ) : (
        (text || calls.length === 0) && (
          <div
            className={`max-w-[80%] rounded-[var(--radius)] px-4 py-2 text-sm leading-relaxed text-[color:var(--foreground)] backdrop-blur-[var(--bubble-blur)] ${
              isUser
                ? "bg-[color:var(--bubble-soft-bg)] whitespace-pre-wrap"
                : "border border-[color:var(--border)] bg-[color:var(--bubble-bg)]"
            }`}
          >
            {isUser ? <Collapsible text={text} /> : <Markdown>{text}</Markdown>}
          </div>
        )
      )}
      {calls.length > 0 && (
        <div className="mt-1 flex max-w-[80%] flex-col gap-1">
          {calls.map((call, i) => (
            <ToolCallCard key={call.id || i} call={call} />
          ))}
        </div>
      )}
      {/* Visible on hover and on keyboard focus. focus-within matters: a
          hover-only control is unreachable by keyboard, and these are the
          only way to get a reply out of the playground. */}
      <div
        className={`mt-1 flex gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 ${
          isUser ? "flex-row-reverse" : ""
        }`}
      >
        {/* The raw markdown, not the rendered text: what is useful about a
            reply from a coding model is its source. */}
        <CopyButton text={text || JSON.stringify(calls, null, 2)} title="Copy this message" />
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            title="Edit and resend, discarding everything after it"
            className="font-ui rounded-[var(--radius)] px-2 py-1 text-[11px] text-[color:var(--muted)] transition-colors hover:bg-[color:var(--panel-hover)]"
          >
            Edit
          </button>
        )}
        {onRegenerate && (
          <button
            type="button"
            onClick={onRegenerate}
            title="Ask again for this turn"
            className="font-ui rounded-[var(--radius)] px-2 py-1 text-[11px] text-[color:var(--muted)] transition-colors hover:bg-[color:var(--panel-hover)]"
          >
            Regenerate
          </button>
        )}
      </div>
    </div>
  );
}

/** A user message, collapsed past `COLLAPSE_LINES` with a control to
 * show it whole. Display only. */
function Collapsible({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const lines = text.split("\n");
  if (open || lines.length <= COLLAPSE_LINES) return <>{text}</>;
  return (
    <>
      {lines.slice(0, SHOWN_LINES).join("\n")}
      {"\n"}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="font-ui mt-1 rounded-[var(--radius)] border border-[color:var(--border)] px-2 py-0.5 text-[11px] text-[color:var(--muted)] hover:bg-[color:var(--panel-hover)]"
      >
        Show all {lines.length.toLocaleString("en-US")} lines ({text.length.toLocaleString("en-US")}{" "}
        characters, as sent)
      </button>
    </>
  );
}

/**
 * One tool call, as the model made it.
 *
 * The arguments are a string on the wire and the card says whether they
 * parse: a model can emit malformed JSON, and that is a model fault a
 * harness would hit too, worth seeing as such rather than as a card that
 * looks fine.
 */
function ToolCallCard({ call }: { call: ToolCall }) {
  const parsed = argumentsParse(call.function.arguments);
  return (
    <div
      data-testid="tool-call-card"
      className="rounded-[var(--radius)] border border-[color:var(--accent-left)] bg-[color:var(--panel-soft)] px-3 py-2 text-xs"
    >
      <p className="font-ui mb-1 flex flex-wrap items-center gap-2 text-[11px] text-[color:var(--muted)]">
        <span>tool call{call.id ? ` · ${call.id}` : ""}</span>
        <span className="font-mono text-[color:var(--foreground)]">
          {call.function.name || "…"}
        </span>
        {call.function.arguments !== "" && (
          <span className={parsed.ok ? "status-success px-1" : "status-warn px-1"}>
            {parsed.ok ? "arguments parse" : "arguments are not JSON"}
          </span>
        )}
      </p>
      <pre className="font-mono break-all whitespace-pre-wrap">
        {call.function.arguments || "…"}
      </pre>
    </div>
  );
}

/**
 * The operator as the tool runtime.
 *
 * One result per call, prefilled for the example tool with the result
 * the acceptance run hands back, and one Send. The playground executes
 * nothing; what is under test is that the loop closes through the
 * control plane, and a person typing the result proves that as well as
 * a real function would while adding nothing that could be the fault.
 */
function ToolResultsForm({
  calls,
  onSubmit,
}: {
  calls: ToolCall[];
  onSubmit: (results: ToolResult[]) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(calls.map((c) => [c.id, exampleResultFor(c.function.name)])),
  );
  const complete = calls.every((c) => (values[c.id] ?? "").trim() !== "");
  return (
    <form
      data-testid="tool-results-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!complete) return;
        onSubmit(calls.map((c) => ({ tool_call_id: c.id, content: (values[c.id] ?? "").trim() })));
      }}
      className="flex max-w-[80%] flex-col gap-2 rounded-[var(--radius)] border border-dashed border-[color:var(--border)] bg-[color:var(--panel)] p-3"
    >
      <p className="font-ui text-[11px] text-[color:var(--muted)]">
        The model is waiting for{" "}
        {calls.length === 1 ? "a tool result" : `${calls.length} tool results`}. Type what the tool
        would have returned; it is sent back as a <code>tool</code> message, the way a harness would
        send it.
      </p>
      {calls.map((c) => (
        <label
          key={c.id}
          className="font-ui flex flex-col gap-1 text-[11px] text-[color:var(--muted)]"
        >
          <span>
            result for <span className="font-mono">{c.function.name}</span> ({c.id})
          </span>
          <textarea
            data-testid="tool-result"
            value={values[c.id] ?? ""}
            onChange={(e) => setValues((v) => ({ ...v, [c.id]: e.target.value }))}
            rows={2}
            spellCheck={false}
            className="w-full resize-y rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-2 py-1 font-mono text-xs text-[color:var(--foreground)] outline-none hover:border-[color:var(--border-hover)] focus:border-[color:var(--accent-left)]"
          />
        </label>
      ))}
      <button
        type="submit"
        data-testid="send-tool-results"
        disabled={!complete}
        className="font-ui self-end rounded-[var(--radius)] bg-[color:var(--accent-left)] px-3 py-1 text-xs font-medium text-[color:var(--on-accent-left)] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-30"
      >
        Send {calls.length === 1 ? "result" : "results"}
      </button>
    </form>
  );
}

/**
 * The literal text inside a rendered markdown node.
 *
 * react-markdown hands `pre` an element tree, not the source string, so a
 * copy button on a code block has to walk it. Only strings are collected -
 * syntax-highlight spans and the like contribute their text and nothing
 * else, which is exactly what belongs on a clipboard.
 */
function nodeText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode };
    return Children.toArray(props.children).map(nodeText).join("");
  }
  return "";
}

function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
        ul: ({ children }) => <ul className="mb-2 ml-5 list-disc last:mb-0">{children}</ul>,
        ol: ({ children }) => <ol className="mb-2 ml-5 list-decimal last:mb-0">{children}</ol>,
        li: ({ children }) => <li className="mb-0.5">{children}</li>,
        h1: ({ children }) => <h1 className="my-2 text-base font-semibold">{children}</h1>,
        h2: ({ children }) => <h2 className="my-2 text-base font-semibold">{children}</h2>,
        h3: ({ children }) => <h3 className="my-2 text-sm font-semibold">{children}</h3>,
        h4: ({ children }) => <h4 className="my-2 text-sm font-semibold">{children}</h4>,
        a: ({ children, href }) => (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-[color:var(--accent-left)] underline"
          >
            {children}
          </a>
        ),
        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        em: ({ children }) => <em className="italic">{children}</em>,
        blockquote: ({ children }) => (
          <blockquote className="my-2 border-l-2 border-[color:var(--border)] pl-3 text-[color:var(--muted)]">
            {children}
          </blockquote>
        ),
        code: ({ className, children, ...props }) => {
          const isBlock = /language-/.test(className || "");
          if (isBlock) {
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          }
          return (
            <code className="rounded-[var(--radius)] bg-[color:var(--panel-soft)] px-1 py-0.5 font-mono text-[0.85em]">
              {children}
            </code>
          );
        },
        // A code block gets its own copy button. Selecting one by hand in a
        // scrolling transcript is the single most annoying thing about
        // reading code out of a chat log.
        pre: ({ children }) => (
          <div className="group/code relative my-2">
            <pre className="overflow-x-auto rounded-[var(--radius)] bg-[color:var(--panel-soft)] p-3 pr-16 font-mono text-xs leading-snug">
              {children}
            </pre>
            <CopyButton
              text={nodeText(children)}
              title="Copy this code block"
              className="absolute top-1.5 right-1.5 border border-[color:var(--border)] bg-[color:var(--panel)] opacity-0 transition-opacity group-hover/code:opacity-100 focus:opacity-100"
            />
          </div>
        ),
        table: ({ children }) => (
          <div className="my-2 overflow-x-auto">
            <table className="border-collapse border border-[color:var(--border)] text-xs">
              {children}
            </table>
          </div>
        ),
        th: ({ children }) => (
          <th className="border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-2 py-1 text-left font-semibold">
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="border border-[color:var(--border)] px-2 py-1 align-top">{children}</td>
        ),
        hr: () => <hr className="my-3 border-[color:var(--border)]" />,
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
