/**
 * ZAKAR UI PRIMITIVES
 *
 * Shared building blocks that consume design tokens from `design-tokens.css`.
 * Every visual component should compose these rather than inlining hex codes.
 *
 * Conventions:
 * - Use semantic `zk-*` utility classes defined in index.css for tokens
 * - Never hardcode hex values in this file
 * - Every component forwards a `className` prop for composition
 * - Every interactive element handles focus-visible
 */

import React from "react";
import { X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "./lib/utils";

/* ============================================================
   Button
   ============================================================ */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      leftIcon,
      rightIcon,
      children,
      className,
      ...props
    },
    ref,
  ) => {
    const sizeClasses = {
      sm: "h-8 px-3 text-[12px] gap-1.5 rounded-lg",
      md: "h-10 px-4 text-[13px] gap-2 rounded-xl",
      lg: "h-12 px-6 text-[14px] gap-2 rounded-xl",
    }[size];

    const variantClasses = {
      primary:
        "zk-bg-primary font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
      secondary:
        "zk-surface-muted hover:zk-surface-sunken zk-text font-medium border zk-border-color transition-colors disabled:opacity-50",
      ghost:
        "zk-text-secondary hover:zk-surface-muted font-medium transition-colors disabled:opacity-50",
      danger:
        "bg-rose-500 hover:bg-rose-600 text-white font-semibold transition-colors disabled:opacity-50",
    }[variant];

    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center zk-focus-ring",
          sizeClasses,
          variantClasses,
          className,
        )}
        style={{ fontFamily: "var(--font-sans)" }}
        {...props}
      >
        {leftIcon}
        {children}
        {rightIcon}
      </button>
    );
  },
);
Button.displayName = "Button";

/* ============================================================
   IconButton — for toolbar/action icons
   ============================================================ */

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  size?: "sm" | "md";
  tooltip?: string;
  tooltipPosition?: "top" | "bottom";
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      size = "md",
      tooltip,
      tooltipPosition = "bottom",
      children,
      className,
      ...props
    },
    ref,
  ) => {
    const sizeClasses = {
      sm: "w-7 h-7 rounded-md",
      md: "w-9 h-9 rounded-lg",
    }[size];

    const button = (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center zk-text-muted transition-colors zk-focus-ring",
          "hover:zk-surface-muted hover:zk-text",
          "disabled:opacity-40 disabled:cursor-not-allowed",
          sizeClasses,
          className,
        )}
        {...props}
      >
        {children}
      </button>
    );

    if (!tooltip) return button;

    return (
      <div className="relative group inline-flex">
        {button}
        <span
          className={cn(
            "absolute left-1/2 -translate-x-1/2 px-2 py-1 text-[10px] font-medium text-white bg-[var(--color-surface-dark-raised)] rounded-md opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap transition-opacity z-30 zk-shadow-md",
            tooltipPosition === "top"
              ? "bottom-full mb-1.5"
              : "top-full mt-1.5",
          )}
          style={{ fontFamily: "var(--font-sans)" }}
        >
          {tooltip}
        </span>
      </div>
    );
  },
);
IconButton.displayName = "IconButton";

/* ============================================================
   Tooltip wrapper
   ============================================================ */

interface TooltipProps {
  label: string;
  position?: "top" | "bottom";
  children: React.ReactNode;
  className?: string;
}

export const Tooltip: React.FC<TooltipProps> = ({
  label,
  position = "bottom",
  children,
  className,
}) => (
  <div className={cn("relative group inline-flex", className)}>
    {children}
    <span
      className={cn(
        "absolute left-1/2 -translate-x-1/2 px-2 py-1 text-[10px] font-medium text-white bg-[var(--color-surface-dark-raised)] rounded-md opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap transition-opacity z-30 zk-shadow-md",
        position === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5",
      )}
      style={{ fontFamily: "var(--font-sans)" }}
    >
      {label}
    </span>
  </div>
);

/* ============================================================
   Pill — category badges, status chips
   ============================================================ */

type PillVariant =
  | "neutral"
  | "primary"
  | "task"
  | "idea"
  | "credential"
  | "web"
  | "personal"
  | "other";

interface PillProps {
  variant?: PillVariant;
  size?: "sm" | "md";
  children: React.ReactNode;
  className?: string;
}

export const Pill: React.FC<PillProps> = ({
  variant = "neutral",
  size = "sm",
  children,
  className,
}) => {
  const variantClasses = {
    neutral: "zk-surface-muted zk-text-muted",
    primary: "zk-bg-primary-container",
    task: "bg-[var(--color-cat-task-bg)] text-[var(--color-cat-task-text)] dark:bg-[var(--color-primary-dark-container)] dark:text-[var(--color-on-primary-dark-container)]",
    idea: "bg-[var(--color-cat-idea-bg)] text-[var(--color-cat-idea-text)] dark:bg-amber-900/30 dark:text-amber-300",
    credential:
      "bg-[var(--color-cat-credential-bg)] text-[var(--color-cat-credential-text)] dark:bg-rose-900/30 dark:text-rose-300",
    web: "bg-[var(--color-cat-web-bg)] text-[var(--color-cat-web-text)] dark:bg-sky-900/30 dark:text-sky-300",
    personal:
      "bg-[var(--color-cat-personal-bg)] text-[var(--color-cat-personal-text)] dark:bg-violet-900/30 dark:text-violet-300",
    other: "zk-surface-muted zk-text-muted",
  }[variant];

  const sizeClasses = {
    sm: "px-2 py-0.5 text-[9px]",
    md: "px-2.5 py-1 text-[10px]",
  }[size];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-bold uppercase tracking-wider rounded-full",
        sizeClasses,
        variantClasses,
        className,
      )}
      style={{ fontFamily: "var(--font-sans)" }}
    >
      {children}
    </span>
  );
};

/** Map a category string to a Pill variant */
export function categoryToPillVariant(category?: string): PillVariant {
  switch (category) {
    case "Task":
      return "task";
    case "Idea":
      return "idea";
    case "Credential":
      return "credential";
    case "Web Content":
      return "web";
    case "Personal":
      return "personal";
    case "Other":
    case "Uncategorized":
    default:
      return "other";
  }
}

/** Get the solid accent color for a category (for dots, stripes, pins) */
export function categoryToAccentClass(category?: string): string {
  switch (category) {
    case "Task":
      return "bg-[var(--color-cat-task)]";
    case "Idea":
      return "bg-[var(--color-cat-idea)]";
    case "Credential":
      return "bg-[var(--color-cat-credential)]";
    case "Web Content":
      return "bg-[var(--color-cat-web)]";
    case "Personal":
      return "bg-[var(--color-cat-personal)]";
    default:
      return "bg-[var(--color-primary)] dark:bg-[var(--color-primary-dark)]";
  }
}

/* ============================================================
   Modal — unified modal shell
   ============================================================ */

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  size?: "sm" | "md" | "lg" | "xl";
  children: React.ReactNode;
  className?: string;
  /** Disable closing by clicking the overlay */
  disableOverlayClose?: boolean;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  size = "md",
  children,
  className,
  disableOverlayClose = false,
}) => {
  const sizeClasses = {
    sm: "max-w-sm",
    md: "max-w-md",
    lg: "max-w-lg",
    xl: "max-w-xl",
  }[size];

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => !disableOverlayClose && onClose()}
            className="absolute inset-0 bg-[var(--color-text)]/50 dark:bg-black/70 backdrop-blur-md"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.2 }}
            className={cn(
              "relative w-full zk-surface-raised rounded-[var(--radius-2xl)] zk-shadow-xl border zk-border-color",
              sizeClasses,
              className,
            )}
          >
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

interface ModalHeaderProps {
  title: string;
  onClose: () => void;
  icon?: React.ReactNode;
  className?: string;
}

export const ModalHeader: React.FC<ModalHeaderProps> = ({
  title,
  onClose,
  icon,
  className,
}) => (
  <div
    className={cn(
      "flex items-center justify-between px-6 pt-6 pb-4",
      className,
    )}
  >
    <div className="flex items-center gap-2.5">
      {icon}
      <h3
        className="text-[20px] font-extrabold zk-text"
        style={{
          fontFamily: "var(--font-display)",
          letterSpacing: "-0.01em",
        }}
      >
        {title}
      </h3>
    </div>
    <IconButton onClick={onClose} size="sm" tooltip="Close">
      <X className="w-4 h-4" />
    </IconButton>
  </div>
);

interface ModalFooterProps {
  children: React.ReactNode;
  className?: string;
}

export const ModalFooter: React.FC<ModalFooterProps> = ({
  children,
  className,
}) => (
  <div
    className={cn(
      "flex items-center justify-end gap-2 px-6 py-4 border-t zk-border-color",
      className,
    )}
  >
    {children}
  </div>
);

/* ============================================================
   Card — unified card container
   ============================================================ */

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "raised" | "flat" | "outlined";
  interactive?: boolean;
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  (
    { variant = "raised", interactive = false, className, children, ...props },
    ref,
  ) => {
    const variantClasses = {
      raised: "zk-surface-raised zk-shadow-sm",
      flat: "zk-surface-muted",
      outlined: "zk-surface-raised border zk-border-color",
    }[variant];

    return (
      <div
        ref={ref}
        className={cn(
          "rounded-[var(--radius-xl)] relative",
          variantClasses,
          interactive &&
            "cursor-pointer transition-all duration-200 hover:zk-shadow-md hover:-translate-y-0.5",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    );
  },
);
Card.displayName = "Card";

/* ============================================================
   Toggle Switch
   ============================================================ */

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  className?: string;
}

export const Toggle: React.FC<ToggleProps> = ({
  checked,
  onChange,
  label,
  disabled = false,
  className,
}) => (
  <button
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={cn(
      "relative inline-flex w-10 h-5 rounded-full transition-colors zk-focus-ring",
      "disabled:opacity-50 disabled:cursor-not-allowed",
      checked ? "zk-bg-primary" : "zk-surface-sunken",
      className,
    )}
  >
    <motion.span
      animate={{ x: checked ? 20 : 2 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      className="absolute top-1 w-3 h-3 bg-white rounded-full zk-shadow-sm"
    />
  </button>
);
