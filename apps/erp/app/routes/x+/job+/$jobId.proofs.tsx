import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Heading,
  HStack,
  VStack
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { LuCheck, LuClock, LuLink, LuX } from "react-icons/lu";
import { useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { Job } from "~/modules/production/types";
import { path } from "~/utils/path";

type ProofApproval = {
  id: string;
  version: number;
  status: string;
  requestedAt: string;
  requestedBy: string;
  decidedAt: string | null;
  decidedBy: string | null;
  decidedByEmail: string | null;
  decisionNotes: string | null;
  externalLinkId: string | null;
  modelUploadId: string | null;
};

function getStatusBadgeVariant(status: string) {
  switch (status) {
    case "Approved":
      return "green";
    case "Rejected":
      return "red";
    case "Pending":
      return "orange";
    case "Superseded":
      return "gray";
    default:
      return "gray";
  }
}

function getStatusIcon(status: string) {
  switch (status) {
    case "Approved":
      return <LuCheck className="h-4 w-4" />;
    case "Rejected":
      return <LuX className="h-4 w-4" />;
    case "Pending":
      return <LuClock className="h-4 w-4" />;
    default:
      return null;
  }
}

export default function JobProofApprovals() {
  const { jobId } = useParams();
  if (!jobId) throw new Error("jobId not found");

  const routeData = useRouteData<{
    job: Job;
    proofApprovals: ProofApproval[];
  }>(path.to.job(jobId));

  const proofApprovals = routeData?.proofApprovals ?? [];

  if (proofApprovals.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <VStack spacing={2} className="items-center text-center">
          <Heading size="h4" className="text-muted-foreground">
            No Proof Approvals
          </Heading>
          <p className="text-sm text-muted-foreground">
            Proof approvals will appear here when the job is released to
            production. Proofs require customer approval before manufacturing
            can begin.
          </p>
        </VStack>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      <VStack spacing={4}>
        {proofApprovals.map((proof) => (
          <Card key={proof.id} className="w-full">
            <CardHeader className="pb-3">
              <HStack className="items-center justify-between">
                <HStack spacing={2} className="items-center">
                  <CardTitle className="text-base">
                    Version {proof.version}
                  </CardTitle>
                  <Badge
                    variant={
                      getStatusBadgeVariant(proof.status) as
                        | "green"
                        | "red"
                        | "orange"
                        | "gray"
                    }
                  >
                    <HStack spacing={1} className="items-center">
                      {getStatusIcon(proof.status)}
                      <span>{proof.status}</span>
                    </HStack>
                  </Badge>
                </HStack>
                {proof.externalLinkId && proof.status === "Pending" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    leftIcon={<LuLink />}
                    onClick={() => {
                      navigator.clipboard.writeText(
                        `${window.location.origin}${path.to.externalProof(proof.externalLinkId!)}`
                      );
                    }}
                  >
                    Copy Link
                  </Button>
                )}
              </HStack>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="grid gap-3 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Requested:</span>
                  <span>{formatDate(proof.requestedAt)}</span>
                </div>

                {proof.decidedAt && (
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">
                      {proof.status === "Approved" ? "Approved:" : "Rejected:"}
                    </span>
                    <span>
                      {formatDate(proof.decidedAt)}
                      {proof.decidedBy && ` by ${proof.decidedBy}`}
                      {proof.decidedByEmail && (
                        <span className="text-muted-foreground">
                          {" "}
                          ({proof.decidedByEmail})
                        </span>
                      )}
                    </span>
                  </div>
                )}

                {proof.decisionNotes && (
                  <div className="flex gap-2">
                    <span className="text-muted-foreground">Notes:</span>
                    <span>{proof.decisionNotes}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </VStack>
    </div>
  );
}
