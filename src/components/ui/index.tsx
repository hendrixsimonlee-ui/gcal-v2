/** The app's shared building blocks.
 *
 * Before these existed, every screen hand-rolled its own card, its own button
 * and its own empty state, so padding, radius and weight drifted apart and
 * nothing looked like it belonged to the same product. Anything used on more
 * than one screen belongs here.
 *
 * These are presentational only — no data fetching, no actions — so they can
 * be used from server and client components alike. */

import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/* ---------------------------------------------------------------- page ---- */

/** The top of every screen: what it is, what it's for, and the one action
 * most likely to be wanted. Consistent placement means the eye lands in the
 * same spot on every page instead of hunting. */
export function PageHeader({
  title,
  description,
  actions,
  back,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <header className="flex flex-col gap-3">
      {back && (
        <Link
          href={back.href}
          className="inline-flex w-fit items-center gap-1 text-sm font-medium text-ink-soft transition-colors hover:text-ink"
        >
          <span aria-hidden="true">←</span> {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-[-0.015em] text-ink">
            {title}
          </h1>
          {description && (
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-soft">
              {description}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {actions}
          </div>
        )}
      </div>
    </header>
  );
}

/** Vertical rhythm for a screen. Every page is a Stack of Cards. */
export function Stack({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-col gap-4", className)}>{children}</div>
  );
}

/* ---------------------------------------------------------------- card ---- */

export function Card({
  children,
  className,
  tone = "default",
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  tone?: "default" | "warn" | "bad" | "good" | "accent";
  padded?: boolean;
}) {
  const tones = {
    default: "border-line bg-surface",
    warn: "border-warn/35 bg-warn-soft",
    bad: "border-bad/35 bg-bad-soft",
    good: "border-good/35 bg-good-soft",
    accent: "border-accent/35 bg-accent-soft",
  } as const;

  return (
    <section
      className={cx(
        "rounded-xl border shadow-[var(--shadow-card)]",
        tones[tone],
        padded && "p-4 sm:p-5",
        className,
      )}
    >
      {children}
    </section>
  );
}

/** A heading inside a card, with room for a control on the right. */
export function CardHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "flex flex-wrap items-start justify-between gap-x-4 gap-y-2",
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-sm font-semibold tracking-[-0.01em] text-ink">
          {title}
        </h2>
        {description && (
          <p className="mt-1 max-w-prose text-sm leading-relaxed text-ink-soft">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      )}
    </div>
  );
}

/** A small all-caps label above a group. Used sparingly — only where a list
 * genuinely has named sections. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-faint">
      {children}
    </p>
  );
}

/* -------------------------------------------------------------- button ---- */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "quiet";
type ButtonSize = "sm" | "md";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-on-accent hover:bg-accent-hover",
  secondary:
    "border border-line-strong bg-surface text-ink hover:bg-surface-2",
  ghost: "text-ink-soft hover:bg-surface-3 hover:text-ink",
  danger: "border border-bad/40 bg-transparent text-bad hover:bg-bad-soft",
  // For inline text actions inside a row, where a full button would shout.
  quiet: "text-accent underline-offset-2 hover:underline",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "px-2.5 py-1 text-xs",
  md: "px-3 py-1.5 text-sm",
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <button
      {...props}
      className={cx(
        BUTTON_BASE,
        BUTTON_VARIANTS[variant],
        variant === "quiet" ? "" : BUTTON_SIZES[size],
        className,
      )}
    />
  );
}

/** A link that looks like a button, for navigation rather than action. */
export function ButtonLink({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ComponentProps<typeof Link> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <Link
      {...props}
      className={cx(
        BUTTON_BASE,
        BUTTON_VARIANTS[variant],
        variant === "quiet" ? "" : BUTTON_SIZES[size],
        className,
      )}
    />
  );
}

/* --------------------------------------------------------------- badge ---- */

export type Tone = "neutral" | "good" | "warn" | "bad" | "info" | "accent";

const BADGE_TONES: Record<Tone, string> = {
  neutral: "bg-surface-3 text-ink-soft",
  good: "bg-good-soft text-good",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  info: "bg-info-soft text-info",
  accent: "bg-accent-soft text-accent",
};

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A coloured stripe down the left of a row. Encodes state in form as well as
 * colour, which is what makes a long list scannable without reading it. */
export function ToneStripe({ tone }: { tone: Tone }) {
  const colors: Record<Tone, string> = {
    neutral: "bg-line-strong",
    good: "bg-good",
    warn: "bg-warn",
    bad: "bg-bad",
    info: "bg-info",
    accent: "bg-accent",
  };
  return (
    <span
      aria-hidden="true"
      className={cx("w-1 shrink-0 self-stretch rounded-full", colors[tone])}
    />
  );
}

/* ---------------------------------------------------------------- data ---- */

/** One headline number with its label. The summary a screen opens with. */
export function Stat({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
}) {
  const valueTones: Record<Tone, string> = {
    neutral: "text-ink",
    good: "text-good",
    warn: "text-warn",
    bad: "text-bad",
    info: "text-info",
    accent: "text-accent",
  };
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-faint">
        {label}
      </span>
      <span
        className={cx(
          "text-2xl font-semibold tabular-nums tracking-[-0.02em]",
          valueTones[tone],
        )}
      >
        {value}
      </span>
      {hint && <span className="text-xs text-ink-soft">{hint}</span>}
    </div>
  );
}

/** Says what would be here and how to make it appear. An empty screen that
 * only says "None" leaves someone stuck. */
export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-line-strong px-4 py-6">
      <p className="text-sm font-medium text-ink">{title}</p>
      {hint && <p className="max-w-prose text-sm text-ink-soft">{hint}</p>}
      {action}
    </div>
  );
}

/* --------------------------------------------------------------- forms ---- */

const CONTROL =
  "rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input {...props} className={cx(CONTROL, className)} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select {...props} className={cx(CONTROL, "pr-8", className)} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea {...props} className={cx(CONTROL, className)} />;
}

/** A labelled control. The label is always visible — placeholder-as-label
 * disappears the moment someone types, which is when they most need it. */
export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx("flex flex-col gap-1", className)}>
      <span className="text-xs font-medium text-ink-soft">{label}</span>
      {children}
      {hint && <span className="text-xs text-ink-faint">{hint}</span>}
    </label>
  );
}

/* ------------------------------------------------------------ messages ---- */

export function Notice({
  tone = "info",
  children,
}: {
  tone?: "info" | "good" | "warn" | "bad";
  children: ReactNode;
}) {
  const tones = {
    info: "border-info/30 bg-info-soft text-info",
    good: "border-good/30 bg-good-soft text-good",
    warn: "border-warn/30 bg-warn-soft text-warn",
    bad: "border-bad/30 bg-bad-soft text-bad",
  } as const;
  return (
    <p
      className={cx(
        "rounded-lg border px-3 py-2 text-sm font-medium",
        tones[tone],
      )}
    >
      {children}
    </p>
  );
}

/** A thin divider between rows in a list. */
export function Rows({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <ul className={cx("flex flex-col divide-y divide-line", className)}>
      {children}
    </ul>
  );
}
