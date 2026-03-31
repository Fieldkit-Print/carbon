import { error, getAppUrl, RESEND_DOMAIN, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { InviteEmail } from "@carbon/documents/email";
import { validationError, validator } from "@carbon/form";
import { sendEmail } from "@carbon/lib/resend.server";
import { render } from "@react-email/components";
import { nanoid } from "nanoid";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { resendInviteValidator } from "~/modules/users";
import { tasks } from "~/utils/tasks";

export async function action({ request }: ActionFunctionArgs) {
  const { companyId } = await requirePermissions(request, {
    create: "users"
  });

  const validation = await validator(resendInviteValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { users } = validation.data;

  const serviceRole = getCarbonServiceRole();
  if (users.length === 1) {
    const [userId] = users;
    const location = request.headers.get("x-vercel-ip-city") ?? "Unknown";
    const ip = request.headers.get("x-forwarded-for") ?? "127.0.0.1";
    const [company, user] = await Promise.all([
      serviceRole.from("company").select("name").eq("id", companyId).single(),
      serviceRole
        .from("user")
        .select("email, fullName")
        .eq("id", userId)
        .single()
    ]);

    if (!company.data || !user.data) {
      throw new Error("Failed to load company or user");
    }

    const invite = await serviceRole
      .from("invite")
      .select("code, createdBy")
      .eq("email", user.data.email)
      .eq("companyId", companyId)
      .is("acceptedAt", null)
      .single();

    if (invite.error || !invite.data) {
      return data(
        {},
        await flash(
          request,
          error(invite.error, "Failed to load existing invite")
        )
      );
    }

    const inviter = await serviceRole
      .from("user")
      .select("email, fullName")
      .eq("id", invite.data.createdBy)
      .single();

    await sendEmail({
      from: `Fieldkit <no-reply@${RESEND_DOMAIN}>`,
      to: user.data.email,
      subject: `You've been invited to join ${company.data?.name}`,
      headers: {
        "X-Entity-Ref-ID": nanoid()
      },
      html: await render(
        InviteEmail({
          invitedByEmail: inviter.data?.email ?? user.data.email,
          invitedByName: inviter.data?.fullName ?? "",
          email: user.data.email,
          name: user.data.fullName ?? "",
          companyName: company.data.name,
          inviteLink: `${getAppUrl()}/invite/${invite.data.code}`,
          ip,
          location
        })
      )
    });

    return data(
      {},
      await flash(request, success("Successfully resent invite"))
    );
  } else {
    try {
      await tasks.batchTrigger(
        "user-admin",
        users.map((id) => ({
          payload: {
            id,
            type: "resend",
            companyId
          }
        }))
      );
      return data(
        {},
        await flash(request, success("Successfully added invites to queue"))
      );
    } catch (e) {
      return data(
        {},
        await flash(request, error(e, "Failed to reinvite users"))
      );
    }
  }
}
