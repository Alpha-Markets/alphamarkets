import { ImageResponse } from "next/og";

export const alt = "Orionis Markets — Derivatives for tokenized equities";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Social preview. Same palette as globals.css: black ground, off-white text, one thin ring.
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
          background: "#000000",
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
        <div style={{ fontSize: 72, letterSpacing: 18, fontWeight: 500 }}>ORIONIS MARKETS</div>
        <div style={{ fontSize: 34, color: "#8a8983", marginTop: 28 }}>Derivatives for tokenized equities.</div>
      </div>
    ),
    size,
  );
}
