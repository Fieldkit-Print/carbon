import {
  Button,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  VStack
} from "@carbon/react";
import { useCallback, useState } from "react";
import { LuLoader, LuTruck } from "react-icons/lu";
import { useFetcher } from "react-router";
import { path } from "~/utils/path";

type Rate = {
  id: string;
  carrier: string;
  service: string;
  rate: string;
  currency: string;
  delivery_days: number | null;
  est_delivery_days: number | null;
};

type RateShoppingModalProps = {
  shipmentId: string;
  isOpen: boolean;
  onClose: () => void;
};

const RateShoppingModal = ({
  shipmentId,
  isOpen,
  onClose
}: RateShoppingModalProps) => {
  const ratesFetcher = useFetcher();
  const buyFetcher = useFetcher();
  const [rates, setRates] = useState<Rate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedRateId, setSelectedRateId] = useState<string | null>(null);

  const isLoadingRates = ratesFetcher.state !== "idle";
  const isBuying = buyFetcher.state !== "idle";

  const handleGetRates = useCallback(() => {
    setError(null);
    ratesFetcher.submit(
      { intent: "getRates", shipmentId },
      {
        method: "POST",
        action: path.to.shipmentRates
      }
    );
  }, [ratesFetcher, shipmentId]);

  // Process rates response
  if (ratesFetcher.data && ratesFetcher.state === "idle") {
    const data = ratesFetcher.data as {
      error: { message: string } | null;
      data: { rates: Rate[] } | null;
    };
    if (data.error && !error) {
      setError(data.error.message);
    } else if (data.data?.rates && rates.length === 0) {
      setRates(
        [...data.data.rates].sort(
          (a, b) => Number.parseFloat(a.rate) - Number.parseFloat(b.rate)
        )
      );
    }
  }

  const handleBuyRate = useCallback(() => {
    if (!selectedRateId) return;
    buyFetcher.submit(
      { intent: "buyRate", shipmentId, rateId: selectedRateId },
      {
        method: "POST",
        action: path.to.shipmentRates
      }
    );
    onClose();
  }, [buyFetcher, shipmentId, selectedRateId, onClose]);

  return (
    <Modal open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <ModalContent className="max-w-lg">
        <ModalHeader>
          <ModalTitle className="flex items-center gap-2">
            <LuTruck className="w-5 h-5" />
            Rate Shopping
          </ModalTitle>
          <ModalDescription>
            Compare shipping rates and purchase a label.
          </ModalDescription>
        </ModalHeader>
        <ModalBody>
          {rates.length === 0 && !error && !isLoadingRates && (
            <VStack className="items-center py-8 gap-4">
              <p className="text-sm text-muted-foreground">
                Click below to fetch available shipping rates.
              </p>
              <Button onClick={handleGetRates}>Get Rates</Button>
            </VStack>
          )}

          {isLoadingRates && (
            <VStack className="items-center py-8 gap-2">
              <LuLoader className="w-6 h-6 animate-spin" />
              <p className="text-sm text-muted-foreground">Fetching rates...</p>
            </VStack>
          )}

          {error && (
            <div className="p-4 text-sm text-destructive bg-destructive/10 rounded-md">
              {error}
            </div>
          )}

          {rates.length > 0 && (
            <VStack className="gap-2 max-h-[400px] overflow-y-auto">
              {rates.map((rate) => (
                <button
                  key={rate.id}
                  type="button"
                  className={`w-full text-left p-3 border rounded-md transition-colors ${
                    selectedRateId === rate.id
                      ? "border-primary bg-primary/5"
                      : "hover:bg-muted/50"
                  }`}
                  onClick={() => setSelectedRateId(rate.id)}
                >
                  <HStack className="justify-between">
                    <VStack className="gap-0.5">
                      <span className="font-medium text-sm">
                        {rate.carrier}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {rate.service}
                      </span>
                    </VStack>
                    <VStack className="items-end gap-0.5">
                      <span className="font-semibold">
                        ${Number.parseFloat(rate.rate).toFixed(2)}{" "}
                        {rate.currency}
                      </span>
                      {(rate.delivery_days || rate.est_delivery_days) && (
                        <span className="text-xs text-muted-foreground">
                          {rate.delivery_days || rate.est_delivery_days} days
                        </span>
                      )}
                    </VStack>
                  </HStack>
                </button>
              ))}
            </VStack>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleBuyRate}
            disabled={!selectedRateId || isBuying}
          >
            {isBuying ? "Purchasing..." : "Buy Label"}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default RateShoppingModal;
