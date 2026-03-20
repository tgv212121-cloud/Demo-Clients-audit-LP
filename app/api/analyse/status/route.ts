import { getJob } from "@/app/lib/redis"

const STALE_PROCESSING_MS = 90000
const STALE_QUEUED_MS = 120000

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const jobId = searchParams.get("jobId")

    if (!jobId) {
      return Response.json({ error: "jobId manquant" }, { status: 400 })
    }

    const job = await getJob(jobId)

    if (!job) {
      return Response.json({ error: "Job introuvable" }, { status: 404 })
    }

    const now = Date.now()
    const lastUpdate = job.updatedAt ?? job.createdAt ?? now
    const age = now - lastUpdate

    if (job.status === "processing" && age > STALE_PROCESSING_MS) {
      return Response.json({
        success: true,
        job: {
          ...job,
          status: "error",
          error: "L'analyse a pris trop de temps. Le worker a sans doute été coupé avant la fin.",
        },
      })
    }

    if (job.status === "queued" && age > STALE_QUEUED_MS) {
      return Response.json({
        success: true,
        job: {
          ...job,
          status: "error",
          error: "Le job est resté trop longtemps en file d'attente.",
        },
      })
    }

    return Response.json({
      success: true,
      job,
    })
  } catch (error) {
    console.error("Erreur lecture job:", error)

    return Response.json(
      { error: "Impossible de récupérer le statut du job" },
      { status: 500 }
    )
  }
}