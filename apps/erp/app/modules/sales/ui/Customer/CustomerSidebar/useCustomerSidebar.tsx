import {
  LuBuilding,
  LuContact,
  LuCreditCard,
  LuMapPin,
  LuPackage,
  LuShieldAlert,
  LuTruck,
  LuWallet
} from "react-icons/lu";
import {
  RiProgress2Line,
  RiProgress4Line,
  RiProgress8Line
} from "react-icons/ri";
import { useParams } from "react-router";
import { usePermissions } from "~/hooks";
import type { Role } from "~/types";
import { path } from "~/utils/path";

type Props = {
  contacts: number;
  locations: number;
};

export function useCustomerSidebar({ contacts, locations }: Props) {
  const permissions = usePermissions();
  const { customerId } = useParams();
  if (!customerId) throw new Error("customerId not found");
  return [
    {
      name: "Details",
      to: path.to.customerDetails(customerId),
      icon: <LuBuilding />,
      shortcut: "Command+Shift+d"
    },
    {
      name: "Contacts",
      to: path.to.customerContacts(customerId),
      role: ["employee"],
      count: contacts,
      icon: <LuContact />,
      shortcut: "Command+Shift+c"
    },
    {
      name: "Locations",
      to: path.to.customerLocations(customerId),
      role: ["employee", "customer"],
      count: locations,
      icon: <LuMapPin />,
      shortcut: "Command+Shift+l"
    },
    {
      name: "Payment",
      to: path.to.customerPayment(customerId),
      role: ["employee"],
      icon: <LuCreditCard />,
      shortcut: "Command+Shift+p"
    },
    {
      name: "Cards on File",
      to: path.to.customerCards(customerId),
      role: ["employee"],
      icon: <LuWallet />
    },
    {
      name: "Shipping",
      to: path.to.customerShipping(customerId),
      role: ["employee"],
      icon: <LuTruck />,
      shortcut: "Command+Shift+s"
    },
    {
      name: "Carrier Accounts",
      to: path.to.customerCarrierAccounts(customerId),
      role: ["employee"],
      icon: <LuPackage />
    },
    {
      name: "Risks",
      to: path.to.customerRisks(customerId),
      role: ["employee"],
      icon: <LuShieldAlert />
    },
    {
      name: "RFQs",
      to: `${path.to.salesRfqs}?filter=customerId:eq:${customerId}`,
      role: ["employee"],
      icon: <RiProgress2Line />
    },
    {
      name: "Quotes",
      to: `${path.to.quotes}?filter=customerId:eq:${customerId}`,
      role: ["employee"],
      icon: <RiProgress4Line />
    },
    {
      name: "Orders",
      to: `${path.to.salesOrders}?filter=customerId:eq:${customerId}`,
      role: ["employee"],
      icon: <RiProgress8Line />
    },
    {
      name: "Invoices",
      to: `${path.to.salesInvoices}?filter=customerId:eq:${customerId}`,
      icon: <LuCreditCard />
    }
    // {
    //   name: "Accounting",
    //   to: path.to.customerAccounting(customerId),
    //   role: ["employee"],
    //   icon: <LuLandmark />,
    //   shortcut: "Command+Shift+a",
    // },
  ].filter(
    (item) =>
      item.role === undefined ||
      item.role.some((role) => permissions.is(role as Role))
  );
}
