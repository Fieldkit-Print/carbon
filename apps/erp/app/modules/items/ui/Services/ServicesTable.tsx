import {
  Badge,
  Button,
  Checkbox,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  HStack,
  MenuIcon,
  MenuItem,
  toast,
  useDisclosure,
  VStack
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  LuAlignJustify,
  LuBookMarked,
  LuCalendar,
  LuCheck,
  LuGroup,
  LuHeadphones,
  LuPencil,
  LuTag,
  LuTrash,
  LuUser
} from "react-icons/lu";
import { Link, useFetcher, useNavigate } from "react-router";
import {
  EmployeeAvatar,
  Hyperlink,
  ItemThumbnail,
  New,
  Table
} from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useItemPostingGroups } from "~/components/Form/ItemPostingGroup";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import type { action } from "~/routes/x+/items+/update";
import { usePeople } from "~/stores";
import { path } from "~/utils/path";
import { serviceType } from "../../items.models";
import type { Service } from "../../types";

type ServicesTableProps = {
  data: Service[];
  tags: { name: string }[];
  count: number;
};

const ServicesTable = memo(({ data, count, tags }: ServicesTableProps) => {
  const navigate = useNavigate();
  const permissions = usePermissions();

  const deleteItemModal = useDisclosure();
  const [selectedItem, setSelectedItem] = useState<Service | null>(null);

  const [people] = usePeople();
  const itemPostingGroups = useItemPostingGroups();
  const customColumns = useCustomColumns<Service>("service");

  const columns = useMemo<ColumnDef<Service>[]>(() => {
    const defaultColumns: ColumnDef<Service>[] = [
      {
        accessorKey: "id",
        header: "Service ID",
        cell: ({ row }) => (
          <HStack className="py-1 min-w-[200px] truncate">
            <ItemThumbnail
              thumbnailPath={row.original.thumbnailPath}
              type="Service"
            />
            <Hyperlink to={path.to.serviceDetails(row.original.id!)}>
              <VStack spacing={0}>
                {row.original.readableIdWithRevision}
                <div className="w-full truncate text-muted-foreground text-xs">
                  {row.original.name}
                </div>
              </VStack>
            </Hyperlink>
          </HStack>
        ),
        meta: {
          icon: <LuBookMarked />
        }
      },
      {
        accessorKey: "description",
        header: "Description",
        cell: (item) => (
          <div className="max-w-[320px] truncate">
            {item.getValue<string>()}
          </div>
        ),
        meta: {
          icon: <LuAlignJustify />
        }
      },
      {
        accessorKey: "serviceType",
        header: "Service Type",
        cell: (item) => (
          <Badge variant="secondary">
            <span>{item.getValue<string>()}</span>
          </Badge>
        ),
        meta: {
          filter: {
            type: "static",
            options: serviceType.map((value) => ({
              value,
              label: <Badge variant="secondary">{value}</Badge>
            }))
          },
          icon: <LuHeadphones />
        }
      },
      {
        accessorKey: "itemPostingGroupId",
        header: "Item Group",
        cell: (item) => {
          const itemPostingGroupId = item.getValue<string>();
          const itemPostingGroup = itemPostingGroups.find(
            (group) => group.value === itemPostingGroupId
          );
          return <Enumerable value={itemPostingGroup?.label ?? null} />;
        },
        meta: {
          filter: {
            type: "static",
            options: itemPostingGroups.map((group) => ({
              value: group.value,
              label: <Enumerable value={group.label} />
            }))
          },
          icon: <LuGroup />
        }
      },
      {
        accessorKey: "tags",
        header: "Tags",
        cell: ({ row }) => (
          <HStack spacing={0} className="gap-1">
            {row.original.tags?.map((tag) => (
              <Badge key={tag} variant="secondary">
                {tag}
              </Badge>
            ))}
          </HStack>
        ),
        meta: {
          filter: {
            type: "static",
            options: tags.map((tag) => ({
              value: tag.name,
              label: <Badge variant="secondary">{tag.name}</Badge>
            })),
            isArray: true
          },
          icon: <LuTag />
        }
      },
      {
        accessorKey: "active",
        header: "Active",
        cell: (item) => <Checkbox isChecked={item.getValue<boolean>()} />,
        meta: {
          filter: {
            type: "static",
            options: [
              { value: "true", label: "Active" },
              { value: "false", label: "Inactive" }
            ]
          },
          pluralHeader: "Active Statuses",
          icon: <LuCheck />
        }
      },
      {
        id: "createdBy",
        header: "Created By",
        cell: ({ row }) => (
          <EmployeeAvatar employeeId={row.original.createdBy} />
        ),
        meta: {
          filter: {
            type: "static",
            options: people.map((employee) => ({
              value: employee.id,
              label: employee.name
            }))
          },
          icon: <LuUser />
        }
      },
      {
        accessorKey: "createdAt",
        header: "Created At",
        cell: (item) => formatDate(item.getValue<string>()),
        meta: {
          icon: <LuCalendar />
        }
      },
      {
        id: "updatedBy",
        header: "Updated By",
        cell: ({ row }) => (
          <EmployeeAvatar employeeId={row.original.updatedBy} />
        ),
        meta: {
          filter: {
            type: "static",
            options: people.map((employee) => ({
              value: employee.id,
              label: employee.name
            }))
          },
          icon: <LuUser />
        }
      },
      {
        accessorKey: "updatedAt",
        header: "Updated At",
        cell: (item) => formatDate(item.getValue<string>()),
        meta: {
          icon: <LuCalendar />
        }
      }
    ];
    return [...defaultColumns, ...customColumns];
  }, [tags, people, customColumns, itemPostingGroups]);

  const fetcher = useFetcher<typeof action>();
  useEffect(() => {
    if (fetcher.data?.error) {
      toast.error(fetcher.data.error.message);
    }
  }, [fetcher.data]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const onBulkUpdate = useCallback(
    (
      selectedRows: typeof data,
      field: "serviceType" | "itemPostingGroupId",
      value: string
    ) => {
      const formData = new FormData();
      selectedRows.forEach((row) => {
        if (row.id) formData.append("items", row.id);
      });
      formData.append("field", field);
      formData.append("value", value);
      fetcher.submit(formData, {
        method: "post",
        action: path.to.bulkUpdateItems
      });
    },
    []
  );

  const renderActions = useCallback(
    (selectedRows: typeof data) => {
      return (
        <DropdownMenuContent align="end" className="min-w-[200px]">
          <DropdownMenuLabel>Update</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Item Group</DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent>
                  {itemPostingGroups.map((group) => (
                    <DropdownMenuItem
                      key={group.value}
                      onClick={() =>
                        onBulkUpdate(
                          selectedRows,
                          "itemPostingGroupId",
                          group.value
                        )
                      }
                    >
                      <Enumerable value={group.label} />
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Service Type</DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent>
                  {serviceType.map((type) => (
                    <DropdownMenuItem
                      key={type}
                      onClick={() =>
                        onBulkUpdate(selectedRows, "serviceType", type)
                      }
                    >
                      <span>{type}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      );
    },
    [onBulkUpdate, itemPostingGroups]
  );

  const renderContextMenu = useMemo(() => {
    return (row: Service) => (
      <>
        <MenuItem onClick={() => navigate(path.to.service(row.id!))}>
          <MenuIcon icon={<LuPencil />} />
          Edit Service
        </MenuItem>
        <MenuItem
          disabled={!permissions.can("delete", "parts")}
          destructive
          onClick={() => {
            setSelectedItem(row);
            deleteItemModal.onOpen();
          }}
        >
          <MenuIcon icon={<LuTrash />} />
          Delete Service
        </MenuItem>
      </>
    );
  }, [deleteItemModal, navigate, permissions]);

  return (
    <>
      <Table<Service>
        count={count}
        columns={columns}
        data={data}
        defaultColumnPinning={{
          left: ["id"]
        }}
        defaultColumnVisibility={{
          description: false,
          active: false,
          createdBy: false,
          createdAt: false,
          updatedBy: false,
          updatedAt: false
        }}
        primaryAction={
          permissions.can("create", "parts") && (
            <div className="flex items-center gap-2">
              <Button variant="secondary" leftIcon={<LuGroup />} asChild>
                <Link to={path.to.itemPostingGroups}>Item Groups</Link>
              </Button>
              <New label="Service" to={path.to.newService} />
            </div>
          )
        }
        renderActions={renderActions}
        renderContextMenu={renderContextMenu}
        title="Services"
        table="service"
        withSavedView
        withSelectableRows
      />
      {selectedItem && selectedItem.id && (
        <ConfirmDelete
          action={path.to.deleteItem(selectedItem.id!)}
          isOpen={deleteItemModal.isOpen}
          name={selectedItem.readableIdWithRevision!}
          text={`Are you sure you want to delete ${selectedItem.readableIdWithRevision!}? This cannot be undone.`}
          onCancel={() => {
            deleteItemModal.onClose();
            setSelectedItem(null);
          }}
          onSubmit={() => {
            deleteItemModal.onClose();
            setSelectedItem(null);
          }}
        />
      )}
    </>
  );
});

ServicesTable.displayName = "ServicesTable";

export default ServicesTable;
