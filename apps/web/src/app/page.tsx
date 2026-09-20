import Link from "next/link";
import { Header } from "@/components/Header";

const blocks = [
  { title: "Options", body: "Trade volatility and defined-risk exposure." },
  { title: "Perpetuals", body: "Long or short tokenized equities with leverage." },
  { title: "Onchain", body: "Collateral, positions and settlement remain verifiable." },
];

export default function Landing() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center gap-16 px-6 py-16">
        <div>
          <p className="text-sm font-medium tracking-[0.32em] text-muted">ORIONIS MARKETS</p>
          <h1 className="mt-6 max-w-3xl text-5xl font-medium leading-[1.08] tracking-tight sm:text-6xl">
            Derivatives for tokenized equities.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">
            Trade options and perpetual derivatives on tokenized markets.
          </p>
          <div className="mt-10 flex gap-3">
            <Link
              href="/perpetuals"
              className="inline-flex h-10 items-center rounded-[3px] bg-text px-5 text-sm font-medium text-ground hover:bg-text/85"
            >
              Launch terminal
            </Link>
            <Link
              href="/markets"
              className="inline-flex h-10 items-center rounded-[3px] border border-line px-5 text-sm font-medium hover:border-faint hover:bg-raised"
            >
              Explore markets
            </Link>
          </div>
        </div>
        <dl className="grid gap-px border border-line bg-line sm:grid-cols-3">
          {blocks.map((block) => (
            <div key={block.title} className="bg-ground p-5">
              <dt className="font-medium">{block.title}</dt>
              <dd className="mt-2 leading-relaxed text-muted">{block.body}</dd>
            </div>
          ))}
        </dl>
      </main>
    </div>
  );
}
