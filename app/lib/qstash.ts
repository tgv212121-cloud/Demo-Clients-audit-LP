import { Client } from "@upstash/qstash"

export const qstash = new Client({
  token: process.env.QSTASH_TOKEN!,
})

export async function enqueueAuditJob(jobId: string, url: string) {
  const baseUrl =
    process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : process.env.NEXT_PUBLIC_APP_URL

  if (!baseUrl) {
    throw new Error(
      "NEXT_PUBLIC_APP_URL ou VERCEL_PROJECT_PRODUCTION_URL manquant"
    )
  }

  await qstash.publishJSON({
    url: `${baseUrl}/api/analyse/worker`,
    body: {
      jobId,
      url,
    },
  })
}