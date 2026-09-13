import { ProductFlow } from "../components/ProductFlow";
import { buttonClass } from "../lib/ui";

// Shared button vocabulary, so the landing CTAs and the in-app actions match.
const BUTTON =
  "inline-flex items-center justify-center gap-2 rounded-[6px] border px-4 py-2.5 " +
  "text-[0.845rem] font-medium transition-colors duration-150";

const PRIMARY = buttonClass("primary");
const SECONDARY = buttonClass("secondary");

const PRINCIPLES = [
  {
    title: "Evidence",
    body: "Named, inspectable findings instead of an opaque numeric rating.",
  },
  {
    title: "Deterministic",
    body: "The verification decision is produced by explicit rules, not an LLM.",
  },
  {
    title: "Machine-payable",
    body: "An agent can purchase the verification step through Hedera x402.",
  },
  {
    title: "Auditable",
    body: "Verification events can be associated with onchain payment proof and, when enabled, an HCS audit record.",
  },
] as const;

export function Landing() {
  return (
    <div className="mx-auto max-w-[1200px] px-6 sm:px-8">
      <SiteHeader />

      <main>
        <Hero />
        <Problem />
        <Flow />
        <Principles />
        <LiveCta />
      </main>

      <SiteFooter />
    </div>
  );
}

function SiteHeader() {
  return (
    <header className="flex flex-wrap items-center gap-x-8 gap-y-4 border-b border-line py-5">
      <a
        href="/"
        className="flex items-center gap-2.5 text-[0.9rem] font-semibold tracking-[0.14em] text-ink"
      >
        <span aria-hidden="true" className="h-3.5 w-0.75 bg-ink" />
        PROOFLINE
      </a>

      <nav aria-label="Primary" className="flex items-center gap-6 text-[0.83rem]">
        <a href="#product" className="text-muted hover:text-ink">
          Product
        </a>
        <a href="#how-it-works" className="text-muted hover:text-ink">
          How it works
        </a>
        <a href="/history" className="text-muted hover:text-ink">
          History
        </a>
        <a href="/docs" className="text-muted hover:text-ink">
          API
        </a>
      </nav>

      <div className="ml-auto flex items-center gap-4">
        <span className="hidden rounded border border-line-strong px-1.5 py-0.5 font-mono text-[0.68rem] text-faint sm:inline">
          Hedera testnet
        </span>
        <a href="/app" className={SECONDARY}>
          Open verifier →
        </a>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section
      id="product"
      aria-labelledby="hero-heading"
      className="grid grid-cols-1 items-center gap-x-16 gap-y-14 py-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,540px)] lg:py-20"
    >
      <div>
        <p className="flex items-center gap-3 font-mono text-[0.68rem] uppercase tracking-[0.14em] text-faint">
          <span aria-hidden="true" className="h-px w-8 bg-line-strong" />
          Document integrity / machine-payable verification
        </p>

        <h1
          id="hero-heading"
          className="mt-6 text-[2.6rem] font-semibold leading-[1.04] tracking-[-0.028em] text-balance sm:text-[3.4rem]"
        >
          Verify before the money moves.
        </h1>

        <p className="mt-6 max-w-[33rem] border-l border-line-strong pl-5 text-[1.05rem] leading-[1.6] text-muted">
          Proofline gives autonomous financial agents an evidence-backed document
          integrity check before they release funds.
        </p>

        <div className="mt-9 flex flex-wrap items-center gap-2.5">
          <a href="/app" className={PRIMARY}>
            Verify a document →
          </a>
          <a href="/docs" className={SECONDARY}>
            Explore the API
          </a>
        </div>
      </div>

      <HeroArtifact />
    </section>
  );
}

/**
 * A static composition of the product's own vocabulary, not a rendered run.
 * No transaction id and no settled state, so it cannot read as live telemetry.
 */
function HeroArtifact() {
  return (
    <figure className="m-0 motion-safe:animate-[artifact-in_.5s_ease-out_both]">
      <div className="rounded-[10px] border border-line-strong bg-panel">
        <div className="flex items-baseline justify-between gap-4 border-b border-line px-7 py-4">
          <span className="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-faint">
            Proofline / verification
          </span>
          <span className="rounded-sm border border-line-strong px-1.5 py-0.5 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-faint">
            Example
          </span>
        </div>

        <div className="border-b border-line px-7 py-5">
          <div className="break-all font-mono text-[0.88rem] text-ink">
            03_changed_beneficiary.pdf
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[0.74rem] text-muted">
            <span>x402</span>
            <span aria-hidden="true" className="text-faint">
              ·
            </span>
            <span>0.02 HBAR</span>
          </div>
        </div>

        <ArtifactRow label="Evidence">
          <div className="break-all font-mono text-[0.85rem] font-semibold leading-snug text-ink">
            BENEFICIARY_ACCOUNT_NEVER_SEEN
          </div>
          <div className="mt-2.5">
            <span className="inline-block whitespace-nowrap rounded-sm border border-line-strong px-1.5 py-0.5 font-mono text-[0.62rem] tracking-[0.06em] text-faint">
              LEVEL A · SEMANTIC
            </span>
          </div>
        </ArtifactRow>

        {/* The decision is the point of the whole card, so it carries the weight. */}
        <div className="border-b border-line bg-review-bg/40 px-7 py-7">
          <div className="mb-3.5 font-mono text-[0.64rem] uppercase tracking-[0.12em] text-faint">
            Decision
          </div>
          <div className="font-mono text-[2.6rem] font-bold leading-none tracking-[0.02em] text-review">
            REVIEW
          </div>
        </div>

        <ArtifactRow label="Agent action" last>
          <span className="font-mono text-[0.9rem] font-semibold tracking-[0.04em] text-review">
            PAYMENT HALTED
          </span>
        </ArtifactRow>
      </div>

      <figcaption className="mt-3 text-[0.74rem] leading-relaxed text-faint">
        Illustrative product example, not live data. Real runs, with a real Hedera
        testnet payment, happen in{" "}
        <a href="/app" className="text-muted underline underline-offset-2 hover:text-ink">
          the verifier
        </a>
        .
      </figcaption>
    </figure>
  );
}

function ArtifactRow({
  label,
  children,
  last = false,
}: {
  label: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div className={last ? "px-7 py-5.5" : "border-b border-line px-7 py-5.5"}>
      <div className="mb-2.5 font-mono text-[0.64rem] uppercase tracking-[0.12em] text-faint">
        {label}
      </div>
      {children}
    </div>
  );
}

function Problem() {
  return (
    <section
      aria-labelledby="problem-heading"
      className="border-t border-line py-16 lg:py-20"
    >
      <div className="grid grid-cols-1 items-start gap-x-16 gap-y-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)]">
        <div>
          <h2
            id="problem-heading"
            className="max-w-[28rem] text-balance text-[1.5rem] font-semibold leading-[1.2] tracking-[-0.015em] sm:text-[1.75rem]"
          >
            Autonomous payments need evidence, not just extraction.
          </h2>

          <p className="mt-6 border-t border-line pt-4 font-mono text-[0.7rem] uppercase leading-relaxed tracking-[0.1em] text-faint">
            The gap is not reading the document.
            <br />
            It is proving what changed.
          </p>
        </div>

        <div className="space-y-4 text-[0.94rem] leading-relaxed text-muted">
          <p>
            AP agents can already read and reason over financial documents. The
            specialist integrity checks that sit behind a payment decision are a
            different matter: they tend to live in managed services and human review
            queues, reached through an ongoing vendor relationship.
          </p>
          <p>
            An agent evaluating a single document from an unfamiliar counterparty
            has neither, and should not need either to get one answer. Proofline is
            built as a machine-payable verification step that an agent invokes only
            when it needs one.
          </p>
        </div>
      </div>
    </section>
  );
}

function Flow() {
  return (
    <section
      id="how-it-works"
      aria-labelledby="flow-heading"
      className="border-t border-line py-16 lg:py-20"
    >
      <h2
        id="flow-heading"
        className="flex items-center gap-3 font-mono text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-faint"
      >
        <span aria-hidden="true" className="h-px w-8 bg-line-strong" />
        How it works
      </h2>

      <div className="mt-10">
        <ProductFlow />
      </div>

      <p className="mt-8 max-w-[46rem] text-[0.88rem] leading-relaxed text-muted">
        Payment is verified before any expensive analysis runs, and the forensic
        engine never sees the payment layer. A decision is reached by explicit
        policy rules over named evidence, then the agent proceeds or halts.
      </p>
    </section>
  );
}

function Principles() {
  return (
    <section
      aria-labelledby="principles-heading"
      className="border-t border-line py-16 lg:py-20"
    >
      <h2
        id="principles-heading"
        className="flex items-center gap-3 font-mono text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-faint"
      >
        <span aria-hidden="true" className="h-px w-8 bg-line-strong" />
        Why Proofline
      </h2>

      <dl className="mt-8 grid grid-cols-1 gap-x-12 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
        {PRINCIPLES.map((item) => (
          <div key={item.title} className="border-t border-line pt-4">
            <dt className="font-mono text-[0.72rem] uppercase tracking-[0.08em] text-ink">
              {item.title}
            </dt>
            <dd className="m-0 mt-2.5 text-[0.86rem] leading-relaxed text-muted">
              {item.body}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function LiveCta() {
  return (
    <section
      aria-labelledby="cta-heading"
      className="border-t border-line py-16 lg:py-20"
    >
      {/* Inverted: the strongest surface on the page, and the last thing read. */}
      <div className="on-ink rounded-[10px] bg-ink px-6 py-12 text-white sm:px-12 sm:py-14">
        <p className="flex items-center gap-3 font-mono text-[0.66rem] uppercase tracking-[0.14em] text-white/55">
          <span aria-hidden="true" className="h-px w-8 bg-white/30" />
          Live on Hedera testnet
        </p>

        <h2
          id="cta-heading"
          className="mt-5 text-[1.9rem] font-semibold tracking-[-0.02em] sm:text-[2.25rem]"
        >
          See it work.
        </h2>
        <p className="mt-4 max-w-[34rem] text-[0.97rem] leading-relaxed text-white/70">
          Send a document through the real verification flow. Each run performs a
          real Hedera testnet payment through a server-side reference agent. No
          wallet needed.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-2.5">
          <a
            href="/app?sample=clear"
            className={`${BUTTON} border-white bg-white text-ink hover:bg-white/90`}
          >
            Try CLEAR sample →
          </a>
          <a
            href="/app?sample=review"
            className={`${BUTTON} border-white/35 bg-transparent text-white hover:border-white/70 hover:bg-white/10`}
          >
            Try REVIEW sample →
          </a>
        </div>
      </div>
    </section>
  );
}

function SiteFooter() {
  return (
    <footer className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-line py-8 text-[0.82rem]">
      <a
        href="https://github.com/Aaryan-Sharma-5/Proofline"
        target="_blank"
        rel="noopener noreferrer"
        className="text-muted underline underline-offset-2 hover:text-ink"
      >
        GitHub
      </a>
      <a href="/docs" className="text-muted underline underline-offset-2 hover:text-ink">
        API
      </a>
      <a
        href="/history"
        className="text-muted underline underline-offset-2 hover:text-ink"
      >
        Verification history
      </a>
      <span className="ml-auto font-mono text-[0.68rem] uppercase tracking-[0.08em] text-faint">
        Hedera testnet
      </span>
    </footer>
  );
}
