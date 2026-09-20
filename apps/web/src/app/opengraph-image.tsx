import { ImageResponse } from "next/og";

export const alt = "AlphaMarkets — Derivatives for tokenized equities";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Social preview. Same palette as globals.css: charcoal ground, off-white text, one thin ring.
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 96px",
          background: "#1a1a19",
          color: "#ece9e2",
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 56,
            border: "6px solid #ece9e2",
            marginBottom: 48,
          }}
        />
        <div style={{ fontSize: 72, letterSpacing: 18, fontWeight: 500 }}>ALPHAMARKETS</div>
        <div style={{ fontSize: 34, color: "#aaa9a2", marginTop: 28 }}>Derivatives for tokenized equities.</div>
      </div>
    ),
    size,
  );
}
