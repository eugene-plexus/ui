/** Local help: available even when this install has no internet connection. */
export const GLOSSARY = [
  [
    "Install",
    "Your connected Eugene Plexus services and machines, managed together with one sign-in.",
  ],
  [
    "Node",
    "A machine that belongs to your install. Each node runs an agent to manage its services and engines.",
  ],
  [
    "Component",
    "A service with its own job: the gateway, an inference driver, the library, or the control root.",
  ],
  ["Engine", "Software that loads a model and generates its answers, such as llama.cpp or vLLM."],
  [
    "Runtime",
    "An engine process Eugene starts and watches for you. Its saved settings remain when you stop it.",
  ],
  [
    "Backend",
    "A place that can answer model requests: a local engine, another server, a cloud service, or a subscription tool.",
  ],
  [
    "Replica",
    "Another backend serving the same model. The gateway can share requests between them.",
  ],
  [
    "Profile",
    "Saved settings for one model, such as context size and GPU layers. A profile can also supply default answer settings.",
  ],
  [
    "Context",
    "The tokens a model can work with at once, including your prompt and its answer. More context usually needs more memory.",
  ],
  [
    "Quantization",
    "A way to shrink model weights using fewer bits per number. Smaller files need less memory but can lose accuracy.",
  ],
  [
    "KV cache",
    "Working memory that stores attention data from earlier tokens. It helps generate the next token without repeating all that work.",
  ],
  [
    "Client key",
    "A revocable credential that lets another app request model answers. It does not give that app access to your settings.",
  ],
] as const;

export function Glossary() {
  return (
    <details className="mt-4 border-t border-[color:var(--border)] pt-3">
      <summary className="font-ui cursor-pointer text-sm font-semibold">
        Glossary · 12 terms
      </summary>
      <dl className="mt-3 grid gap-x-6 gap-y-3 text-xs sm:grid-cols-2">
        {GLOSSARY.map(([term, meaning]) => (
          <div key={term}>
            <dt className="font-semibold">{term}</dt>
            <dd className="mt-1 leading-relaxed text-[color:var(--muted)]">{meaning}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
