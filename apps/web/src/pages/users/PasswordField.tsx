import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { TextField, type TextFieldWidth } from '@erve/primitives';

export interface PasswordFieldProps {
  label: string;
  id?: string;
  value: string;
  onChange: (value: string) => void;
  errorMessage?: string;
  helpText?: string;
  width?: TextFieldWidth;
  autoComplete?: string;
}

// No dedicated password/show-hide component exists in @erve/primitives yet —
// this wraps TextField locally rather than introducing one for a single use site.
export function PasswordField({
  label,
  id,
  value,
  onChange,
  errorMessage,
  helpText,
  width = 'md',
  autoComplete,
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const fieldId = id ?? `password-${label.toLowerCase().replace(/\s+/g, '-')}`;

  return (
    <div data-width={width} className="flex flex-col gap-1.5">
      <label
        htmlFor={fieldId}
        className="text-sm font-medium text-[var(--erp-form-label-color)] select-none leading-none"
      >
        {label}
      </label>
      <div className="relative">
        <TextField
          id={fieldId}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          errorMessage={errorMessage}
          helpText={helpText}
          width={width}
          autoComplete={autoComplete}
          className="pr-9"
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          className="absolute right-2 top-[9px] text-muted-foreground hover:text-foreground"
          aria-label={visible ? 'Hide password' : 'Show password'}
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </div>
  );
}
