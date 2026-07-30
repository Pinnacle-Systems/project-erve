import { PasswordField as PrimitivePasswordField, type TextFieldWidth } from '@erve/primitives';

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
  const fieldId = id ?? `password-${label.toLowerCase().replace(/\s+/g, '-')}`;

  return (
    <PrimitivePasswordField
      id={fieldId}
      label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      errorMessage={errorMessage}
      helpText={helpText}
      width={width}
      autoComplete={autoComplete}
    />
  );
}
