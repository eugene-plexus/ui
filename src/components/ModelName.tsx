import { contextText, type ServedContext } from "@/lib/modelContext";

/**
 * A served model's name with its context window beside it, muted. The
 * words come from `lib/modelContext.ts` (its `contextText`), so
 * a `<select>` option (which can hold only text) and this read the same.
 * An id the gateway does not serve (`context` undefined) shows its name
 * alone.
 */
export function ModelName({
  name,
  context,
  className,
}: {
  name: string;
  context: ServedContext;
  className?: string;
}) {
  return (
    <span className={className}>
      {name}
      {context !== undefined && (
        <span data-testid="model-context" className="font-ui text-[color:var(--muted)]">
          {" · "}
          {contextText(context)}
        </span>
      )}
    </span>
  );
}
