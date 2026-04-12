import { VStack } from "@carbon/react";
import type { MetaFunction } from "react-router";
import { Outlet } from "react-router";
import { GroupedContentSidebar } from "~/components/Layout";
import { CollapsibleSidebarProvider } from "~/components/Layout/Navigation";
import usePeopleSubmodules from "~/modules/people/ui/usePeopleSubmodules";

import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Fieldkit | People" }];
};

export const handle: Handle = {
  breadcrumb: "People",
  to: path.to.people,
  module: "people"
};

export default function PeopleRoute() {
  const { groups } = usePeopleSubmodules();

  return (
    <CollapsibleSidebarProvider>
      <div className="grid grid-cols-[auto_1fr] w-full h-full">
        <GroupedContentSidebar groups={groups} />
        <VStack spacing={0} className="h-full">
          <Outlet />
        </VStack>
      </div>
    </CollapsibleSidebarProvider>
  );
}
