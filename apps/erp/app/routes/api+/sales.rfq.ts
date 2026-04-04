import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { upsertSalesRFQ, upsertSalesRFQLine } from "~/modules/sales";
import { getNextSequence } from "~/modules/settings";

const createRfqValidator = z.object({
  customerId: z.string().min(1, { message: "customerId is required" }),
  rfqDate: z.string().min(1, { message: "rfqDate is required" }),
  rfqId: z.string().optional(),
  customerContactId: z.string().optional(),
  customerLocationId: z.string().optional(),
  customerEngineeringContactId: z.string().optional(),
  customerReference: z.string().optional(),
  expirationDate: z.string().optional(),
  internalNotes: z.string().optional(),
  externalNotes: z.string().optional(),
  locationId: z.string().optional(),
  salesPersonId: z.string().optional(),
  status: z
    .enum(["Draft", "Ready for Quote", "Quoted", "Closed"])
    .optional()
    .default("Draft"),
  lines: z
    .array(
      z.object({
        customerPartId: z
          .string()
          .min(1, { message: "customerPartId is required" }),
        customerPartRevision: z.string().optional(),
        itemId: z.string().optional(),
        description: z.string().optional(),
        quantity: z
          .array(z.number().min(0.00001))
          .min(1, { message: "At least one quantity is required" }),
        unitOfMeasureCode: z.string().default("EA")
      })
    )
    .optional()
});

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales"
  });

  const { data, error: fetchError } = await client
    .from("salesRfqs")
    .select("*")
    .eq("companyId", companyId)
    .order("createdAt", { ascending: false });

  if (fetchError) {
    return Response.json({ error: fetchError.message }, { status: 500 });
  }

  return Response.json({ data });
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const { client, companyId, userId } = await requirePermissions(request, {
    create: "sales"
  });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const validation = createRfqValidator.safeParse(body);
  if (!validation.success) {
    return Response.json(
      { error: "Validation failed", details: validation.error.flatten() },
      { status: 400 }
    );
  }

  const { lines, ...rfqData } = validation.data;

  // Generate RFQ ID if not provided
  let rfqId = rfqData.rfqId;
  if (!rfqId) {
    const nextSequence = await getNextSequence(client, "salesRfq", companyId);
    if (nextSequence.error) {
      return Response.json(
        { error: "Failed to generate RFQ ID" },
        { status: 500 }
      );
    }
    rfqId = nextSequence.data;
  }

  const result = await upsertSalesRFQ(client, {
    ...rfqData,
    rfqId,
    companyId,
    createdBy: userId
  });

  if (result.error || !result.data?.[0]) {
    return Response.json(
      { error: result.error?.message ?? "Failed to create RFQ" },
      { status: 500 }
    );
  }

  const rfq = result.data[0];

  // Create lines if provided
  const createdLines = [];
  if (lines?.length) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineResult = await upsertSalesRFQLine(client, {
        salesRfqId: rfq.id!,
        customerPartId: line.customerPartId,
        customerPartRevision: line.customerPartRevision ?? "",
        itemId: line.itemId ?? "",
        description: line.description ?? "",
        quantity: line.quantity,
        unitOfMeasureCode: line.unitOfMeasureCode,
        order: i + 1,
        companyId,
        createdBy: userId
      });

      if (lineResult.error) {
        return Response.json(
          {
            error: `Failed to create line ${i + 1}: ${lineResult.error.message}`,
            rfqId: rfq.id
          },
          { status: 500 }
        );
      }

      createdLines.push(lineResult.data);
    }
  }

  return Response.json({
    id: rfq.id,
    rfqId: rfq.rfqId,
    lines: createdLines
  });
}
