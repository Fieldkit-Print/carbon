import type { Json } from "@carbon/database";
import { InputControlled, Select, ValidatedForm } from "@carbon/form";
import {
  Badge,
  Button,
  HStack,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
  VStack
} from "@carbon/react";
import { Suspense, useCallback, useEffect } from "react";
import { LuCopy, LuLink } from "react-icons/lu";
import { Await, useFetcher, useParams } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { MethodBadge, TrackingTypeIcon } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { Boolean, ItemPostingGroup, Tags } from "~/components/Form";
import CustomFormInlineFields from "~/components/Form/CustomFormInlineFields";
import { ItemThumbnailUpload } from "~/components/ItemThumnailUpload";
import { useRouteData } from "~/hooks";
import type { action } from "~/routes/x+/items+/update";
import { useSuppliers } from "~/stores";
import { path } from "~/utils/path";
import { copyToClipboard } from "~/utils/string";
import { itemTrackingTypes, serviceType } from "../../items.models";
import type { ItemFile, Service, SupplierPart } from "../../types";
import { FileBadge } from "../Item";

const ServiceProperties = () => {
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId not found");

  const routeData = useRouteData<{
    serviceSummary: Service;
    files: Promise<ItemFile[]>;
    supplierParts: SupplierPart[];
    tags: { name: string }[];
  }>(path.to.service(itemId));

  const supplierParts = routeData?.supplierParts ?? [];

  const fetcher = useFetcher<typeof action>();
  useEffect(() => {
    if (fetcher.data?.error) {
      toast.error(fetcher.data.error.message);
    }
  }, [fetcher.data]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const onUpdate = useCallback(
    (
      field:
        | "name"
        | "serviceType"
        | "itemTrackingType"
        | "itemPostingGroupId"
        | "serviceId"
        | "active",
      value: string | null
    ) => {
      const formData = new FormData();

      formData.append("items", itemId);
      formData.append("field", field);
      formData.append("value", value?.toString() ?? "");
      fetcher.submit(formData, {
        method: "post",
        action: path.to.bulkUpdateItems
      });
    },
    [itemId]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const onUpdateTags = useCallback(
    (value: string[]) => {
      const formData = new FormData();

      formData.append("ids", routeData?.serviceSummary?.readableId ?? "");
      formData.append("table", "service");

      value.forEach((v) => {
        formData.append("value", v);
      });

      fetcher.submit(formData, {
        method: "post",
        action: path.to.tags
      });
    },
    [routeData?.serviceSummary?.readableId]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const onUpdateCustomFields = useCallback(
    (value: string) => {
      const formData = new FormData();

      formData.append("ids", routeData?.serviceSummary?.readableId ?? "");
      formData.append("table", "service");
      formData.append("value", value);

      fetcher.submit(formData, {
        method: "post",
        action: path.to.customFields
      });
    },
    [routeData?.serviceSummary?.readableId]
  );

  const [suppliers] = useSuppliers();

  return (
    <VStack
      spacing={4}
      className="w-96 bg-card h-full overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent border-l border-border px-4 py-2 text-sm"
    >
      <VStack spacing={2}>
        <HStack className="w-full justify-between">
          <h3 className="text-xxs text-foreground/70 uppercase font-light tracking-wide">
            Properties
          </h3>
          <HStack spacing={1}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  aria-label="Link"
                  size="sm"
                  className="p-1"
                  onClick={() =>
                    copyToClipboard(
                      window.location.origin + path.to.service(itemId)
                    )
                  }
                >
                  <LuLink className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>Copy link to service</span>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  aria-label="Copy"
                  size="sm"
                  className="p-1"
                  onClick={() =>
                    copyToClipboard(
                      routeData?.serviceSummary?.readableIdWithRevision ?? ""
                    )
                  }
                >
                  <LuCopy className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>Copy service number</span>
              </TooltipContent>
            </Tooltip>
          </HStack>
        </HStack>
        <VStack spacing={1} className="pt-2">
          <ValidatedForm
            defaultValues={{
              serviceId:
                routeData?.serviceSummary?.readableIdWithRevision ?? undefined
            }}
            validator={z.object({
              serviceId: z.string()
            })}
            className="w-full -mt-2"
          >
            <span className="text-sm">
              <InputControlled
                label=""
                name="serviceId"
                inline
                size="sm"
                value={routeData?.serviceSummary?.readableId ?? ""}
                onBlur={(e) => {
                  onUpdate("serviceId", e.target.value ?? null);
                }}
                className="text-muted-foreground"
              />
            </span>
          </ValidatedForm>
          <ValidatedForm
            defaultValues={{
              name: routeData?.serviceSummary?.name ?? undefined
            }}
            validator={z.object({
              name: z.string()
            })}
            className="w-full -mt-2"
          >
            <span className="text-xs text-muted-foreground">
              <InputControlled
                label=""
                name="name"
                inline
                size="sm"
                value={routeData?.serviceSummary?.name ?? ""}
                onBlur={(e) => {
                  onUpdate("name", e.target.value ?? null);
                }}
                className="text-muted-foreground"
              />
            </span>
          </ValidatedForm>
        </VStack>
        <ItemThumbnailUpload
          path={routeData?.serviceSummary?.thumbnailPath}
          itemId={itemId}
        />
      </VStack>

      <ValidatedForm
        defaultValues={{
          serviceType: routeData?.serviceSummary?.serviceType ?? undefined
        }}
        validator={z.object({
          serviceType: z.string()
        })}
        className="w-full"
      >
        <Select
          name="serviceType"
          label="Service Type"
          inline={(value) => <Badge variant="secondary">{value}</Badge>}
          options={serviceType.map((type) => ({
            value: type,
            label: type
          }))}
          onChange={(value) => {
            onUpdate("serviceType", value?.value ?? null);
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          itemPostingGroupId:
            routeData?.serviceSummary?.itemPostingGroupId ?? undefined
        }}
        validator={z.object({
          itemPostingGroupId: z.string().nullable().optional()
        })}
        className="w-full"
      >
        <ItemPostingGroup
          label="Item Group"
          name="itemPostingGroupId"
          inline
          isClearable
          onChange={(value) => {
            onUpdate("itemPostingGroupId", value?.value ?? null);
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          itemTrackingType:
            routeData?.serviceSummary?.itemTrackingType ?? undefined
        }}
        validator={z.object({
          itemTrackingType: z.string()
        })}
        className="w-full"
      >
        <Select
          name="itemTrackingType"
          label="Tracking Type"
          inline={(value) => (
            <Badge variant="secondary">
              <TrackingTypeIcon type={value} className="mr-2" />
              <span>{value}</span>
            </Badge>
          )}
          options={itemTrackingTypes.map((type) => ({
            value: type,
            label: (
              <span className="flex items-center gap-2">
                <TrackingTypeIcon type={type} />
                {type}
              </span>
            )
          }))}
          onChange={(value) => {
            onUpdate("itemTrackingType", value?.value ?? null);
          }}
        />
      </ValidatedForm>

      <VStack spacing={2}>
        <h3 className="text-xs text-muted-foreground">Unit of Measure</h3>
        <Enumerable value={routeData?.serviceSummary?.unitOfMeasure ?? null} />
      </VStack>

      {routeData?.serviceSummary?.serviceType === "External" &&
        supplierParts.length > 0 && (
          <VStack spacing={2}>
            <HStack className="w-full justify-between">
              <h3 className="text-xs text-muted-foreground">Suppliers</h3>
            </HStack>
            {supplierParts.map((method) => (
              <MethodBadge
                key={method.id}
                type="Buy"
                text={
                  suppliers.find((s) => s.id === method.supplierId)?.name ?? ""
                }
                to={path.to.servicePurchasing(itemId)}
              />
            ))}
          </VStack>
        )}

      <ValidatedForm
        defaultValues={{
          active: routeData?.serviceSummary?.active ?? undefined
        }}
        validator={z.object({
          active: zfd.checkbox()
        })}
        className="w-full"
      >
        <Boolean
          label="Active"
          name="active"
          variant="small"
          onChange={(value) => {
            onUpdate("active", value ? "on" : "off");
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          tags: routeData?.serviceSummary?.tags ?? []
        }}
        validator={z.object({
          tags: z.array(z.string()).optional()
        })}
        className="w-full"
      >
        <Tags
          label="Tags"
          name="tags"
          availableTags={routeData?.tags ?? []}
          table="service"
          inline
          onChange={onUpdateTags}
        />
      </ValidatedForm>

      <CustomFormInlineFields
        customFields={
          (routeData?.serviceSummary?.customFields ?? {}) as Record<
            string,
            Json
          >
        }
        table="service"
        tags={routeData?.serviceSummary?.tags ?? []}
        onUpdate={onUpdateCustomFields}
      />

      <VStack spacing={2}>
        <HStack className="w-full justify-between">
          <h3 className="text-xs text-muted-foreground">Files</h3>
        </HStack>

        <Suspense fallback={null}>
          <Await resolve={routeData?.files}>
            {(files) =>
              files?.map((file) => (
                <FileBadge
                  key={file.id}
                  file={file}
                  itemId={itemId}
                  itemType="Service"
                />
              ))
            }
          </Await>
        </Suspense>
      </VStack>
    </VStack>
  );
};

export default ServiceProperties;
