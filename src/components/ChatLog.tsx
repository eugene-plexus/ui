"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { JumpToBottomButton } from "@/components/JumpToBottomButton";
import { useAutoScroll } from "@/lib/useAutoScroll";
import type { Message } from "@/lib/types";

/**
 * The user-visible conversation transcript. Hemisphere/intermediate
 * messages are excluded — those live in the right rail.
 *
 * Sticky-bottom scroll: stays pinned when the user is at the bottom and
 * a new message arrives, but doesn't yank them back if they've scrolled
 * up to re-read earlier content.
 */
export function ChatLog({ messages }: { messages: Message[] }) {
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
          <ChatBubble key={i} message={msg} />
        ))}
      </div>
      {!isAtBottom && <JumpToBottomButton onClick={scrollToBottom} />}
    </div>
  );
}

function ChatBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-md px-4 py-2 text-sm leading-relaxed text-[color:var(--foreground)] backdrop-blur-[var(--bubble-blur)] ${
          isUser
            ? "bg-[color:var(--bubble-soft-bg)] whitespace-pre-wrap"
            : "border border-[color:var(--border)] bg-[color:var(--bubble-bg)]"
        }`}
      >
        {isUser ? message.content : <Markdown>{message.content}</Markdown>}
      </div>
    </div>
  );
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
            <code className="rounded bg-[color:var(--panel-soft)] px-1 py-0.5 font-mono text-[0.85em]">
              {children}
            </code>
          );
        },
        pre: ({ children }) => (
          <pre className="my-2 overflow-x-auto rounded bg-[color:var(--panel-soft)] p-3 font-mono text-xs leading-snug">
            {children}
          </pre>
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
