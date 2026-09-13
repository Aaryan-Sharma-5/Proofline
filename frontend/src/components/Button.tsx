import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";

import { buttonClass, type ButtonTone } from "../lib/ui";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: ButtonTone;
  children: ReactNode;
}

export function Button({ tone = "secondary", className, children, ...rest }: ButtonProps) {
  return (
    <button type="button" className={buttonClass(tone, className ?? "")} {...rest}>
      {children}
    </button>
  );
}

/** A link that carries the same weight as a button, for navigation actions. */
export function LinkButton({
  href,
  tone = "secondary",
  className,
  children,
  ...rest
}: {
  href: string;
  tone?: ButtonTone;
  className?: string;
  children: ReactNode;
} & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a href={href} className={buttonClass(tone, className ?? "")} {...rest}>
      {children}
    </a>
  );
}
