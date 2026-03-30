import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  VStack
} from "@carbon/react";
import { LuCreditCard, LuSend, LuTrash } from "react-icons/lu";
import { useFetcher } from "react-router";
import { usePermissions } from "~/hooks";

type PaymentMethod = {
  id: string;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
};

type CustomerCardsOnFileProps = {
  paymentMethods: PaymentMethod[];
  customerId: string;
  hasStripeCustomer: boolean;
};

function formatBrand(brand: string | null) {
  if (!brand) return "Card";
  return brand.charAt(0).toUpperCase() + brand.slice(1);
}

const CustomerCardsOnFile = ({
  paymentMethods,
  customerId,
  hasStripeCustomer
}: CustomerCardsOnFileProps) => {
  const permissions = usePermissions();
  const deleteFetcher = useFetcher();
  const sendLinkFetcher = useFetcher();
  const canUpdate = permissions.can("update", "sales");

  return (
    <Card>
      <CardHeader>
        <HStack className="justify-between w-full">
          <CardTitle>Cards on File</CardTitle>
          {canUpdate && (
            <sendLinkFetcher.Form method="post">
              <input type="hidden" name="type" value="sendAddCardLink" />
              <Button
                type="submit"
                variant="secondary"
                size="sm"
                isDisabled={sendLinkFetcher.state !== "idle"}
              >
                <HStack spacing={2}>
                  <LuSend className="h-4 w-4" />
                  <span>
                    {sendLinkFetcher.state !== "idle"
                      ? "Sending..."
                      : "Send Add Card Link"}
                  </span>
                </HStack>
              </Button>
            </sendLinkFetcher.Form>
          )}
        </HStack>
      </CardHeader>
      <CardContent>
        {paymentMethods.length === 0 ? (
          <VStack spacing={4} className="py-8 text-center">
            <LuCreditCard className="mx-auto h-12 w-12 text-muted-foreground" />
            <p className="text-muted-foreground">
              No cards on file for this customer.
            </p>
            <p className="text-muted-foreground text-sm">
              Send a link to the customer to add their card, or they can save a
              card when paying an invoice.
            </p>
          </VStack>
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>Card</Th>
                <Th>Number</Th>
                <Th>Expires</Th>
                <Th className="text-right">Actions</Th>
              </Tr>
            </Thead>
            <Tbody>
              {paymentMethods.map((pm) => (
                <Tr key={pm.id}>
                  <Td>{formatBrand(pm.brand)}</Td>
                  <Td>•••• {pm.last4}</Td>
                  <Td>
                    {pm.expMonth}/{pm.expYear}
                  </Td>
                  <Td className="text-right">
                    {canUpdate && (
                      <deleteFetcher.Form method="post">
                        <input type="hidden" name="type" value="detach" />
                        <input
                          type="hidden"
                          name="paymentMethodId"
                          value={pm.id}
                        />
                        <Button
                          type="submit"
                          variant="ghost"
                          size="sm"
                          isDisabled={deleteFetcher.state !== "idle"}
                        >
                          <LuTrash className="h-4 w-4" />
                        </Button>
                      </deleteFetcher.Form>
                    )}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
};

export default CustomerCardsOnFile;
