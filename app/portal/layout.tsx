import { Cormorant_Garamond } from "next/font/google"

import "./portal.css"

const brandFont = Cormorant_Garamond({
  subsets: ["latin"],
  variable: "--font-portal-brand",
  display: "swap",
})

export default function PortalLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <div className={`rf-portal ${brandFont.variable}`}>{children}</div>
}
