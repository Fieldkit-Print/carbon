import { ValidatedForm } from "@carbon/form";
import {
  cn,
  ModalCard,
  ModalCardBody,
  ModalCardContent,
  ModalCardDescription,
  ModalCardFooter,
  ModalCardHeader,
  ModalCardProvider,
  ModalCardTitle,
  toast
} from "@carbon/react";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import type { z } from "zod";
import {
  CustomFormFields,
  Hidden,
  Input,
  InputControlled,
  ItemPostingGroup,
  // biome-ignore lint/suspicious/noShadowRestrictedNames: suppressed due to migration
  Number,
  Select,
  Submit,
  TextArea,
  UnitOfMeasure
} from "~/components/Form";
import { TrackingTypeIcon } from "~/components/Icons";
import { useNextItemId, usePermissions, useUser } from "~/hooks";
import { path } from "~/utils/path";
import {
  itemTrackingTypes,
  serviceType,
  serviceValidator
} from "../../items.models";

type ServiceFormProps = {
  initialValues: z.infer<typeof serviceValidator> & { tags: string[] };
  type?: "card" | "modal";
  onClose?: () => void;
};

function startsWithLetter(value: string) {
  return /^[A-Za-z]/.test(value);
}

const ServiceForm = ({
  initialValues,
  type = "card",
  onClose
}: ServiceFormProps) => {
  const { company } = useUser();
  const baseCurrency = company?.baseCurrencyCode ?? "USD";

  const fetcher = useFetcher<PostgrestResponse<{ id: string }>>();

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (type !== "modal") return;

    if (fetcher.state === "loading" && fetcher.data?.data) {
      onCloseRef.current?.();
      toast.success(`Created service`);
    } else if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(`Failed to create service: ${fetcher.data.error.message}`);
    }
  }, [fetcher.data, fetcher.state, type]);

  const { id, onIdChange, loading } = useNextItemId("Service");
  const permissions = usePermissions();
  const isEditing = !!initialValues.id;

  const [selectedServiceType, setSelectedServiceType] = useState<string>(
    initialValues.serviceType ?? "Internal"
  );

  const serviceTypeOptions = serviceType.map((t) => ({
    label: t,
    value: t
  }));

  const itemTrackingTypeOptions = itemTrackingTypes.map((itemTrackingType) => ({
    label: (
      <span className="flex items-center gap-2">
        <TrackingTypeIcon type={itemTrackingType} />
        {itemTrackingType}
      </span>
    ),
    value: itemTrackingType
  }));

  const replenishmentSystem =
    selectedServiceType === "External" ? "Buy" : "Make";
  const defaultMethodType = replenishmentSystem;

  return (
    <ModalCardProvider type={type}>
      <ModalCard onClose={onClose}>
        <ModalCardContent>
          <ValidatedForm
            action={isEditing ? undefined : path.to.newService}
            method="post"
            validator={serviceValidator}
            defaultValues={initialValues}
            fetcher={fetcher}
          >
            <ModalCardHeader>
              <ModalCardTitle>
                {isEditing ? "Service Details" : "New Service"}
              </ModalCardTitle>
              {!isEditing && (
                <ModalCardDescription>
                  A service is a billable non-inventory item such as design time
                  or an outside process
                </ModalCardDescription>
              )}
            </ModalCardHeader>
            <ModalCardBody>
              <Hidden name="type" value={type} />
              <Hidden name="replenishmentSystem" value={replenishmentSystem} />
              <Hidden name="defaultMethodType" value={defaultMethodType} />
              <div
                className={cn(
                  "grid w-full gap-x-8 gap-y-4",
                  isEditing
                    ? "grid-cols-1 md:grid-cols-3"
                    : "grid-cols-1 md:grid-cols-2"
                )}
              >
                {isEditing ? (
                  <Input name="id" label="Service ID" isReadOnly />
                ) : (
                  <InputControlled
                    name="id"
                    label="Service ID"
                    helperText={
                      startsWithLetter(id)
                        ? "Use ... to get the next service ID"
                        : undefined
                    }
                    value={id}
                    onChange={onIdChange}
                    isDisabled={loading}
                    isUppercase
                    autoFocus
                  />
                )}

                <Input name="name" label="Short Description" />

                <Select
                  name="serviceType"
                  label="Service Type"
                  options={serviceTypeOptions}
                  value={selectedServiceType}
                  onChange={(newValue) =>
                    setSelectedServiceType(newValue?.value ?? "Internal")
                  }
                />

                {isEditing && (
                  <TextArea name="description" label="Long Description" />
                )}

                <Select
                  name="itemTrackingType"
                  label="Tracking Type"
                  options={itemTrackingTypeOptions}
                />

                <UnitOfMeasure
                  name="unitOfMeasureCode"
                  label="Unit of Measure"
                />

                {!isEditing && (
                  <ItemPostingGroup
                    name="postingGroupId"
                    label="Item Group"
                    isClearable
                  />
                )}
                {!isEditing && (
                  <Number
                    name="unitCost"
                    label="Unit Cost"
                    formatOptions={{
                      style: "currency",
                      currency: baseCurrency
                    }}
                    minValue={0}
                  />
                )}

                <CustomFormFields table="service" tags={initialValues.tags} />
              </div>
            </ModalCardBody>
            <ModalCardFooter>
              <Submit
                isLoading={fetcher.state !== "idle"}
                isDisabled={
                  isEditing
                    ? !permissions.can("update", "parts")
                    : !permissions.can("create", "parts")
                }
              >
                Save
              </Submit>
            </ModalCardFooter>
          </ValidatedForm>
        </ModalCardContent>
      </ModalCard>
    </ModalCardProvider>
  );
};

export default ServiceForm;
