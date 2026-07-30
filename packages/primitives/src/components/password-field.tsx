import { forwardRef, useState } from "react";
import { TextField, type TextFieldProps } from "./text-field";

export type PasswordFieldProps = Omit<TextFieldProps, "type" | "endAdornment">;

function EyeIcon({ hidden }: { hidden: boolean }) {
  return hidden ? (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      <path d="m2 2 20 20" />
      <path d="M6.71 6.71C4.96 7.9 3.38 9.68 2 12c2.4 4 5.73 6 10 6 1.37 0 2.63-.21 3.77-.62" />
      <path d="M10.73 5.08C11.14 5.03 11.56 5 12 5c4.27 0 7.6 2 10 6a16.1 16.1 0 0 1-2.32 3.09" />
      <path d="M14.12 14.12a3 3 0 0 1-4.24-4.24" />
    </svg>
  ) : (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(
  ({ className, disabled, ...props }, ref) => {
    const [visible, setVisible] = useState(false);
    const actionLabel = visible ? "Hide password" : "Show password";

    return (
      <TextField
        ref={ref}
        {...props}
        disabled={disabled}
        type={visible ? "text" : "password"}
        className={[className, "pr-11"].filter(Boolean).join(" ")}
        endAdornment={
          <button
            type="button"
            disabled={disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setVisible((current) => !current)}
            aria-label={actionLabel}
            aria-pressed={visible}
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-control text-muted-foreground transition-colors hover:text-foreground focus:outline-hidden focus-visible:ring-[length:var(--erp-focus-ring-width)] focus-visible:ring-[var(--erp-focus-ring)] disabled:pointer-events-none disabled:opacity-[var(--erp-disabled-opacity)]"
          >
            <EyeIcon hidden={visible} />
          </button>
        }
      />
    );
  },
);

PasswordField.displayName = "PasswordField";
