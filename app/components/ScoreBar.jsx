import { BlockStack, InlineStack, Text, Box } from "@shopify/polaris";

/**
 * ScoreBar — labeled horizontal progress bar (0..1 value).
 *
 * Props:
 * - label: string
 * - value: number (0..1)
 * - tone?: "info" | "success" | "magic" | "warning" | "critical"
 */
export function ScoreBar({ label, value, tone = "info" }) {
  const pct = Math.max(0, Math.min(1, Number(value) || 0)) * 100;

  const fillBg =
    tone === "success"
      ? "var(--p-color-bg-fill-success, #008060)"
      : tone === "magic"
      ? "var(--p-color-bg-fill-magic, #8b5cf6)"
      : tone === "warning"
      ? "var(--p-color-bg-fill-warning, #f59e0b)"
      : tone === "critical"
      ? "var(--p-color-bg-fill-critical, #b42318)"
      : "var(--p-color-bg-fill-info, #005bd3)";

  return (
    <BlockStack gap="100">
      <InlineStack align="space-between">
        <Text as="span" variant="bodySm" fontWeight="medium">
          {label}
        </Text>
        <Text as="span" variant="bodySm" tone="subdued">
          {pct.toFixed(0)}%
        </Text>
      </InlineStack>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-label={label}
        style={{
          height: "8px",
          background: "var(--p-color-bg-surface-tertiary, #e1e3e5)",
          borderRadius: "4px",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            background: fillBg,
            transition: "width 200ms ease-out",
          }}
        />
      </div>
    </BlockStack>
  );
}

export default ScoreBar;
