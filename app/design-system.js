/**
 * Design tokens for the AI Upsell admin app.
 *
 * Prefer Polaris React components and Polaris CSS tokens first.
 * Use these tokens only when inline styles are unavoidable (e.g. inside
 * third-party containers or when a quick value is needed during refactor).
 *
 * Values are aligned with Polaris 13 design tokens so the output visually
 * matches Shopify admin. https://polaris.shopify.com/design/typography
 */

export const colors = {
  // Backgrounds
  surface: "var(--p-color-bg-surface, #ffffff)",
  surfaceSecondary: "var(--p-color-bg-surface-secondary, #f7f7f8)",
  surfaceHover: "var(--p-color-bg-surface-hover, #f1f2f3)",
  surfaceSelected: "var(--p-color-bg-surface-selected, #e9f0fb)",
  surfaceSuccessSubdued: "var(--p-color-bg-success-subdued, #f0fdf4)",
  surfaceCriticalSubdued: "var(--p-color-bg-critical-subdued, #fff4f4)",
  surfaceWarningSubdued: "var(--p-color-bg-warning-subdued, #fffbeb)",
  surfaceInfoSubdued: "var(--p-color-bg-info-subdued, #f0f9ff)",

  // Text
  text: "var(--p-color-text, #303030)",
  textSubdued: "var(--p-color-text-subdued, #6d7175)",
  textDisabled: "var(--p-color-text-disabled, #8c9196)",
  textOnPrimary: "var(--p-color-text-on-color, #ffffff)",
  textSuccess: "var(--p-color-text-success, #008060)",
  textCritical: "var(--p-color-text-critical, #b42318)",
  textWarning: "var(--p-color-text-warning, #b76e00)",

  // Borders
  border: "var(--p-color-border, #e1e3e5)",
  borderSubdued: "var(--p-color-border-subdued, #f1f2f3)",
  borderSuccess: "var(--p-color-border-success, #008060)",
  borderCritical: "var(--p-color-border-critical, #b42318)",

  // Brand
  accent: "var(--p-color-bg-fill-brand, #005bd3)",
  accentHover: "var(--p-color-bg-fill-brand-hover, #004fb8)",
};

export const spacing = {
  // 4-pt system (matches Polaris spacing tokens 050..1600)
  xs: "4px", // 050
  sm: "8px", // 100
  md: "12px", // 150
  base: "16px", // 200
  lg: "20px", // 300 (close)
  xl: "24px", // 400
  xxl: "32px", // 500
  xxxl: "48px", // 600
};

export const radii = {
  sm: "4px",
  md: "8px",
  lg: "12px",
  pill: "9999px",
};

export const shadows = {
  card: "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
  popover:
    "0 4px 6px -1px rgba(0, 0, 0, 0.08), 0 2px 4px -1px rgba(0, 0, 0, 0.04)",
};

export const typography = {
  fontFamily:
    'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  fontFamilyMono:
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  sizeXs: "12px",
  sizeSm: "13px",
  sizeBase: "14px",
  sizeLg: "16px",
  sizeXl: "20px",
  size2xl: "28px",
  weightRegular: 400,
  weightMedium: 500,
  weightSemibold: 600,
  weightBold: 700,
  leadingTight: 1.3,
  leadingNormal: 1.5,
  leadingRelaxed: 1.6,
  letterSpacingLabel: "0.04em",
};

export const zIndex = {
  base: 0,
  elevated: 10,
  dropdown: 100,
  overlay: 500,
  modal: 1000,
  toast: 2000,
};

const tokens = { colors, spacing, radii, shadows, typography, zIndex };
export default tokens;
