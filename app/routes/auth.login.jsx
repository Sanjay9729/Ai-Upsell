import { login } from "../shopify.server";

export const loader = async ({ request }) => {
  const errors = login(request);
  return errors;
};

export default function Auth() {
  return (
    <div style={{ fontFamily: "sans-serif", maxWidth: 400, margin: "80px auto", textAlign: "center" }}>
      <h1 style={{ marginBottom: 24 }}>AI Upsell</h1>
      <form method="get" action="/auth">
        <label style={{ display: "block", marginBottom: 8, fontWeight: 600 }}>
          Enter your Shopify store domain
        </label>
        <input
          type="text"
          name="shop"
          placeholder="your-store.myshopify.com"
          style={{
            width: "100%",
            padding: "10px 12px",
            fontSize: 16,
            border: "1px solid #ccc",
            borderRadius: 6,
            marginBottom: 16,
            boxSizing: "border-box",
          }}
        />
        <button
          type="submit"
          style={{
            width: "100%",
            padding: "12px",
            fontSize: 16,
            background: "#008060",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          Log in
        </button>
      </form>
    </div>
  );
}
