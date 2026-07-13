import { Radio, RadioGroup } from "@erve/primitives";

/**
 * Mirrors `@erve/theme`'s `ThemeMode` by convention, not by import.
 * Design-system packages below `@erve/theme` in the dependency graph
 * intentionally have no package dependency on it — they consume `--erp-*`
 * CSS variables only. `apps/web`'s `ThemeModeMenu` is the connected wrapper
 * that imports the real type and binds it to `useTheme()`.
 */
export type ThemeModeControlValue = "light" | "dark" | "system";

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

const OPTIONS: ReadonlyArray<{ value: ThemeModeControlValue; label: string }> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "Use device setting" },
];

export function ThemeModeControl({
  value,
  onValueChange,
  disabled = false,
  systemCaption,
  className,
}: ThemeModeControlProps) {
  return (
    <RadioGroup
      label="Theme"
      aria-label="Theme"
      className={className}
      value={value}
      onValueChange={(next) => onValueChange(next as ThemeModeControlValue)}
    >
      {OPTIONS.map((option) => (
        <Radio
          key={option.value}
          id={`theme-mode-${option.value}`}
          value={option.value}
          disabled={disabled}
          label={option.label}
          description={option.value === "system" ? systemCaption : undefined}
        />
      ))}
    </RadioGroup>
  );
}

ThemeModeControl.displayName = "ThemeModeControl";
