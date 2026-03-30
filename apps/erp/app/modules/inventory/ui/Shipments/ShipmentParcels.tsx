import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  IconButton,
  NumberField,
  NumberInput,
  useDisclosure,
  VStack
} from "@carbon/react";
import { useCallback, useState } from "react";
import { LuPackage, LuPlus, LuTrash } from "react-icons/lu";
import { useFetcher, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { Shipment } from "~/modules/inventory";
import { path } from "~/utils/path";

type Parcel = {
  id: string;
  shipmentId: string;
  length: number;
  width: number;
  height: number;
  weight: number;
  predefinedPackage: string | null;
};

const ShipmentParcels = () => {
  const { shipmentId } = useParams();
  if (!shipmentId) throw new Error("shipmentId not found");

  const routeData = useRouteData<{
    shipment: Shipment;
    parcels: Parcel[];
  }>(path.to.shipment(shipmentId));

  const parcels = routeData?.parcels ?? [];
  const isPosted = routeData?.shipment?.status === "Posted";

  return (
    <Card>
      <CardHeader>
        <HStack className="justify-between w-full">
          <CardTitle className="flex items-center gap-2">
            <LuPackage className="w-4 h-4" />
            Packages
          </CardTitle>
          {!isPosted && <AddParcelButton shipmentId={shipmentId} />}
        </HStack>
      </CardHeader>
      <CardContent>
        {parcels.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No packages added. Add a package to enable rate shopping.
          </p>
        ) : (
          <VStack className="gap-2">
            {parcels.map((parcel) => (
              <ParcelRow key={parcel.id} parcel={parcel} disabled={isPosted} />
            ))}
          </VStack>
        )}
      </CardContent>
    </Card>
  );
};

function AddParcelButton({ shipmentId }: { shipmentId: string }) {
  const fetcher = useFetcher();
  const [length, setLength] = useState(0);
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);
  const [weight, setWeight] = useState(0);
  const { isOpen, onOpen, onClose } = useDisclosure();

  const handleSubmit = useCallback(() => {
    fetcher.submit(
      {
        intent: "upsert",
        shipmentId,
        length: String(length),
        width: String(width),
        height: String(height),
        weight: String(weight)
      },
      { method: "POST", action: path.to.shipmentParcels }
    );
    onClose();
    setLength(0);
    setWidth(0);
    setHeight(0);
    setWeight(0);
  }, [fetcher, shipmentId, length, width, height, weight, onClose]);

  return (
    <>
      <Button variant="secondary" size="sm" onClick={onOpen}>
        <LuPlus className="w-4 h-4 mr-1" />
        Add Package
      </Button>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-[400px]">
            <CardHeader>
              <CardTitle>Add Package</CardTitle>
            </CardHeader>
            <CardContent>
              <VStack className="gap-4">
                <div className="grid grid-cols-3 gap-2">
                  <NumberField>
                    <label className="text-sm font-medium">Length (in)</label>
                    <NumberInput
                      value={length}
                      onChange={(v) => setLength(Number(v))}
                    />
                  </NumberField>
                  <NumberField>
                    <label className="text-sm font-medium">Width (in)</label>
                    <NumberInput
                      value={width}
                      onChange={(v) => setWidth(Number(v))}
                    />
                  </NumberField>
                  <NumberField>
                    <label className="text-sm font-medium">Height (in)</label>
                    <NumberInput
                      value={height}
                      onChange={(v) => setHeight(Number(v))}
                    />
                  </NumberField>
                </div>
                <NumberField>
                  <label className="text-sm font-medium">Weight (oz)</label>
                  <NumberInput
                    value={weight}
                    onChange={(v) => setWeight(Number(v))}
                  />
                </NumberField>
                <HStack className="justify-end gap-2">
                  <Button variant="ghost" onClick={onClose}>
                    Cancel
                  </Button>
                  <Button onClick={handleSubmit}>Add Package</Button>
                </HStack>
              </VStack>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}

function ParcelRow({
  parcel,
  disabled
}: {
  parcel: Parcel;
  disabled: boolean;
}) {
  const fetcher = useFetcher();

  const handleDelete = useCallback(() => {
    fetcher.submit(
      { intent: "delete", parcelId: parcel.id },
      { method: "POST", action: path.to.shipmentParcels }
    );
  }, [fetcher, parcel.id]);

  return (
    <div className="flex items-center justify-between p-3 border rounded-md">
      <div className="flex items-center gap-4 text-sm">
        <LuPackage className="w-4 h-4 text-muted-foreground" />
        <span>
          {parcel.length}" x {parcel.width}" x {parcel.height}"
        </span>
        <span className="text-muted-foreground">{parcel.weight} oz</span>
        {parcel.predefinedPackage && (
          <span className="text-xs bg-muted px-2 py-0.5 rounded">
            {parcel.predefinedPackage}
          </span>
        )}
      </div>
      {!disabled && (
        <IconButton
          aria-label="Delete package"
          variant="ghost"
          size="sm"
          onClick={handleDelete}
          icon={<LuTrash className="w-4 h-4" />}
        />
      )}
    </div>
  );
}

export default ShipmentParcels;
