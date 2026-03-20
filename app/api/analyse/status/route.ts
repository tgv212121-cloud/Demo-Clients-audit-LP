import { randomUUID } from "crypto"
import { createJob } from "@/app/lib/redis"
import { enqueueAuditJob } from "@/app/lib/qstash"

function isValidHttpUrl(value: string) {
  try {
    const parsed = new URL(value)
    return parsed.protocol === "http:" || parsed.protocol === "https:"
  } catch {
    return false
  }
}

function normalizeUrl(value: string) {
  const trimmed = value.trim()

  if (!trimmed) {
    return ""
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed
  }

  return `https://${trimmed}`
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const rawUrl = typeof body?.url === "string" ? body.url : ""
    const normalizedUrl = normalizeUrl(rawUrl)

    if (!normalizedUrl || !isValidHttpUrl(normalizedUrl)) {
      return Response.json({ error: "URL invalide" }, { status: 400 })
    }

    const jobId = randomUUID()

    await createJob(jobId, normalizedUrl)
    await enqueueAuditJob(jobId, normalizedUrl)

    return Response.json({
      success: true,
      jobId,
      status: "queued",
      message: "Analyse lancée",
    })
  } catch (error) {
    console.error("Erreur création job:", error)

    return Response.json(
      { error: "Impossible de lancer l'analyse" },
      { status: 500 }
    )
  }
}