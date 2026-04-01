import { assertIsPost, error, success } from "@carbon/auth";
import { hashPin, requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  HStack,
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
  VStack
} from "@carbon/react";
import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useFetcher, useLoaderData } from "react-router";
import {
  accountProfileValidator,
  getAccount,
  updateAvatar,
  updatePublicAccount
} from "~/modules/account";
import { ProfileForm, ProfilePhotoForm } from "~/modules/account/ui/Profile";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Profile",
  to: path.to.profile
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, userId, companyId } = await requirePermissions(request, {});

  const serviceRole = getCarbonServiceRole();
  const [user, employee] = await Promise.all([
    getAccount(client, userId),
    serviceRole
      .from("employee")
      .select("pinHash")
      .eq("id", userId)
      .eq("companyId", companyId)
      .maybeSingle()
  ]);

  if (user.error || !user.data) {
    throw redirect(
      path.to.authenticatedRoot,
      await flash(request, error(user.error, "Failed to get user"))
    );
  }

  return { user: user.data, hasPin: !!employee.data?.pinHash };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {});
  const formData = await request.formData();

  if (formData.get("intent") === "about") {
    const validation = await validator(accountProfileValidator).validate(
      formData
    );

    if (validation.error) {
      return validationError(validation.error);
    }

    const { firstName, lastName, about } = validation.data;

    const updateAccount = await updatePublicAccount(client, {
      id: userId,
      firstName,
      lastName,
      about
    });
    if (updateAccount.error)
      return data(
        {},
        await flash(
          request,
          error(updateAccount.error, "Failed to update profile")
        )
      );

    return data({}, await flash(request, success("Updated profile")));
  }

  if (formData.get("intent") === "pin") {
    const { userId, companyId } = await requirePermissions(request, {});
    const serviceRole = getCarbonServiceRole();
    const pin = formData.get("pin") as string;

    if (pin === "") {
      // Remove PIN
      const result = await serviceRole
        .from("employee")
        .update({ pinHash: null })
        .eq("id", userId)
        .eq("companyId", companyId);

      if (result.error) {
        return data(
          {},
          await flash(request, error(result.error, "Failed to remove PIN"))
        );
      }

      return data({}, await flash(request, success("PIN removed")));
    }

    if (!pin || pin.length !== 4 || !/^\d{4}$/.test(pin)) {
      return data(
        {},
        await flash(request, error(null, "PIN must be exactly 4 digits"))
      );
    }

    const pinHash = hashPin(pin, companyId);

    // Check if this PIN is already used by another employee in the same company
    const existing = await serviceRole
      .from("employee")
      .select("id")
      .eq("pinHash", pinHash)
      .eq("companyId", companyId)
      .neq("id", userId)
      .maybeSingle();

    if (existing.data) {
      return data(
        {},
        await flash(
          request,
          error(
            null,
            "This PIN is already in use. Please choose a different one."
          )
        )
      );
    }

    const result = await serviceRole
      .from("employee")
      .update({ pinHash })
      .eq("id", userId)
      .eq("companyId", companyId);

    if (result.error) {
      return data(
        {},
        await flash(request, error(result.error, "Failed to update PIN"))
      );
    }

    return data({}, await flash(request, success("PIN updated")));
  }

  if (formData.get("intent") === "photo") {
    const photoPath = formData.get("path");
    if (photoPath === null || typeof photoPath === "string") {
      const avatarUpdate = await updateAvatar(client, userId, photoPath);
      if (avatarUpdate.error) {
        throw redirect(
          path.to.profile,
          await flash(
            request,
            error(avatarUpdate.error, "Failed to update avatar")
          )
        );
      }

      throw redirect(
        path.to.profile,
        await flash(
          request,
          success(photoPath === null ? "Removed avatar" : "Updated avatar")
        )
      );
    } else {
      throw redirect(
        path.to.profile,
        await flash(request, error(null, "Invalid avatar path"))
      );
    }
  }

  return null;
}

export default function AccountProfile() {
  const { user, hasPin } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={2}>
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>
            This information will be visible to all users, so be careful what
            you share.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 w-full">
            <ProfileForm user={user} />
            <ProfilePhotoForm user={user} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Production PIN</CardTitle>
          <CardDescription>
            Set a 4-digit PIN to use when scanning QR codes on the shop floor.
            This lets you clock in and out of operations without logging into
            the MES app.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PinForm hasPin={hasPin} />
        </CardContent>
      </Card>
    </VStack>
  );
}

function PinForm({ hasPin }: { hasPin: boolean }) {
  const fetcher = useFetcher();
  const [pin, setPin] = useState("");
  const [mode, setMode] = useState<"view" | "edit">("view");
  const isSubmitting = fetcher.state !== "idle";

  // Reset form after successful submission
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      setMode("view");
      setPin("");
    }
  }, [fetcher.state, fetcher.data]);

  if (mode === "view") {
    return (
      <HStack spacing={4} className="items-center">
        <p className="text-sm text-muted-foreground">
          {hasPin ? "PIN is set" : "No PIN set"}
        </p>
        <Button variant="secondary" size="sm" onClick={() => setMode("edit")}>
          {hasPin ? "Change PIN" : "Set PIN"}
        </Button>
        {hasPin && (
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="pin" />
            <input type="hidden" name="pin" value="" />
            <Button
              type="submit"
              variant="ghost"
              size="sm"
              disabled={isSubmitting}
            >
              Remove PIN
            </Button>
          </fetcher.Form>
        )}
      </HStack>
    );
  }

  return (
    <fetcher.Form method="post">
      <input type="hidden" name="intent" value="pin" />
      <input type="hidden" name="pin" value={pin} />
      <VStack spacing={4}>
        <div>
          <p className="text-sm font-medium mb-2">Enter a 4-digit PIN</p>
          <InputOTP
            maxLength={4}
            value={pin}
            onChange={setPin}
            inputMode="numeric"
          >
            <InputOTPGroup>
              <InputOTPSlot index={0} />
              <InputOTPSlot index={1} />
              <InputOTPSlot index={2} />
              <InputOTPSlot index={3} />
            </InputOTPGroup>
          </InputOTP>
        </div>
        <HStack spacing={2}>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={pin.length !== 4 || isSubmitting}
          >
            {isSubmitting ? "Saving..." : "Save PIN"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setMode("view");
              setPin("");
            }}
          >
            Cancel
          </Button>
        </HStack>
      </VStack>
    </fetcher.Form>
  );
}
