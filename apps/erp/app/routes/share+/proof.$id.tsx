import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Heading,
  HStack,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  Separator,
  Textarea,
  useDisclosure,
  VStack
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { useState } from "react";
import { LuCheck, LuX } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { getProofApprovalByExternalId } from "~/modules/production";
import { getCompany } from "~/modules/settings";
import { getExternalLink } from "~/modules/shared";
import type { action } from "~/routes/api+/production.proof-approval.$id";
import { path } from "~/utils/path";

export const meta = () => {
  return [{ title: "Proof Approval" }];
};

enum ProofState {
  Valid,
  AlreadyDecided,
  NotFound
}

export async function loader({ params }: LoaderFunctionArgs) {
  const { id } = params;
  if (!id) {
    return { state: ProofState.NotFound, data: null };
  }

  const serviceRole = getCarbonServiceRole();
  const externalLink = await getExternalLink(serviceRole, id);

  if (externalLink.error || !externalLink.data) {
    return { state: ProofState.NotFound, data: null };
  }

  const proof = await getProofApprovalByExternalId(serviceRole, id);

  if (proof.error || !proof.data) {
    return { state: ProofState.NotFound, data: null };
  }

  if (proof.data.status !== "Pending") {
    return {
      state: ProofState.AlreadyDecided,
      data: {
        status: proof.data.status,
        decidedBy: proof.data.decidedBy,
        decidedAt: proof.data.decidedAt,
        jobName: (proof.data.job as any)?.name ?? "Job"
      }
    };
  }

  const company = await getCompany(serviceRole, proof.data.companyId);

  // Fetch model upload details if the job has one
  let proofFileUrl: string | null = null;
  let fileName: string | null = null;
  const modelUploadId = (proof.data.job as any)?.modelUploadId ?? null;

  if (modelUploadId) {
    const { data: modelUpload } = await serviceRole
      .from("modelUpload")
      .select("name, modelPath")
      .eq("id", modelUploadId)
      .single();

    if (modelUpload?.modelPath) {
      const { data: signedUrl } = await serviceRole.storage
        .from("parts")
        .createSignedUrl(modelUpload.modelPath, 3600);
      proofFileUrl = signedUrl?.signedUrl ?? null;
      fileName = modelUpload.name ?? null;
    }
  }

  return {
    state: ProofState.Valid,
    data: {
      externalLinkId: id,
      proofId: proof.data.id,
      jobName: (proof.data.job as any)?.name ?? "Job",
      version: proof.data.version,
      requestedAt: proof.data.requestedAt,
      companyName: company.data?.name ?? "",
      proofFileUrl,
      fileName
    }
  };
}

export default function ProofApprovalPage() {
  const { state, data } = useLoaderData<typeof loader>();

  if (state === ProofState.NotFound) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted p-4">
        <Card className="w-full max-w-lg">
          <CardContent className="flex flex-col items-center gap-4 p-8">
            <Heading size="h4">Proof Not Found</Heading>
            <p className="text-muted-foreground text-center">
              The link you're trying to access is not valid.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (state === ProofState.AlreadyDecided) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted p-4">
        <Card className="w-full max-w-lg">
          <CardContent className="flex flex-col items-center gap-4 p-8">
            <Badge
              variant={data?.status === "Approved" ? "green" : "red"}
              className="text-base"
            >
              {data?.status}
            </Badge>
            <Heading size="h4">Proof Already {data?.status}</Heading>
            <p className="text-muted-foreground text-center">
              This proof for <strong>{data?.jobName}</strong> was{" "}
              {data?.status?.toLowerCase()} by {data?.decidedBy} on{" "}
              {data?.decidedAt ? formatDate(data.decidedAt) : "unknown date"}.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <ProofReview data={data!} />;
}

function ProofReview({
  data
}: {
  data: NonNullable<
    Extract<
      Awaited<ReturnType<typeof loader>>,
      { state: ProofState.Valid }
    >["data"]
  >;
}) {
  const fetcher = useFetcher<typeof action>();
  const approveModal = useDisclosure();
  const rejectModal = useDisclosure();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");

  const isSubmitting = fetcher.state !== "idle";
  const isDecided = fetcher.data?.success === true;

  if (isDecided) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted p-4">
        <Card className="w-full max-w-lg">
          <CardContent className="flex flex-col items-center gap-4 p-8">
            <Heading size="h4">Thank you!</Heading>
            <p className="text-muted-foreground text-center">
              {fetcher.data?.message}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center bg-muted p-4">
      <div className="w-full max-w-4xl space-y-6 py-8">
        <VStack spacing={2} className="items-center">
          <Heading size="h2">Proof Approval</Heading>
          <p className="text-muted-foreground">
            {data.companyName} has sent you a proof for review
          </p>
        </VStack>

        <Card>
          <CardHeader>
            <HStack className="items-center justify-between">
              <CardTitle>{data.jobName}</CardTitle>
              <Badge variant="blue">Version {data.version}</Badge>
            </HStack>
            <p className="text-muted-foreground text-sm">
              Sent on {formatDate(data.requestedAt)}
            </p>
          </CardHeader>
          <Separator />
          <CardContent className="p-6">
            {data.proofFileUrl ? (
              <div className="flex flex-col items-center gap-4">
                {data.fileName?.toLowerCase().endsWith(".pdf") ? (
                  <iframe
                    src={data.proofFileUrl}
                    className="h-[600px] w-full rounded-md border"
                    title="Proof PDF"
                  />
                ) : (
                  <img
                    src={data.proofFileUrl}
                    alt="Proof"
                    className="max-h-[600px] rounded-md border object-contain"
                  />
                )}
                <p className="text-muted-foreground text-sm">{data.fileName}</p>
              </div>
            ) : (
              <div className="flex h-48 items-center justify-center rounded-md border border-dashed">
                <p className="text-muted-foreground">No proof file attached</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <VStack spacing={4}>
              <div className="grid w-full gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-sm font-medium">Your Name</label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Full name"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Your Email</label>
                  <Input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="email@example.com"
                    type="email"
                  />
                </div>
              </div>

              <HStack spacing={4} className="w-full justify-end">
                <Button
                  variant="destructive"
                  onClick={rejectModal.onOpen}
                  disabled={!name || !email || isSubmitting}
                  leftIcon={<LuX />}
                >
                  Reject Proof
                </Button>
                <Button
                  variant="primary"
                  onClick={approveModal.onOpen}
                  disabled={!name || !email || isSubmitting}
                  leftIcon={<LuCheck />}
                >
                  Approve Proof
                </Button>
              </HStack>
            </VStack>
          </CardContent>
        </Card>
      </div>

      {/* Approve Modal */}
      <Modal open={approveModal.isOpen} onOpenChange={approveModal.onToggle}>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>
            <ModalTitle>Approve Proof</ModalTitle>
            <ModalDescription>
              Are you sure you want to approve this proof for{" "}
              <strong>{data.jobName}</strong>? This will authorize production.
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <label className="text-sm font-medium">Notes (optional)</label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any comments about the proof..."
              rows={3}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" onClick={approveModal.onClose}>
              Cancel
            </Button>
            <fetcher.Form
              method="post"
              action={path.to.proofApproval(data.externalLinkId)}
            >
              <input type="hidden" name="type" value="approve" />
              <input type="hidden" name="decidedBy" value={name} />
              <input type="hidden" name="decidedByEmail" value={email} />
              <input type="hidden" name="decisionNotes" value={notes} />
              <Button type="submit" variant="primary" disabled={isSubmitting}>
                Yes, Approve
              </Button>
            </fetcher.Form>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Reject Modal */}
      <Modal open={rejectModal.isOpen} onOpenChange={rejectModal.onToggle}>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>
            <ModalTitle>Reject Proof</ModalTitle>
            <ModalDescription>
              Please explain what needs to be changed.
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <label className="text-sm font-medium">Rejection Notes</label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Describe what needs to be corrected..."
              rows={3}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" onClick={rejectModal.onClose}>
              Cancel
            </Button>
            <fetcher.Form
              method="post"
              action={path.to.proofApproval(data.externalLinkId)}
            >
              <input type="hidden" name="type" value="reject" />
              <input type="hidden" name="decidedBy" value={name} />
              <input type="hidden" name="decidedByEmail" value={email} />
              <input type="hidden" name="decisionNotes" value={notes} />
              <Button
                type="submit"
                variant="destructive"
                disabled={isSubmitting}
              >
                Yes, Reject
              </Button>
            </fetcher.Form>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
