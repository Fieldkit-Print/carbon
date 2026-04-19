import type { Database } from "@carbon/database";

type CarbonTaskStatus = Database["public"]["Enums"]["nonConformanceTaskStatus"];

export const mapAsanaStatusToCarbonStatus = (
  completed: boolean
): CarbonTaskStatus => {
  return completed ? "Completed" : "Pending";
};

export const mapCarbonStatusToAsanaCompleted = (status: string): boolean => {
  switch (status) {
    case "Completed":
    case "Skipped":
      return true;
    default:
      return false;
  }
};

export type EntityType = "salesOrder" | "quote" | "salesRfq";

export const mapEntityStatusToAsanaCompleted = (
  entityType: EntityType,
  status: string
): boolean => {
  switch (entityType) {
    case "salesOrder":
      return status === "Closed" || status === "Cancelled";
    case "quote":
      return (
        status === "Ordered" ||
        status === "Lost" ||
        status === "Cancelled" ||
        status === "Expired"
      );
    case "salesRfq":
      return status === "Closed" || status === "Quoted";
    default:
      return false;
  }
};

export const formatEntityTaskName = (
  entityType: EntityType,
  readableId: string,
  customerName: string,
  status: string
): string => {
  const prefix =
    entityType === "quote" ? "Quote" : entityType === "salesRfq" ? "RFQ" : "SO";
  return `[${status}] ${prefix} ${readableId} - ${customerName}`;
};
