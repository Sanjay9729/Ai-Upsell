import { Card, BlockStack, InlineStack, Text } from "@shopify/polaris";

/**
 * StatCard — a metric tile with label, value, and optional helper text.
 *
 * Props:
 * - label: string (small uppercase label)
 * - value: string | number (the metric value)
 * - helper?: string (small text below the value, e.g. "of 1,240 decisions")
 * - tone?: "success" | "critical" | "warning" | "default"
 * - prefix?: ReactNode (optional icon / unit shown before value)
 * - suffix?: ReactNode (optional icon / unit shown after value, e.g. %)
 */
export function StatCard({
  label,
  value,
  helper,
  tone = "default",
  prefix,
  suffix,
}) {
  const toneColor =
    tone === "success"
      ? "success"
      : tone === "critical"
      ? "critical"
      : tone === "warning"
      ? "caution"
      : undefined;

  return (
    <Card>
      <BlockStack gap="200">
        <Text
          as="p"
          variant="bodySm"
          tone="subdued"
          fontWeight="medium"
        >
          {label}
        </Text>
        <InlineStack gap="100" blockAlign="baseline">
          {prefix}
          <Text as="p" variant="heading2xl" tone={toneColor}>
            {value}
          </Text>
          {suffix ? (
            <Text as="span" variant="bodyMd" tone="subdued">
              {suffix}
            </Text>
          ) : null}
        </InlineStack>
        {helper ? (
          <Text as="p" variant="bodySm" tone="subdued">
            {helper}
          </Text>
        ) : null}
      </BlockStack>
    </Card>
  );
}

export default StatCard;
