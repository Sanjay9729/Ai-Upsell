import { Box, BlockStack, Card, InlineStack, Text } from "@shopify/polaris";

export function SkeletonCard({ height = "200px", lines = 3 }) {
  return (
    <Card>
      <BlockStack gap="300">
        {Array.from({ length: lines }).map((_, i) => (
          <Box
            key={i}
            background="bg-surface-disabled"
            borderRadius="200"
            style={{
              height: i === lines - 1 ? "16px" : "20px",
              opacity: 0.5,
              animation: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
            }}
          />
        ))}
      </BlockStack>
    </Card>
  );
}

export function SkeletonChart() {
  return (
    <Card>
      <BlockStack gap="300">
        {/* Header */}
        <Box
          background="bg-surface-disabled"
          borderRadius="200"
          style={{ height: "24px", width: "40%", opacity: 0.5 }}
        />

        {/* Chart placeholder */}
        <Box
          background="bg-surface-disabled"
          borderRadius="200"
          style={{
            height: "300px",
            opacity: 0.3,
            animation: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
          }}
        />
      </BlockStack>
    </Card>
  );
}

export function SkeletonTable({ rows = 5, columns = 4 }) {
  return (
    <Card>
      <BlockStack gap="300">
        {/* Header row */}
        <InlineStack gap="200">
          {Array.from({ length: columns }).map((_, i) => (
            <Box
              key={`header-${i}`}
              style={{ flex: 1 }}
              background="bg-surface-disabled"
              borderRadius="200"
            >
              <Box
                style={{
                  height: "20px",
                  opacity: 0.5,
                  animation:
                    "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
                }}
              />
            </Box>
          ))}
        </InlineStack>

        {/* Data rows */}
        {Array.from({ length: rows }).map((_, rowIndex) => (
          <InlineStack key={`row-${rowIndex}`} gap="200">
            {Array.from({ length: columns }).map((_, colIndex) => (
              <Box
                key={`cell-${rowIndex}-${colIndex}`}
                style={{ flex: 1 }}
                background="bg-surface-disabled"
                borderRadius="200"
              >
                <Box
                  style={{
                    height: "16px",
                    opacity: 0.3,
                    animation:
                      "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
                  }}
                />
              </Box>
            ))}
          </InlineStack>
        ))}
      </BlockStack>
    </Card>
  );
}

export function SkeletonGrid({ columns = 3, items = 3 }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fit, minmax(200px, 1fr))`,
        gap: "16px",
      }}
    >
      {Array.from({ length: items }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

export function SkeletonMetrics() {
  return (
    <InlineStack gap="300">
      {Array.from({ length: 3 }).map((_, i) => (
        <Box key={i} style={{ flex: 1 }}>
          <SkeletonCard lines={2} />
        </Box>
      ))}
    </InlineStack>
  );
}

// Add pulse animation to global styles
const pulseStyles = `
  @keyframes pulse {
    0%, 100% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
  }
`;

if (typeof document !== "undefined") {
  const style = document.createElement("style");
  style.textContent = pulseStyles;
  document.head.appendChild(style);
}
