// 事業所内 role の日本語表示。OWNER/ADMIN/MEMBER 以外 (将来 role) は素の値を返す。
export const roleLabelJa = (role: string): string => {
  switch (role) {
    case "OWNER":
      return "オーナー";
    case "ADMIN":
      return "管理者";
    case "MEMBER":
      return "メンバー";
    default:
      return role;
  }
};
