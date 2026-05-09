"use client";

import type { Message } from "@/lib/types";

/**
 * The user-visible conversation transcript. Hemisphere/intermediate
 * messages are excluded — those live in the right rail.
 */
export function ChatLog({ messages }: { messages: Message[] }) {
  const visible = messages.filter((m) => m.role === "user" || m.role === "assistant");

  if (visible.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[color:var(--muted)]">
        Send a message to start a conversation.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 overflow-y-auto p-4">
      {visible.map((msg, i) => (
        <ChatBubble key={i} message={msg} />
      ))}
    </div>
  );
}

function ChatBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-md px-4 py-2 text-sm leading-relaxed whitespace-pre-wrap ${
          isUser
            ? "bg-[color:var(--panel-soft)] text-[color:var(--foreground)]"
            : "border border-[color:var(--border)] bg-[color:var(--panel)] text-[color:var(--foreground)]"
        }`}
      >
        {message.content}
      </div>
    </div>
  );
}
