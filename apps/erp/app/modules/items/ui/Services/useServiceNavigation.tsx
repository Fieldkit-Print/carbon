import { LuFileText } from "react-icons/lu";
import { useParams } from "react-router";
import { usePermissions } from "~/hooks";
import type { Role } from "~/types";
import { path } from "~/utils/path";

export function useServiceNavigation() {
  const permissions = usePermissions();
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId not found");

  return [
    {
      name: "Details",
      to: path.to.serviceDetails(itemId),
      icon: LuFileText,
      shortcut: "Command+Shift+d"
    }
  ].filter(
    (item: {
      name: string;
      to: string;
      icon: typeof LuFileText;
      shortcut: string;
      isDisabled?: boolean;
      role?: string[];
      permission?: string;
    }) =>
      !item.isDisabled &&
      (item.role === undefined ||
        item.role.some((role) => permissions.is(role as Role))) &&
      (item.permission === undefined ||
        permissions.can("view", item.permission))
  );
}
