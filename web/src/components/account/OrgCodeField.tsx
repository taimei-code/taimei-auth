import type { OrgCode } from "@/lib/account-api";
import { orgCodeLabelJa } from "@/lib/labels";

// 事業形態 (個人事業主 / 法人) の radio fieldset。signup / 事業所追加 / 事業所設定の 3 画面が
// 同一 markup を保ち、第 3 の事業形態を足す時の追随を 1 箇所にする。
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
  // 同一ページ内に複数フォームが共存しても radio group が混線しないよう呼び出し側が一意に付ける
  name: string;
  // 既定値を先頭に見せたい画面 (事業所追加は法人が既定) 向けの表示順
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
