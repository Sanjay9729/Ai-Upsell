import { useLocation } from "@remix-run/react";
import {
  Box,
  InlineStack,
  BlockStack,
  Link,
  Text,
  Icon,
  Badge,
  Divider,
} from "@shopify/polaris";
import {
  DashboardIcon,
  AnalyticsIcon,
  SettingsIcon,
  ShieldAlertIcon,
  ShoppingBagIcon,
  TargetIcon,
} from "@shopify/polaris-icons";

const NAV_ITEMS = [
  {
    label: "Dashboard",
    path: "/app",
    icon: DashboardIcon,
    description: "Overview & metrics",
  },
  {
    label: "Goal Setup",
    path: "/app/goal-setup",
    icon: TargetIcon,
    description: "Configure goals & guardrails",
  },
  {
    label: "Bundles",
    path: "/app/bundles",
    icon: ShoppingBagIcon,
    description: "Manage product bundles",
  },
  {
    label: "Analytics",
    path: "/app/analytics",
    icon: AnalyticsIcon,
    description: "View trends & insights",
  },
  {
    label: "Optimize",
    path: "/app/optimize",
    icon: AnalyticsIcon,
    description: "AI recommendations",
  },
  {
    label: "Safety",
    path: "/app/safety",
    icon: ShieldAlertIcon,
    description: "Emergency controls",
  },
  {
    label: "Settings",
    path: "/app/settings",
    icon: SettingsIcon,
    description: "System & config",
  },
];

function NavItem({ item, isActive, isMobile }) {
  return (
    <Link url={item.path} removeUnderline>
      <Box
        paddingInlineStart="400"
        paddingInlineEnd="400"
        paddingBlockStart="300"
        paddingBlockEnd="300"
        borderRadius="200"
        background={isActive ? "bg-surface-selected" : "transparent"}
        borderLeft={isActive ? "border-critical" : "transparent"}
        borderLeftWidth={isActive ? "4px" : "0"}
        paddingInlineStart={isActive ? "300" : "400"}
        style={{
          cursor: "pointer",
          transition: "all 0.2s ease",
        }}
      >
        <BlockStack gap="100">
          <InlineStack gap="200" blockAlign="center">
            <Icon source={item.icon} tone="base" />
            <Text
              as="span"
              variant="bodySm"
              fontWeight={isActive ? "bold" : "regular"}
              tone={isActive ? "success" : "base"}
            >
              {item.label}
            </Text>
          </InlineStack>
          {!isMobile && (
            <Text
              as="span"
              variant="bodySm"
              tone="subdued"
              style={{ fontSize: "11px" }}
            >
              {item.description}
            </Text>
          )}
        </BlockStack>
      </Box>
    </Link>
  );
}

export function AppNavigation({ isMobile = false }) {
  const location = useLocation();

  const isActive = (path) => {
    if (path === "/app") {
      return location.pathname === "/app" || location.pathname === "/app/";
    }
    return location.pathname.startsWith(path);
  };

  if (isMobile) {
    // Mobile: horizontal tab-like nav
    return (
      <Box
        background="bg-surface-secondary"
        borderBottomWidth="1"
        borderBottomColor="border"
        paddingBlockStart="100"
        paddingBlockEnd="100"
        overflowX="auto"
      >
        <InlineStack gap="100" blockAlign="center" wrap={false}>
          {NAV_ITEMS.slice(0, 4).map((item) => (
            <Box key={item.path} minWidth="80px" paddingInline="200">
              <Link url={item.path} removeUnderline>
                <BlockStack gap="50" align="center">
                  <Icon source={item.icon} tone="base" />
                  <Text
                    as="span"
                    variant="bodySm"
                    fontWeight={isActive(item.path) ? "bold" : "regular"}
                    tone={isActive(item.path) ? "success" : "base"}
                  >
                    {item.label}
                  </Text>
                </BlockStack>
              </Link>
            </Box>
          ))}
        </InlineStack>
      </Box>
    );
  }

  // Desktop: full sidebar
  return (
    <Box
      as="nav"
      background="bg-surface-secondary"
      borderRightWidth="1"
      borderRightColor="border"
      paddingBlockStart="300"
      paddingBlockEnd="300"
      style={{
        minHeight: "100vh",
        position: "sticky",
        top: 0,
      }}
    >
      <BlockStack gap="400">
        {/* Logo/Title */}
        <Box paddingInline="400" paddingBlock="200">
          <Text as="h3" variant="headingMd" fontWeight="bold">
            🤖 AI Upsell
          </Text>
          <Text as="span" variant="bodySm" tone="subdued">
            Merchant Dashboard
          </Text>
        </Box>

        <Divider />

        {/* Navigation Items */}
        <BlockStack gap="100">
          {NAV_ITEMS.map((item) => (
            <NavItem
              key={item.path}
              item={item}
              isActive={isActive(item.path)}
              isMobile={false}
            />
          ))}
        </BlockStack>

        <Divider />

        {/* Info Section */}
        <Box paddingInline="400">
          <BlockStack gap="200">
            <Text as="h4" variant="bodySm" fontWeight="bold" tone="subdued">
              HELP
            </Text>
            <Link url="#" removeUnderline>
              <Text as="span" variant="bodySm" tone="interactive">
                Documentation
              </Text>
            </Link>
            <Link url="#" removeUnderline>
              <Text as="span" variant="bodySm" tone="interactive">
                Contact Support
              </Text>
            </Link>
            <Link url="#" removeUnderline>
              <Text as="span" variant="bodySm" tone="interactive">
                View Changelog
              </Text>
            </Link>
          </BlockStack>
        </Box>
      </BlockStack>
    </Box>
  );
}
