"use client";

import { percentage } from "@/lib/gatewayDashboard";

/** A dial needs a real denominator. Unknown measurements leave an empty track. */
export function MetricDial({
  value,
  total,
  label,
  variant = "arc",
}: {
  value: number | null | undefined;
  total: number | null | undefined;
  label: string;
  variant?: "arc" | "segments";
}) {
  const known =
    value != null &&
    total != null &&
    Number.isFinite(value) &&
    Number.isFinite(total) &&
    value >= 0 &&
    total > 0;
  const ratio = known ? value / total : null;
  const fraction = ratio === null ? 0 : Math.min(1, ratio);
  const text = known ? percentage(value, total) : "—";
  const color =
    variant === "arc" && ratio !== null && ratio >= 1
      ? "var(--status-warn-fg)"
      : "var(--accent-left)";
  const angle = Math.PI * (1 - fraction);
  return (
    <svg
      viewBox={variant === "arc" ? "0 0 160 110" : "0 0 160 160"}
      className="w-full"
      role="img"
      aria-label={`${label}: ${known ? `${value.toLocaleString()} of ${total.toLocaleString()} (${text})` : "unreported"}`}
    >
      {variant === "arc" ? (
        <>
          <path
            d="M 20 82 A 60 60 0 0 1 140 82"
            fill="none"
            stroke="var(--border)"
            strokeWidth="10"
            strokeLinecap="round"
          />
          {known && (
            <path
              d="M 20 82 A 60 60 0 0 1 140 82"
              pathLength="100"
              fill="none"
              stroke={color}
              strokeWidth="10"
              strokeDasharray={`${fraction * 100} 100`}
            />
          )}
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <line
              key={t}
              x1={80 + Math.cos(Math.PI * (1 - t)) * 48}
              y1={82 - Math.sin(Math.PI * t) * 48}
              x2={80 + Math.cos(Math.PI * (1 - t)) * 51}
              y2={82 - Math.sin(Math.PI * t) * 51}
              stroke="var(--muted)"
            />
          ))}
          {known && (
            <>
              <line
                x1="80"
                y1="82"
                x2={80 + Math.cos(angle) * 38}
                y2={82 - Math.sin(angle) * 38}
                stroke="var(--foreground)"
                strokeWidth="2"
                strokeLinecap="round"
              />
              <circle cx="80" cy="82" r="3" fill="var(--foreground)" />
            </>
          )}
          <text
            x="80"
            y="106"
            textAnchor="middle"
            fill="var(--foreground)"
            fontSize="18"
            fontWeight="600"
          >
            {text}
          </text>
          <text x="18" y="102" textAnchor="middle" fill="var(--muted)" fontSize="10">
            0
          </text>
          <text x="140" y="102" textAnchor="middle" fill="var(--muted)" fontSize="10">
            100%
          </text>
        </>
      ) : (
        <>
          {Array.from({ length: 40 }, (_, i) => {
            const portion = Math.max(0, Math.min(1, fraction * 40 - i));
            return (
              <g key={i} transform="rotate(-90 80 80)">
                <circle
                  cx="80"
                  cy="80"
                  r="62"
                  fill="none"
                  pathLength="100"
                  stroke="var(--border)"
                  strokeWidth="10"
                  strokeDasharray="1.7 98.3"
                  strokeDashoffset={-i * 2.5}
                />
                {portion > 0 && (
                  <circle
                    cx="80"
                    cy="80"
                    r="62"
                    fill="none"
                    pathLength="100"
                    stroke={color}
                    strokeWidth="10"
                    strokeDasharray={`${1.7 * portion} ${100 - 1.7 * portion}`}
                    strokeDashoffset={-i * 2.5}
                  />
                )}
              </g>
            );
          })}
          <text
            x="80"
            y="83"
            textAnchor="middle"
            fill="var(--foreground)"
            fontSize="25"
            fontWeight="600"
          >
            {text}
          </text>
          <text x="80" y="104" textAnchor="middle" fill="var(--muted)" fontSize="11">
            reused
          </text>
        </>
      )}
    </svg>
  );
}
