import { Page, Card, TextField, Button, FormLayout, Text, BlockStack } from "@shopify/polaris";
import { useState } from "react";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import { login } from "../../shopify.server";
import { loginErrorMessage } from "./error.server";

export const loader = async ({ request }) => {
  const errors = loginErrorMessage(await login(request));

  return { errors };
};

export const action = async ({ request }) => {
  const errors = loginErrorMessage(await login(request));

  return {
    errors,
  };
};

export default function Auth() {
  const loaderData = useLoaderData();
  const actionData = useActionData();
  const [shop, setShop] = useState("");
  const { errors } = actionData || loaderData;

  return (
    <Page>
      <div style={{ maxWidth: "480px", margin: "80px auto" }}>
        <Card>
          <BlockStack gap="400">
            <Text as="h1" variant="headingLg" fontWeight="bold">Log in to AI Upsell</Text>
            <Form method="post">
              <FormLayout>
                <TextField
                  name="shop"
                  label="Shop domain"
                  helpText="example.myshopify.com"
                  value={shop}
                  onChange={(val) => setShop(val)}
                  autoComplete="on"
                  error={errors.shop}
                />
                <Button submit variant="primary">Log in</Button>
              </FormLayout>
            </Form>
          </BlockStack>
        </Card>
      </div>
    </Page>
  );
}

