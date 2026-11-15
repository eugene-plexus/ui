import { describe, expect, it } from "vitest";

import {
  SCRAPE_KEY_LIMITS,
  SCRAPE_KEY_PLACEHOLDER,
  otlpLine,
  prometheusLine,
  scrapeConfig,
  targetOf,
} from "./metricsExport";

describe("the OTLP sentence", () => {
  it("says it is not sending when there is no collector", () => {
    expect(otlpLine({ state: "off" }).text).toBe("Not sending to a collector.");
    expect(otlpLine(null).tone).toBe("off");
    // An address with no state still reads off: the state is the gateway's word.
    expect(otlpLine({ state: "off", endpoint: "http://c:4318" }).text).toMatch(/^Not sending/);
  });

  it("names the collector and the time of the last send", () => {
    const line = otlpLine({
      state: "ok",
      endpoint: "http://collector:4318",
      lastSuccessAt: "2026-11-15T10:02:03Z",
    });
    expect(line.tone).toBe("ok");
    expect(line.text).toMatch(/^Sending to http:\/\/collector:4318\. Last sent \S+/);
  });

  it("does not claim a first send that has not happened", () => {
    const line = otlpLine({ state: "ok", endpoint: "http://collector:4318", lastSuccessAt: null });
    expect(line.text).toBe("Sending to http://collector:4318. Nothing has been sent yet.");
  });

  it("names the cause of a failing export and says requests are served", () => {
    const line = otlpLine({
      state: "failing",
      endpoint: "http://collector:4318",
      lastError: "could not connect to collector:4318: connection refused",
    });
    expect(line.tone).toBe("warn");
    expect(line.text).toBe(
      "Export to http://collector:4318 is failing: could not connect to collector:4318: connection refused. Requests are served as usual.",
    );
  });
});

describe("the Prometheus sentence", () => {
  it("says when it was last read and with which key", () => {
    expect(prometheusLine({ path: "/metrics" })).toBe("Not scraped yet.");
    expect(
      prometheusLine({
        path: "/metrics",
        lastScrapeAt: "2026-11-15T10:02:03Z",
        lastScrapeKeyName: "Prometheus",
      }),
    ).toMatch(/^Last scraped .+ with Prometheus\.$/);
  });
});

describe("the scrape configuration", () => {
  it("reads the gateway and every machine, with the key in authorization.credentials", () => {
    const file = scrapeConfig({
      gateway: "http://192.168.1.10:8080",
      machines: [
        { name: "box", url: "http://192.168.1.10:8079" },
        { name: "worker", url: "http://192.168.1.11:8079/" },
        { name: "far", url: "https://far.example:8443" },
      ],
      key: "the-key",
    });
    expect(file).toContain("job_name: eugene-gateway");
    expect(file).toContain("targets: ['192.168.1.10:8080']");
    expect(file).toContain("targets: ['192.168.1.11:8079']");
    expect(file).toContain("labels: { machine: 'worker' }");
    // Prometheus sets the scheme for a whole job.
    expect(file).toContain("job_name: eugene-agents-tls");
    expect(file).toContain("scheme: https");
    expect(file.match(/credentials: 'the-key'/g)).toHaveLength(3);
    expect(file.startsWith("scrape_configs:\n")).toBe(true);
    expect(file).toContain("metrics_path: /metrics");
  });

  it("carries a placeholder until a key is made, and skips an address that is not a URL", () => {
    const file = scrapeConfig({
      gateway: null,
      machines: [{ name: "x", url: "nonsense" }],
      key: null,
    });
    expect(file).toBe("scrape_configs:\n");
    const withGateway = scrapeConfig({ gateway: "http://h:8080", machines: [], key: null });
    expect(withGateway).toContain(`credentials: '${SCRAPE_KEY_PLACEHOLDER}'`);
  });

  it("quotes what could break the file", () => {
    const file = scrapeConfig({
      gateway: "http://h:8080",
      machines: [{ name: "it's", url: "http://h:8079" }],
      key: "k'ey",
    });
    expect(file).toContain("credentials: 'k''ey'");
    expect(file).toContain("machine: 'it''s'");
  });

  it("gives the default port of a scheme and brackets an IPv6 host", () => {
    expect(targetOf("https://a.example")).toEqual({ scheme: "https", hostport: "a.example:443" });
    expect(targetOf("http://[fd00::1]:8079")?.hostport).toBe("[fd00::1]:8079");
    expect(targetOf("ftp://a")).toBeNull();
  });
});

describe("a scrape key", () => {
  it("may read metrics and run no model", () => {
    expect(SCRAPE_KEY_LIMITS).toEqual({ allowedModels: [], readMetrics: true });
  });
});
