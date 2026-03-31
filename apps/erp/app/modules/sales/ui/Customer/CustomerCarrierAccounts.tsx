import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  useDisclosure,
  VStack
} from "@carbon/react";
import { useCallback, useState } from "react";
import { LuPlus, LuTrash, LuTruck } from "react-icons/lu";
import { useFetcher } from "react-router";
import { usePermissions } from "~/hooks";

const carriers = ["UPS", "FedEx", "USPS", "DHL", "Other"] as const;

type CarrierAccount = {
  id: string;
  carrier: string;
  accountNumber: string;
  description: string | null;
};

type CustomerCarrierAccountsProps = {
  carrierAccounts: CarrierAccount[];
  customerId: string;
};

const CustomerCarrierAccounts = ({
  carrierAccounts,
  customerId
}: CustomerCarrierAccountsProps) => {
  const permissions = usePermissions();
  const deleteFetcher = useFetcher();
  const canUpdate = permissions.can("update", "sales");
  const addModal = useDisclosure();

  return (
    <>
      <Card>
        <CardHeader>
          <HStack className="justify-between w-full">
            <CardTitle>Carrier Accounts</CardTitle>
            {canUpdate && (
              <Button variant="secondary" size="sm" onClick={addModal.onOpen}>
                <HStack spacing={2}>
                  <LuPlus className="h-4 w-4" />
                  <span>Add Account</span>
                </HStack>
              </Button>
            )}
          </HStack>
        </CardHeader>
        <CardContent>
          {carrierAccounts.length === 0 ? (
            <VStack spacing={4} className="py-8 text-center">
              <LuTruck className="mx-auto h-12 w-12 text-muted-foreground" />
              <p className="text-muted-foreground">
                No carrier accounts for this customer.
              </p>
              <p className="text-muted-foreground text-sm">
                Add a carrier account when the customer wants shipments billed
                to their own shipping account.
              </p>
            </VStack>
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th>Carrier</Th>
                  <Th>Account Number</Th>
                  <Th>Description</Th>
                  {canUpdate && <Th className="text-right">Actions</Th>}
                </Tr>
              </Thead>
              <Tbody>
                {carrierAccounts.map((account) => (
                  <Tr key={account.id}>
                    <Td>{account.carrier}</Td>
                    <Td className="font-mono">{account.accountNumber}</Td>
                    <Td>{account.description ?? ""}</Td>
                    {canUpdate && (
                      <Td className="text-right">
                        <deleteFetcher.Form method="post">
                          <input type="hidden" name="type" value="delete" />
                          <input
                            type="hidden"
                            name="carrierAccountId"
                            value={account.id}
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
                      </Td>
                    )}
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )}
        </CardContent>
      </Card>

      {addModal.isOpen && (
        <AddCarrierAccountModal
          customerId={customerId}
          onClose={addModal.onClose}
        />
      )}
    </>
  );
};

function AddCarrierAccountModal({
  customerId,
  onClose
}: {
  customerId: string;
  onClose: () => void;
}) {
  const fetcher = useFetcher();
  const [carrier, setCarrier] = useState<string>("UPS");
  const [accountNumber, setAccountNumber] = useState("");
  const [description, setDescription] = useState("");

  const handleSubmit = useCallback(() => {
    if (!accountNumber.trim()) return;
    fetcher.submit(
      {
        type: "create",
        customerId,
        carrier,
        accountNumber: accountNumber.trim(),
        description: description.trim()
      },
      { method: "POST" }
    );
    onClose();
  }, [fetcher, customerId, carrier, accountNumber, description, onClose]);

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Add Carrier Account</ModalTitle>
        </ModalHeader>
        <ModalBody>
          <VStack className="gap-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">
                Carrier
              </label>
              <Select value={carrier} onValueChange={setCarrier}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {carriers.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">
                Account Number
              </label>
              <Input
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
                placeholder="e.g. 1Z999AA10123456784"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">
                Description
              </label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Main warehouse account"
              />
            </div>
          </VStack>
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!accountNumber.trim()}>
            Add Account
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

export default CustomerCarrierAccounts;
