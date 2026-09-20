import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const alt = "AlphaMarkets — Derivatives for tokenized equities";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Social preview. Same palette as globals.css: charcoal ground and off-white text; the teal mark is the only colour.
export default async function OpengraphImage() {
  const mark = await readFile(join(process.cwd(), "src/assets/alphamarkets-mark.png"));
  const markSrc = `data:image/png;base64,${mark.toString("base64")}`;
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
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={markSrc} width={168} height={117} alt="" style={{ marginBottom: 44 }} />
        <div style={{ fontSize: 72, letterSpacing: 18, fontWeight: 500 }}>ALPHAMARKETS</div>
        <div style={{ fontSize: 34, color: "#aaa9a2", marginTop: 28 }}>Derivatives for tokenized equities.</div>
      </div>
    ),
    size,
  );
}
