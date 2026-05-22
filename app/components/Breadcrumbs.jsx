import { useLocation } from "@remix-run/react";
import { InlineStack, Link, Text } from "@shopify/polaris";

const BREADCRUMB_MAP = {
  "/app": { label: "Dashboard", parent: null },
  "/app/goal-setup": { label: "Goal Setup", parent: "/app" },
  "/app/bundles": { label: "Bundles", parent: "/app" },
  "/app/analytics": { label: "Analytics", parent: "/app" },
  "/app/optimize": { label: "Optimize", parent: "/app" },
  "/app/safety": { label: "Safety Mode", parent: "/app" },
  "/app/settings": { label: "Settings", parent: "/app" },
};

export function Breadcrumbs() {
  const location = useLocation();
  const breadcrumbInfo = BREADCRUMB_MAP[location.pathname];

  if (!breadcrumbInfo) {
    return null;
  }

  const breadcrumbs = [];
  let current = location.pathname;

  while (current && BREADCRUMB_MAP[current]) {
    const info = BREADCRUMB_MAP[current];
    breadcrumbs.unshift({
      path: current,
      label: info.label,
    });
    current = info.parent;
  }

  return (
    <InlineStack gap="200" blockAlign="center">
      {breadcrumbs.map((crumb, index) => (
        <InlineStack key={crumb.path} gap="200" blockAlign="center">
          {index > 0 && (
            <Text as="span" variant="bodySm" tone="subdued">
              /
            </Text>
          )}
          {index === breadcrumbs.length - 1 ? (
            <Text as="span" variant="bodySm" fontWeight="bold">
              {crumb.label}
            </Text>
          ) : (
            <Link url={crumb.path} removeUnderline>
              <Text as="span" variant="bodySm" tone="interactive">
                {crumb.label}
              </Text>
            </Link>
          )}
        </InlineStack>
      ))}
    </InlineStack>
  );
}
