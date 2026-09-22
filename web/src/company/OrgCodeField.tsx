import { orgCodeLabelJa, type OrgCode } from "@core/company/org-code";

export const OrgCodeField = ({
  value,
  onChange,
  disabled,
  name,
  order = ["PERSONAL", "CORPORATE"],
}: {
  value: OrgCode;
  onChange: (next: OrgCode) => void;
  disabled?: boolean;
  // 同じページに複数のフォームがあっても radio group が混ざらないよう、呼び出し側が一意な値を付ける
  name: string;
  order?: readonly OrgCode[];
}) => (
  <fieldset className="space-y-2">
    <legend className="text-sm font-medium">事業形態</legend>
    {order.map((code) => (
      <label key={code} className="flex items-center gap-2 text-sm">
        <input
          type="radio"
          name={name}
          value={code}
          checked={value === code}
          onChange={() => onChange(code)}
          disabled={disabled}
        />
        {orgCodeLabelJa(code)}
      </label>
    ))}
  </fieldset>
);
