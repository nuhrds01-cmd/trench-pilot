import { cn } from "@/lib/utils";

export function Badge({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border border-[var(--line)] bg-[var(--panel)] px-2 py-0.5 font-mono text-[11px] uppercase tracking-wide text-[var(--muted)]",
        className,
      )}
      {...props}
    />
  );
}
