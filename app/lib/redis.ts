import { Redis } from "@upstash/redis"

export const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
})

type JobStatus = "queued" | "processing" | "done" | "error"

type JobData = {
  status: JobStatus
  url: string
  createdAt?: number
  updatedAt?: number
  result?: unknown
  error?: string
}

export async function createJob(jobId: string, url: string) {
  const job: JobData = {
    status: "queued",
    url,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }

  await redis.set(`job:${jobId}`, job)
}

export async function updateJob(
  jobId: string,
  data: Partial<JobData>
) {
  const current = await redis.get<JobData>(`job:${jobId}`)

  const nextJob: JobData = {
    status: current?.status ?? "queued",
    url: current?.url ?? "",
    createdAt: current?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
    result: current?.result,
    error: current?.error,
    ...data,
  }

  await redis.set(`job:${jobId}`, nextJob)
}

export async function getJob(jobId: string) {
  return await redis.get<JobData>(`job:${jobId}`)
}