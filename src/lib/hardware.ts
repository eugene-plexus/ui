import type { ComputeDevice } from "./types";
import type { HostHistory, HostMetric } from "./hostHistory";

export function cardMetric(
  device: ComputeDevice,
  history: HostHistory | null | undefined,
  metric: HostMetric,
): number | null {
  if (!history?.latestAt || Date.now() - Date.parse(history.latestAt) > 60_000) return null;
  const series = history.series.find(
    (s) => s.metric === metric && s.deviceKind === device.kind && s.deviceIndex === device.index,
  );
  return series?.unavailable ? null : (series?.latest ?? null);
}

export function recentlyBusy(
  device: ComputeDevice,
  history: HostHistory | null | undefined,
): boolean {
  if (!history?.latestAt || Date.now() - Date.parse(history.latestAt) > 60_000) return false;
  const series = history.series.find(
    (s) =>
      s.metric === "gpuUtilization" &&
      s.deviceKind === device.kind &&
      s.deviceIndex === device.index,
  );
  if (!series || series.unavailable) return false;
  return history.buckets.some(
    (b, i) =>
      Date.now() - Date.parse(b.start) <= 60_000 && b.samples > 0 && (series.max[i] ?? 0) > 50,
  );
}

export function throttleText(device: ComputeDevice, history?: HostHistory | null): string {
  return (device.throttleReasons ?? [])
    .map((reason) => {
      if (reason === "power-cap")
        return device.powerLimitWatts != null && device.powerDefaultLimitWatts != null
          ? `power cap (${device.powerLimitWatts} W of ${device.powerDefaultLimitWatts} W)`
          : "power cap";
      if (reason === "thermal") {
        const temperature = cardMetric(device, history, "gpuTemperature");
        return temperature == null ? "too hot" : `too hot (${temperature} °C)`;
      }
      return reason === "hardware-slowdown" ? "hardware slowdown" : "another reported limit";
    })
    .join(", ");
}
