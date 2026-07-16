import { Radio, RadioGroup } from "@erve/primitives";
import { THEME_MODE_OPTIONS, type ThemeModeControlValue } from "./theme-mode-options.js";

export type { ThemeModeControlValue };

export interface ThemeModeRadioListProps {
  value: ThemeModeControlValue;
  onValueChange: (value: ThemeModeControlValue) => void;
  disabled?: boolean;
  /** Optional caption shown under "Use device setting" (e.g. "Currently dark"). */
  systemCaption?: string;
  className?: string;
}

/**
 * Inline, always-visible sibling of `ThemeModeControl` for contexts (e.g. a
 * mobile bottom sheet) where a second floating popover stacked on top of an
 * already-open sheet is poor touch UX. Same options/icons/values — built on
 * the same `THEME_MODE_OPTIONS` — so there's one source of truth for the
 * available theme modes regardless of which container renders them.
 */
export function ThemeModeRadioList({
  value,
  onValueChange,
  disabled = false,
  systemCaption,
  className,
}: ThemeModeRadioListProps) {
  return (
    <RadioGroup
      aria-label="Theme"
      className={className}
      value={value}
      onValueChange={(next) => onValueChange(next as ThemeModeControlValue)}
    >
      {THEME_MODE_OPTIONS.map(({ value: optionValue, label, Icon }) => (
        <div key={optionValue} className="flex min-h-11 items-center">
          <Radio
            id={`theme-mode-${optionValue}`}
            value={optionValue}
            disabled={disabled}
            density="touch"
            label={
              <span className="flex items-center gap-2">
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                {label}
              </span>
            }
            description={optionValue === "system" ? systemCaption : undefined}
          />
        </div>
      ))}
    </RadioGroup>
  );
}

ThemeModeRadioList.displayName = "ThemeModeRadioList";
