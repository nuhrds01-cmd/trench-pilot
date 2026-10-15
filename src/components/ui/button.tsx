import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-40 outline-none focus-visible:ring-2 focus-visible:ring-[var(--acid)]/50",
  {
    variants: {
      variant: {
        default:
          "bg-[var(--acid)] text-[var(--ink)] hover:brightness-110 active:translate-y-px",
        secondary:
          "bg-[var(--panel)] text-[var(--foam)] border border-[var(--line)] hover:border-[var(--acid)]/50",
        ghost: "text-[var(--foam)] hover:bg-white/5",
        danger:
          "bg-[var(--danger)] text-white hover:brightness-110 active:translate-y-px",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 px-3 text-xs",
        lg: "h-11 px-6",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}
