import type { ComputeDevice } from "@/lib/types";
import type { HostHistory } from "@/lib/hostHistory";
import { cardMetric, throttleText } from "@/lib/hardware";

export function Hardware({
  label,
  devices,
  history,
}: {
  label: string;
  devices: ComputeDevice[];
  history?: HostHistory | null;
}) {
  return (
    <div className="space-y-3">
      <h3 className="font-semibold">{label}</h3>
      {devices
        .filter((d) => d.kind !== "cpu")
        .map((d, i) => {
          const link = d.pcieLink;
          const value = (v: number | null | undefined, unit = "") =>
            v == null ? "not reported" : `${v}${unit}`;
          const peers =
            d.peers == null
              ? "not reported"
              : d.peers.length === 0
                ? "none"
                : d.peers
                    .map((uuid) => {
                      const peer = devices.find((p) => p.uuid === uuid);
                      return peer ? `${peer.name ?? "GPU"} #${peer.index ?? "?"}` : uuid;
                    })
                    .join(", ");
          return (
            <article
              key={d.uuid ?? `${d.kind}:${d.index ?? i}`}
              className="rounded border border-[color:var(--border)] p-3 text-sm"
            >
              <h4 className="font-medium">
                {d.name ?? "GPU"} #{d.index ?? "?"}
              </h4>
              <p>
                PCIe{" "}
                {link
                  ? `Gen ${value(link.generation)} x${value(link.width)}; supports Gen ${value(link.maxGeneration)} x${value(link.maxWidth)}`
                  : "not reported"}
              </p>
              <p>Can reach directly: {peers}</p>
              <p>
                Temperature: {value(cardMetric(d, history, "gpuTemperature"), " °C")}. Power:{" "}
                {value(cardMetric(d, history, "gpuPower"), " W")}.
              </p>
              <p>
                Power cap: {value(d.powerLimitWatts, " W")} of{" "}
                {value(d.powerDefaultLimitWatts, " W")} default.
              </p>
              <p>
                Slowing down:{" "}
                {d.throttleReasons == null ? "not reported" : throttleText(d, history) || "no"}.
              </p>
              <p>Uncorrected memory errors since start: {value(d.uncorrectedMemoryErrors)}.</p>
              <details>
                <summary>Card identity</summary>
                <p>
                  UUID: {d.uuid ?? "not reported"}. PCI address: {d.pciBusId ?? "not reported"}.
                </p>
              </details>
            </article>
          );
        })}
    </div>
  );
}
