import { redirect } from "next/navigation"
import { getProfile } from "@/lib/supabase/profile"
import { createClient } from "@/lib/supabase/server"
import { InviteUserDialog } from "./invite-user-dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"

export default async function UsersSettingsPage() {
  const profile = await getProfile()

  if (!profile || profile.role !== "super_admin") {
    redirect("/")
  }

  const supabase = await createClient()
  const { data: profiles } = await supabase
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: true })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
          <p className="text-sm text-muted-foreground">
            Manage team members and their roles.
          </p>
        </div>
        <InviteUserDialog />
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Email</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Joined</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {profiles?.map((user) => (
            <TableRow key={user.id}>
              <TableCell>{user.email}</TableCell>
              <TableCell>{user.full_name || "—"}</TableCell>
              <TableCell>
                <Badge
                  variant={
                    user.role === "super_admin" ? "default" : "secondary"
                  }
                >
                  {user.role === "super_admin" ? "Super Admin" : "Admin"}
                </Badge>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {new Date(user.created_at).toLocaleDateString()}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
