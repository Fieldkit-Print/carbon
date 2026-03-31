import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  VStack
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Events",
  to: ""
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "inventory"
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const events = await client
    .from("customerAssetEvent")
    .select("*, createdByUser:createdBy(fullName)")
    .eq("itemId", itemId)
    .order("eventDate", { ascending: false });

  if (events.error) {
    throw redirect(
      path.to.part(itemId),
      await flash(request, error(events.error, "Failed to load events"))
    );
  }

  return {
    events: events.data ?? []
  };
}

type AssetEvent = {
  id: string;
  eventType: string;
  eventDate: string;
  sourceDocument: string | null;
  sourceDocumentId: string | null;
  destination: string | null;
  notes: string | null;
  createdByUser: { fullName: string } | null;
};

const eventTypeColors: Record<string, string> = {
  Received: "bg-green-100 text-green-800",
  "Shipped Out": "bg-blue-100 text-blue-800",
  Returned: "bg-green-100 text-green-800",
  "Maintenance Started": "bg-yellow-100 text-yellow-800",
  "Maintenance Completed": "bg-green-100 text-green-800",
  "Location Changed": "bg-gray-100 text-gray-800",
  Retired: "bg-red-100 text-red-800"
};

export default function PartEventsRoute() {
  const { events } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={2} className="p-2">
      <Card>
        <CardHeader>
          <CardTitle>Asset Event History</CardTitle>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">
              No events recorded for this asset.
            </p>
          ) : (
            <VStack spacing={3}>
              {(events as AssetEvent[]).map((event) => (
                <div
                  key={event.id}
                  className="flex items-start gap-3 border-b border-border pb-3 last:border-0"
                >
                  <div className="flex-shrink-0 pt-0.5">
                    <Badge
                      className={
                        eventTypeColors[event.eventType] ??
                        "bg-gray-100 text-gray-800"
                      }
                    >
                      {event.eventType}
                    </Badge>
                  </div>
                  <VStack spacing={0} className="flex-grow min-w-0">
                    <HStack className="text-sm">
                      <span className="text-muted-foreground">
                        {formatDate(event.eventDate)}
                      </span>
                      {event.createdByUser?.fullName && (
                        <span className="text-muted-foreground">
                          by {event.createdByUser.fullName}
                        </span>
                      )}
                    </HStack>
                    {event.destination && (
                      <p className="text-sm">
                        Destination: {event.destination}
                      </p>
                    )}
                    {event.sourceDocument && (
                      <p className="text-sm text-muted-foreground">
                        {event.sourceDocument}
                        {event.sourceDocumentId
                          ? `: ${event.sourceDocumentId}`
                          : ""}
                      </p>
                    )}
                    {event.notes && (
                      <p className="text-sm text-muted-foreground">
                        {event.notes}
                      </p>
                    )}
                  </VStack>
                </div>
              ))}
            </VStack>
          )}
        </CardContent>
      </Card>
    </VStack>
  );
}
