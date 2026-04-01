"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { createClient } from "@/lib/supabase/client"

export default function LoginPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [magicLinkSent, setMagicLinkSent] = useState(false)
  const [loading, setLoading] = useState<"password" | "magic" | null>(null)
  const [error, setError] = useState("")
  const router = useRouter()

  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading("password")
    setError("")

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    setLoading(null)

    if (error) {
      setError(error.message)
    } else {
      router.push("/")
      router.refresh()
    }
  }

  async function handleMagicLink() {
    setLoading("magic")
    setError("")

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    setLoading(null)

    if (error) {
      setError(error.message)
    } else {
      setMagicLinkSent(true)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <h1 className="text-2xl font-light tracking-tight lowercase">
            revfactor
          </h1>
        </CardHeader>
        <CardContent>
          {magicLinkSent ? (
            <p className="text-center text-sm text-muted-foreground">
              Check your email for the magic link.
            </p>
          ) : (
            <form onSubmit={handlePasswordLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}
              <Button
                type="submit"
                className="w-full"
                disabled={loading !== null}
              >
                {loading === "password" ? "Signing in..." : "Sign In"}
              </Button>
              <div className="relative flex items-center justify-center">
                <Separator className="absolute w-full" />
                <span className="relative bg-card px-2 text-xs text-muted-foreground">
                  or
                </span>
              </div>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={loading !== null || !email}
                onClick={handleMagicLink}
              >
                {loading === "magic" ? "Sending..." : "Send Magic Link"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
