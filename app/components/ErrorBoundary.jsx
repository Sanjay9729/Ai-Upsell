import { Component } from "react";
import { Card, BlockStack, Text, Button, Banner, Icon } from "@shopify/polaris";
import { AlertCircleIcon } from "@shopify/polaris-icons";

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Error caught by boundary:", error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <Card>
          <BlockStack gap="400">
            <Banner
              tone="critical"
              icon={AlertCircleIcon}
              title="Something went wrong"
            >
              <Text as="p" variant="bodySm">
                {this.state.error?.message ||
                  "An unexpected error occurred while loading this section."}
              </Text>
            </Banner>

            <BlockStack gap="200">
              <Text as="p" variant="bodySm" tone="subdued">
                <strong>Error Details:</strong>
                <br />
                <code
                  style={{
                    background: "#f5f5f5",
                    padding: "8px 12px",
                    borderRadius: "4px",
                    display: "block",
                    marginTop: "8px",
                    fontSize: "12px",
                    overflow: "auto",
                  }}
                >
                  {this.state.error?.toString()}
                </code>
              </Text>
            </BlockStack>

            <Button onClick={this.handleRetry} variant="primary">
              Try Again
            </Button>
          </BlockStack>
        </Card>
      );
    }

    return this.props.children;
  }
}
