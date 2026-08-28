import { NextResponse, type NextRequest } from "next/server"
import { createServerClient } from "@supabase/ssr"

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl
  const isPublicPriceLabsGuide =
    pathname === "/resources/revfactor-pricelabs-listing-id-guide.pdf"

  // If not logged in and not on public routes, redirect to login.
  // /a/<token> is the public adjustment shell: WhatsApp's OG scraper and
  // link recipients hit it without a session; the page itself only serves
  // non-sensitive fields until the viewer logs in. The PriceLabs guide is an
  // intentionally public, client-safe static resource linked from Knowledge.
  if (
    !user &&
    !isPublicPriceLabsGuide &&
    pathname !== "/login" &&
    !pathname.startsWith("/auth/") &&
    !pathname.startsWith("/a/") &&
    !pathname.startsWith("/api/")
  ) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    return NextResponse.redirect(url)
  }

  // If logged in and on login page, redirect to home
  if (user && pathname === "/login") {
    const url = request.nextUrl.clone()
    url.pathname = "/"
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
