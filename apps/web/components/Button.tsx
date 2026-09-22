"use client";

import { forwardRef } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const variants: Record<Variant, string> = {
  primary: "bg-ink text-paper-raised hover:bg-ink/90 disabled:bg-ink/40",
  secondary: "bg-transparent text-ink border border-line-strong hover:border-ink disabled:opacity-40",
  ghost: "bg-transparent text-ink-soft hover:text-ink disabled:opacity-40",
  danger: "bg-transparent text-red border border-red/40 hover:border-red disabled:opacity-40",
};

export const Button = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }>(
  ({ variant = "secondary", className = "", ...props }, ref) => (
    <button
      ref={ref}
      className={`inline-flex items-center justify-center gap-1.5 rounded-[3px] px-3 py-1.5 text-[13px] font-medium transition-colors disabled:cursor-not-allowed ${variants[variant]} ${className}`}
      {...props}
    />
  ),
);
Button.displayName = "Button";
