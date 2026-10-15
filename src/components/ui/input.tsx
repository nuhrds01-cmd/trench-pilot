import * as React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "flex h-10 w-full rounded-md border border-[var(--line)] bg-[var(--panel-deep)] px-3 py-2 text-sm text-[var(--foam)] placeholder:text-[var(--muted)] outline-none focus:border-[var(--acid)]/60",
        className,
      )}
      {...props}
    />
  );
}
