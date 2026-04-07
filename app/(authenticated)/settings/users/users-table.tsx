"use client"

import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { updateUserRole } from "../roles/actions"

type UserProfile = {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
  role: string
  created_at: string
}

type RoleOption = {
  name: string
  description: string | null
  is_system: boolean
}

export function UsersTable({
  users,
  roles,
  currentUserId,
}: {
  users: UserProfile[]
  roles: RoleOption[]
  currentUserId: string
}) {
  const router = useRouter()

  async function handleRoleChange(userId: string, newRole: string) {
    const result = await updateUserRole(userId, newRole)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success("Role updated")
      router.refresh()
    }
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>User</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Joined</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => {
            const isCurrentUser = user.id === currentUserId
            return (
              <TableRow key={user.id}>
                <TableCell>
                  <div className="flex items-center gap-2.5">
                    <Avatar className="size-7">
                      <AvatarImage src={user.avatar_url ?? undefined} />
                      <AvatarFallback className="text-[10px]">
                        {(
                          user.full_name?.[0] ??
                          user.email[0] ??
                          "?"
                        ).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="font-medium text-sm">
                      {user.full_name || "—"}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {user.email}
                </TableCell>
                <TableCell>
                  {isCurrentUser ? (
                    <Badge variant="default">
                      {user.role.replace(/_/g, " ")}
                    </Badge>
                  ) : (
                    <Select
                      defaultValue={user.role}
                      onValueChange={(v) => handleRoleChange(user.id, v)}
                    >
                      <SelectTrigger className="h-7 w-[160px] text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {roles.map((r) => (
                          <SelectItem key={r.name} value={r.name}>
                            <span className="capitalize">
                              {r.name.replace(/_/g, " ")}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {new Date(user.created_at).toLocaleDateString()}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
