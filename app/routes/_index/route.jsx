import { Form, useLoaderData } from "@remix-run/react";
import { redirect } from "@remix-run/node";
import { login } from "../../shopify.server";
import styles from "./styles.module.css";

export const loader = async ({ request }) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    // In embedded admin, redirect into the /app route so App Bridge can handle auth.
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData();

  return (
    <div className={styles.page}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.logo}>
          <span className={styles.logoIcon}>🤖</span>
          <span className={styles.logoText}>AI Upsell</span>
        </div>
      </header>

      {/* Hero */}
      <section className={styles.hero}>
        <div className={styles.heroContent}>
          <div className={styles.badge}>Powered by Groq AI</div>
          <h1 className={styles.heroHeading}>
            Boost Sales with <span className={styles.highlight}>AI-Powered</span> Upsell Recommendations
          </h1>
          <p className={styles.heroText}>
            Automatically show the right products to the right customers — on product pages and in the cart. Increase average order value with zero manual effort.
          </p>

          {showForm && (
            <div className={styles.loginBox}>
              <p className={styles.loginLabel}>Install on your Shopify store</p>
              <Form className={styles.form} method="post" action="/auth/login">
                <div className={styles.inputGroup}>
                  <input
                    className={styles.input}
                    type="text"
                    name="shop"
                    placeholder="your-store.myshopify.com"
                  />
                  <button className={styles.button} type="submit">
                    Get Started →
                  </button>
                </div>
                <span className={styles.inputHint}>e.g: my-shop-domain.myshopify.com</span>
              </Form>
            </div>
          )}
        </div>
      </section>

      {/* Features */}
      <section className={styles.features}>
        <h2 className={styles.featuresHeading}>Everything you need to upsell smarter</h2>
        <div className={styles.featureGrid}>
          <div className={styles.featureCard}>
            <div className={styles.featureIcon}>🧠</div>
            <h3 className={styles.featureTitle}>Groq AI Recommendations</h3>
            <p className={styles.featureDesc}>
              Uses Llama 3.3 70B to analyze product type, category, brand, and keywords — then recommends the most relevant upsell products in real time.
            </p>
          </div>
          <div className={styles.featureCard}>
            <div className={styles.featureIcon}>🛍️</div>
            <h3 className={styles.featureTitle}>Product Page Upsell</h3>
            <p className={styles.featureDesc}>
              Automatically shows related products on any product page. Fully customizable heading, colors, and layout via the Shopify Theme Editor.
            </p>
          </div>
          <div className={styles.featureCard}>
            <div className={styles.featureIcon}>🛒</div>
            <h3 className={styles.featureTitle}>Cart Page Upsell</h3>
            <p className={styles.featureDesc}>
              Analyzes the full cart and suggests complementary items. Customers can add upsells directly from the cart — no page reload needed.
            </p>
          </div>
          <div className={styles.featureCard}>
            <div className={styles.featureIcon}>📊</div>
            <h3 className={styles.featureTitle}>Analytics & Activity Logs</h3>
            <p className={styles.featureDesc}>
              Track every upsell impression, click, and cart add. See which products drive the most conversions with a built-in analytics dashboard.
            </p>
          </div>
          <div className={styles.featureCard}>
            <div className={styles.featureIcon}>⚡</div>
            <h3 className={styles.featureTitle}>Fast & Lightweight</h3>
            <p className={styles.featureDesc}>
              In-memory caching keeps recommendations instant. MongoDB stores your product catalog so AI queries are fast and reliable every time.
            </p>
          </div>
          <div className={styles.featureCard}>
            <div className={styles.featureIcon}>🎨</div>
            <h3 className={styles.featureTitle}>Theme Editor Ready</h3>
            <p className={styles.featureDesc}>
              Add, configure, and position upsell blocks directly from the Shopify Theme Editor — no coding required. Works with any Shopify theme.
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className={styles.footer}>
        <p>© 2026 AI Upsell · Built for Shopify merchants</p>
      </footer>
    </div>
  );
}
