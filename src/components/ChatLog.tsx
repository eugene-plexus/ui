"use client";

import { Children, isValidElement, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { CopyButton } from "@/components/CopyButton";
import { JumpToBottomButton } from "@/components/JumpToBottomButton";
import { useAutoScroll } from "@/lib/useAutoScroll";
import type { ChatCompletionMessage } from "@/lib/types";

/**
 * The playground transcript.
 *
 * Sticky-bottom scroll: stays pinned when the user is at the bottom and
 * a new message arrives, but doesn't yank them back if they've scrolled
 * up to re-read earlier content.
 *
 * Where the turn was routed is rendered by the page, not here — it
 * belongs to the request, not to a message.
 */
export function ChatLog({
  messages,
  pending,
  onRegenerate,
  onEditUserMessage,
}: {
  messages: ChatCompletionMessage[];
  pending: boolean;
  /** Re-run the last turn. Omitted while there is nothing to re-run. */
  onRegenerate?: () => void;
  /** Put a previous message back in the composer, dropping everything after
   * it. The transcript is the caller's to carry, so editing it is just a
   * different history for the next request. */
  onEditUserMessage?: (index: number, content: string) => void;
}) {
  // System messages are part of the request but not of the conversation
  // a person is reading.
  const visible = messages.filter((m) => m.role === "user" || m.role === "assistant");
  const { scrollRef, isAtBottom, scrollToBottom } = useAutoScroll(messages);

  if (visible.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[color:var(--muted)]">
        Send a message to start a conversation.
      </div>
    );
  }

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
                ? () => onEditUserMessage(messages.indexOf(msg), msg.content)
                : undefined
            }
          />
        ))}
        {pending && (
          <p className="font-ui text-xs text-[color:var(--muted)]">Waiting on the backend…</p>
        )}
      </div>
      {!isAtBottom && <JumpToBottomButton onClick={scrollToBottom} />}
    </div>
  );
}

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
  return (
    <div className={`group flex flex-col ${isUser ? "items-end" : "items-start"}`}>
      <div
        className={`max-w-[80%] rounded-[var(--radius)] px-4 py-2 text-sm leading-relaxed text-[color:var(--foreground)] backdrop-blur-[var(--bubble-blur)] ${
          isUser
            ? "bg-[color:var(--bubble-soft-bg)] whitespace-pre-wrap"
            : "border border-[color:var(--border)] bg-[color:var(--bubble-bg)]"
        }`}
      >
        {isUser ? message.content : <Markdown>{message.content}</Markdown>}
      </div>
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
        <CopyButton text={message.content} title="Copy this message" />
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
