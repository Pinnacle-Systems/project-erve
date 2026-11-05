import { TextField } from '@erve/primitives';

export type TransportFieldsValue = { transporter: string; vehicleNumber: string; lrNumber: string };

export function TransportFields({
  value,
  onChange,
  disabled,
}: {
  value: TransportFieldsValue;
  onChange: (field: keyof TransportFieldsValue, value: string) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset disabled={disabled} className="flex flex-wrap gap-3">
      <TextField
        label="Transporter"
        name="transporter"
        maxLength={200}
        value={value.transporter}
        onChange={(event) => onChange('transporter', event.target.value)}
      />
      <TextField
        label="Vehicle Number"
        name="vehicleNumber"
        maxLength={100}
        value={value.vehicleNumber}
        onChange={(event) => onChange('vehicleNumber', event.target.value)}
      />
      <TextField
        label="LR Number"
        name="lrNumber"
        maxLength={100}
        value={value.lrNumber}
        onChange={(event) => onChange('lrNumber', event.target.value)}
      />
    </fieldset>
  );
}
