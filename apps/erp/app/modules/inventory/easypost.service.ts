import type { Database } from "@carbon/database";
import EasyPostApi from "@easypost/api";
import type { SupabaseClient } from "@supabase/supabase-js";

type Client = SupabaseClient<Database>;

async function getEasyPostClient(client: Client, companyId: string) {
  const { data } = await client
    .from("companyIntegration")
    .select("*")
    .eq("companyId", companyId)
    .eq("id", "easypost")
    .limit(1);

  const integration = data?.[0];
  if (!integration) {
    throw new Error("EasyPost integration not found for company");
  }

  const metadata = integration.metadata as {
    apiKey: string;
    testApiKey?: string;
    webhookSecret?: string;
  };

  if (!metadata.apiKey) {
    throw new Error("EasyPost API key not configured");
  }

  return new EasyPostApi(metadata.apiKey);
}

export async function getShipmentParcels(client: Client, shipmentId: string) {
  return client
    .from("parcel")
    .select("*")
    .eq("shipmentId", shipmentId)
    .order("createdAt");
}

export async function upsertParcel(
  client: Client,
  parcel:
    | {
        shipmentId: string;
        length: number;
        width: number;
        height: number;
        weight: number;
        predefinedPackage?: string | null;
        companyId: string;
        createdBy: string;
      }
    | {
        id: string;
        shipmentId: string;
        length: number;
        width: number;
        height: number;
        weight: number;
        predefinedPackage?: string | null;
        updatedBy: string;
      }
) {
  if ("id" in parcel) {
    return client
      .from("parcel")
      .update({
        length: parcel.length,
        width: parcel.width,
        height: parcel.height,
        weight: parcel.weight,
        predefinedPackage: parcel.predefinedPackage,
        updatedBy: parcel.updatedBy,
        updatedAt: new Date().toISOString()
      })
      .eq("id", parcel.id)
      .select("id")
      .single();
  }

  return client.from("parcel").insert(parcel).select("id").single();
}

export async function deleteParcel(client: Client, parcelId: string) {
  return client.from("parcel").delete().eq("id", parcelId);
}

export async function getRates(
  client: Client,
  companyId: string,
  shipmentId: string
) {
  const easypost = await getEasyPostClient(client, companyId);

  // Get shipment with location (ship-from) and customer address (ship-to)
  const { data: shipment } = await client
    .from("shipment")
    .select(
      `
      *,
      location:locationId(
        addressLine1,
        addressLine2,
        city,
        stateProvince,
        postalCode,
        countryCode
      ),
      customer:customerId(
        name
      )
    `
    )
    .eq("id", shipmentId)
    .single();

  if (!shipment) {
    throw new Error("Shipment not found");
  }

  // Get parcels
  const { data: parcels } = await getShipmentParcels(client, shipmentId);
  if (!parcels?.length) {
    throw new Error(
      "No parcels on shipment. Add at least one parcel to get rates."
    );
  }

  const location = shipment.location as {
    addressLine1: string;
    addressLine2: string | null;
    city: string;
    stateProvince: string;
    postalCode: string;
    countryCode: string | null;
  } | null;

  if (!location) {
    throw new Error(
      "Shipment must have a location (ship-from address) to get rates."
    );
  }

  // Get customer address for ship-to
  const { data: customerAddress } = await client
    .from("address")
    .select("*")
    .eq("customerId", shipment.customerId ?? "")
    .limit(1)
    .maybeSingle();

  if (!customerAddress) {
    throw new Error(
      "Customer has no address. Add a shipping address to get rates."
    );
  }

  const fromAddress = {
    street1: location.addressLine1,
    street2: location.addressLine2 ?? undefined,
    city: location.city,
    state: location.stateProvince,
    zip: location.postalCode,
    country: location.countryCode ?? "US"
  };

  const toAddress = {
    street1: customerAddress.addressLine1 ?? "",
    street2: customerAddress.addressLine2 ?? undefined,
    city: customerAddress.city ?? "",
    state: customerAddress.stateProvince ?? "",
    zip: customerAddress.postalCode ?? "",
    country: customerAddress.countryCode ?? "US"
  };

  const easypostParcels = parcels.map((p) => ({
    length: Number(p.length),
    width: Number(p.width),
    height: Number(p.height),
    weight: Number(p.weight),
    ...(p.predefinedPackage ? { predefined_package: p.predefinedPackage } : {})
  }));

  // Create EasyPost shipment to get rates
  const easypostShipment = await easypost.Shipment.create({
    from_address: fromAddress,
    to_address: toAddress,
    parcel: easypostParcels[0] // EasyPost uses single parcel per shipment
  });

  // Store EasyPost shipment ID for later purchase
  await client
    .from("shipment")
    .update({ easypostShipmentId: easypostShipment.id })
    .eq("id", shipmentId);

  return easypostShipment.rates;
}

export async function buyRate(
  client: Client,
  companyId: string,
  shipmentId: string,
  rateId: string
) {
  const easypost = await getEasyPostClient(client, companyId);

  const { data: shipment } = await client
    .from("shipment")
    .select("easypostShipmentId")
    .eq("id", shipmentId)
    .single();

  if (!shipment?.easypostShipmentId) {
    throw new Error("No EasyPost shipment found. Get rates first.");
  }

  const easypostShipment = await easypost.Shipment.retrieve(
    shipment.easypostShipmentId
  );

  const purchased = await easypost.Shipment.buy(easypostShipment.id, rateId);

  // Update shipment with label and tracking info
  await client
    .from("shipment")
    .update({
      trackingNumber: purchased.tracking_code,
      labelUrl: purchased.postage_label?.label_url,
      labelFormat: purchased.postage_label?.label_file_type,
      selectedRate: JSON.parse(JSON.stringify(purchased.selected_rate ?? null)),
      easypostTrackerId: purchased.tracker?.id,
      trackingStatus: purchased.tracker?.status
    })
    .eq("id", shipmentId);

  return {
    trackingNumber: purchased.tracking_code,
    labelUrl: purchased.postage_label?.label_url,
    labelFormat: purchased.postage_label?.label_file_type,
    carrier: purchased.selected_rate?.carrier,
    service: purchased.selected_rate?.service
  };
}

export async function createTracker(
  client: Client,
  companyId: string,
  shipmentId: string
) {
  const easypost = await getEasyPostClient(client, companyId);

  const { data: shipment } = await client
    .from("shipment")
    .select("trackingNumber, shippingMethodId")
    .eq("id", shipmentId)
    .single();

  if (!shipment?.trackingNumber) {
    throw new Error("Shipment has no tracking number");
  }

  // Get carrier from shipping method if available
  let carrier: string | undefined;
  if (shipment.shippingMethodId) {
    const { data: method } = await client
      .from("shippingMethod")
      .select("carrier, easypostCarrier")
      .eq("id", shipment.shippingMethodId)
      .single();

    carrier = method?.easypostCarrier ?? method?.carrier ?? undefined;
  }

  const tracker = await easypost.Tracker.create({
    tracking_code: shipment.trackingNumber,
    carrier
  });

  await client
    .from("shipment")
    .update({
      easypostTrackerId: tracker.id,
      trackingStatus: tracker.status,
      estimatedDeliveryDate: tracker.est_delivery_date
    })
    .eq("id", shipmentId);

  return tracker;
}

export async function voidLabel(
  client: Client,
  companyId: string,
  shipmentId: string
) {
  const easypost = await getEasyPostClient(client, companyId);

  const { data: shipment } = await client
    .from("shipment")
    .select("easypostShipmentId")
    .eq("id", shipmentId)
    .single();

  if (!shipment?.easypostShipmentId) {
    throw new Error("No EasyPost shipment found to void");
  }

  await easypost.Shipment.retrieve(shipment.easypostShipmentId);
  const refund = await easypost.Refund.create({
    carrier: undefined,
    tracking_codes: []
  });

  // Clear label info from shipment
  await client
    .from("shipment")
    .update({
      labelUrl: null,
      labelFormat: null,
      selectedRate: null,
      easypostShipmentId: null
    })
    .eq("id", shipmentId);

  return refund;
}
