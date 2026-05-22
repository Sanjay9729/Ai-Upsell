import { useMediaQuery } from "@shopify/polaris";
import { Box, InlineStack } from "@shopify/polaris";
import { AppNavigation } from "./AppNavigation";

export function AppLayout({ children }) {
  const isMobile = useMediaQuery("(max-width: 767px)");
  const isTablet = useMediaQuery("(max-width: 1023px)");

  if (isMobile) {
    return (
      <Box>
        {/* Mobile Navigation */}
        <AppNavigation isMobile={true} />
        {/* Content */}
        <Box padding="400">
          {children}
        </Box>
      </Box>
    );
  }

  // Desktop layout with sidebar
  return (
    <InlineStack gap="0" blockAlign="stretch" style={{ minHeight: "100vh" }}>
      {/* Sidebar */}
      <Box style={{ flex: "0 0 240px" }}>
        <AppNavigation isMobile={false} />
      </Box>
      {/* Main Content */}
      <Box style={{ flex: 1, overflow: "auto" }} padding="400">
        {children}
      </Box>
    </InlineStack>
  );
}
