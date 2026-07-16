import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@erve/primitives";
import {
  THEME_MODE_ICON_BY_VALUE,
  THEME_MODE_LABEL_BY_VALUE,
  THEME_MODE_OPTIONS,
  type ThemeModeControlValue,
} from "./theme-mode-options.js";

export type { ThemeModeControlValue };

export interface ThemeModeControlProps {
  value: ThemeModeControlValue;
  onValueChange: (value: ThemeModeControlValue) => void;
  disabled?: boolean;
  /**
   * Optional caption shown under "Use device setting" (e.g. "Currently
   * dark"). Lets a connected wrapper surface `resolvedTheme` without this
   * component reading theme context itself.
   */
  systemCaption?: string;
  className?: string;
}

/**
 * Compact icon-button trigger that opens a small anchored popover — the
 * right fit next to a desktop "Log out" button. On narrow/touch viewports
 * prefer `ThemeModeRadioList` (an inline, always-visible sibling built on
 * the same `THEME_MODE_OPTIONS`) inside a sheet/menu instead of nesting this
 * popover inside another one.
 */
export function ThemeModeControl({
  value,
  onValueChange,
  disabled = false,
  systemCaption,
  className,
}: ThemeModeControlProps) {
  const ActiveIcon = THEME_MODE_ICON_BY_VALUE[value];
  const activeLabel = THEME_MODE_LABEL_BY_VALUE[value];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          title={`Theme: ${activeLabel}`}
          aria-label={`Theme: ${activeLabel}`}
          className={cn(
            "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-foreground transition-colors",
            "hover:bg-surface-muted",
            "focus-visible:outline-hidden focus-visible:ring-[length:var(--erp-focus-ring-width)] focus-visible:ring-[var(--erp-focus-ring)] focus-visible:ring-offset-[var(--erp-focus-ring-offset)]",
            "disabled:pointer-events-none disabled:opacity-[var(--erp-disabled-opacity)]",
            className,
          )}
        >
          <ActiveIcon className="h-[18px] w-[18px]" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" aria-label="Theme">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => onValueChange(next as ThemeModeControlValue)}
        >
          {THEME_MODE_OPTIONS.map(({ value: optionValue, label, Icon }) => (
            <DropdownMenuRadioItem
              key={optionValue}
              id={`theme-mode-${optionValue}`}
              value={optionValue}
              disabled={disabled}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="flex flex-col">
                <span>{label}</span>
                {optionValue === "system" && systemCaption && (
                  <span className="text-xs text-muted-foreground">{systemCaption}</span>
                )}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

ThemeModeControl.displayName = "ThemeModeControl";
