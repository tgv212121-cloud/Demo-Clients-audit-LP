import type { Metadata } from "next"
import "./globals.css"
import { Manrope, Instrument_Serif } from "next/font/google"

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-manrope",
})

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
  variable: "--font-instrument-serif",
})

export const metadata: Metadata = {
  title: "DigitalTimes",
  description: "Analyse CRO de landing page",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="fr">
      <body className={`${manrope.variable} ${instrumentSerif.variable} ${manrope.className}`}>{children}</body>
    </html>
  )
}
