import OpenAI from "openai"
import { redis, updateJob } from "@/app/lib/redis"
import { qstash } from "@/app/lib/qstash"
import { takePageSnapshot, type PageBlock } from "@/app/lib/screenshot"

type AnnotationSeverity = "low" | "medium" | "high"

type AuditFinding = {
  title: string
  problem: string
  impact: string
  severity: "Faible" | "Moyenne" | "Élevée" | "Critique"
  impactLevel: "Faible" | "Moyen" | "Important" | "Très important"
  improvementHint: string
  blockId?: string
}

type AuditLLMResult = {
  score: number
  estimatedUplift: string
  summary: string
  quickWins: string[]
  priorities: {
    clarity: number
    trust: number
    cta: number
  }
  findings: AuditFinding[]
}

type Annotation = {
  id: string
  title: string
  text: string
  x: number
  y: number
  severity: AnnotationSeverity
  upliftPercent?: string
  impactLabel?: string
}

const SYSTEM_PROMPT = `
Tu es un expert international en Conversion Rate Optimization, UX design, copywriting persuasif et psychologie de conversion.

Tu réalises un audit CRO stratégique d'une landing page.

Règle absolue :
- Tu identifies les problèmes et opportunités
- Tu ne donnes jamais le plan exact de correction
- Tu ne donnes jamais la méthode détaillée
- Tu peux donner un indice général d'amélioration
- Tu restes précis, crédible, analytique et orienté performance marketing

Tu reçois aussi une liste de blocs DOM visibles avec leurs ids.
Quand c'est pertinent, tu relies chaque finding au bloc le plus pertinent via blockId.
Tu dois choisir un blockId existant parmi ceux fournis.
Si aucun bloc ne correspond clairement, laisse blockId vide.

Tu analyses la page selon ces piliers :
1. Clarté de la proposition de valeur
2. Impact de la section above the fold
3. Compréhension immédiate du message
4. Structure narrative
5. Hiérarchie visuelle et lisibilité
6. Qualité du copywriting
7. Force des CTA
8. Crédibilité et confiance
9. Gestion des objections
10. Frictions psychologiques
11. Fluidité du parcours
12. Intensité persuasive globale

Tu réponds uniquement en JSON valide compact sur une seule ligne.

Format attendu :
{
  "score": 0,
  "estimatedUplift": "+18%",
  "summary": "string",
  "quickWins": ["string", "string", "string", "string", "string"],
  "priorities": {
    "clarity": 0,
    "trust": 0,
    "cta": 0
  },
  "findings": [
    {
      "title": "string",
      "problem": "string",
      "impact": "string",
      "severity": "Faible|Moyenne|Élevée|Critique",
      "impactLevel": "Faible|Moyen|Important|Très important",
      "improvementHint": "string",
      "blockId": "block-1"
    }
  ]
}

Contraintes :
- Réponds en français
- Donne exactement 5 findings
- Donne exactement 5 quickWins
- Score entre 0 et 100
- priorities.clarity, priorities.trust, priorities.cta entre 0 et 100
- estimatedUplift sous forme de chaîne comme "+12%" ou "+18%"
- N'invente pas des éléments trop spécifiques si tu ne peux pas les déduire
- Pas de markdown
- Pas de texte avant ou après le JSON
- JSON minifié sur une seule ligne
`.trim()

const JSON_REPAIR_PROMPT = `
Tu reçois un JSON cassé.
Ta mission :
- réparer le JSON
- conserver le sens
- ne rien ajouter d'autre
- retourner uniquement un JSON valide minifié sur une seule ligne
- pas de markdown
- pas d'explication
`.trim()

const WORKER_LOCK_KEY = "audit:worker:lock"
const WORKER_LOCK_TTL_SECONDS = 180
const REQUEUE_DELAY = "2s"

const SNAPSHOT_TIMEOUT_MS = 60000
const LLM_TIMEOUT_MS = 35000
const JSON_REPAIR_TIMEOUT_MS = 15000

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY manquante")
  }

  return new OpenAI({ apiKey })
}

function getModel() {
  return process.env.OPENAI_MODEL || "gpt-4.1-mini"
}

function getBaseUrl() {
  const productionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
  const publicUrl = process.env.NEXT_PUBLIC_APP_URL

  if (productionUrl) {
    return `https://${productionUrl}`
  }

  if (publicUrl) {
    return publicUrl
  }

  throw new Error("NEXT_PUBLIC_APP_URL ou VERCEL_PROJECT_PRODUCTION_URL manquant")
}

async function acquireWorkerLock() {
  const locked = await redis.set(
    WORKER_LOCK_KEY,
    { startedAt: Date.now() },
    {
      nx: true,
      ex: WORKER_LOCK_TTL_SECONDS,
    }
  )

  return locked === "OK"
}

async function releaseWorkerLock() {
  await redis.del(WORKER_LOCK_KEY)
}

async function requeueJob(jobId: string, url: string) {
  await qstash.publishJSON({
    url: `${getBaseUrl()}/api/analyse/worker`,
    body: {
      jobId,
      url,
    },
    delay: REQUEUE_DELAY,
  })
}

function serializeBlocks(blocks: PageBlock[]) {
  return blocks
    .slice(0, 24)
    .map((block) => {
      const shortText =
        block.text.length > 140 ? `${block.text.slice(0, 140)}...` : block.text

      return [
        `id=${block.id}`,
        `type=${block.type}`,
        `x=${block.x}`,
        `y=${block.y}`,
        `width=${block.width}`,
        `height=${block.height}`,
        `text=${shortText || "vide"}`,
      ].join(" | ")
    })
    .join("\n")
}

function buildUserPrompt(params: {
  url: string
  pageTitle: string
  metaDescription: string
  textContent: string
  blocks: PageBlock[]
}) {
  const { url, pageTitle, metaDescription, textContent, blocks } = params

  return `
Réalise un audit CRO stratégique de cette landing page.

URL :
${url}

Titre de page :
${pageTitle || "Non disponible"}

Meta description :
${metaDescription || "Non disponible"}

Contenu texte extrait :
${textContent || "Non disponible"}

Blocs DOM visibles disponibles :
${serializeBlocks(blocks)}

Ta mission :
- détecter les principaux freins à la conversion
- hiérarchiser les problèmes
- estimer le niveau global de performance
- révéler les opportunités d'amélioration sans expliquer la mise en œuvre exacte
- associer chaque finding au bloc le plus pertinent via blockId quand possible
`.trim()
}

function normalizeSeverity(
  severity: AuditFinding["severity"]
): AnnotationSeverity {
  if (severity === "Critique" || severity === "Élevée") {
    return "high"
  }

  if (severity === "Moyenne") {
    return "medium"
  }

  return "low"
}

function mapImpactLevelToUplift(
  impactLevel: AuditFinding["impactLevel"]
) {
  if (impactLevel === "Très important") {
    return "+12% à +18%"
  }

  if (impactLevel === "Important") {
    return "+8% à +12%"
  }

  if (impactLevel === "Moyen") {
    return "+4% à +7%"
  }

  return "+1% à +3%"
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function findBlockById(blocks: PageBlock[], blockId?: string) {
  if (!blockId) {
    return null
  }

  return blocks.find((block) => block.id === blockId) ?? null
}

function buildAnnotations(findings: AuditFinding[], blocks: PageBlock[]): Annotation[] {
  const fallbackZones = [
    { x: 50, y: 12 },
    { x: 50, y: 28 },
    { x: 50, y: 45 },
    { x: 50, y: 62 },
    { x: 50, y: 78 },
  ]

  return findings.slice(0, 5).map((finding, index) => {
    const matchedBlock = findBlockById(blocks, finding.blockId)
    const fallback = fallbackZones[index] ?? { x: 50, y: 50 }

    const rawX = matchedBlock
      ? matchedBlock.x + matchedBlock.width / 2
      : fallback.x

    const rawY = matchedBlock
      ? matchedBlock.y + Math.min(Math.max(matchedBlock.height * 0.32, 2.5), 8)
      : fallback.y

    const x = Number(clamp(rawX, 8, 92).toFixed(2))
    const y = Number(clamp(rawY, 8, 92).toFixed(2))

    return {
      id: `a${index + 1}`,
      title: finding.title,
      text: `${finding.problem} ${finding.impact} ${finding.improvementHint}`.trim(),
      x,
      y,
      severity: normalizeSeverity(finding.severity),
      upliftPercent: mapImpactLevelToUplift(finding.impactLevel),
      impactLabel: finding.impactLevel.toLowerCase(),
    }
  })
}

function sanitizeAuditResult(data: AuditLLMResult, blocks: PageBlock[]): AuditLLMResult {
  const validBlockIds = new Set(blocks.map((block) => block.id))

  return {
    score: Math.max(0, Math.min(100, Number(data.score) || 0)),
    estimatedUplift:
      typeof data.estimatedUplift === "string" && data.estimatedUplift.trim()
        ? data.estimatedUplift.trim()
        : "+10%",
    summary:
      typeof data.summary === "string" && data.summary.trim()
        ? data.summary.trim()
        : "L'analyse montre plusieurs frictions qui limitent la performance de la page.",
    quickWins: Array.isArray(data.quickWins)
      ? data.quickWins.slice(0, 5).map((item) => String(item))
      : [],
    priorities: {
      clarity: Math.max(0, Math.min(100, Number(data.priorities?.clarity) || 0)),
      trust: Math.max(0, Math.min(100, Number(data.priorities?.trust) || 0)),
      cta: Math.max(0, Math.min(100, Number(data.priorities?.cta) || 0)),
    },
    findings: Array.isArray(data.findings)
      ? data.findings.slice(0, 5).map((finding) => ({
          title: String(finding.title || "Point à surveiller"),
          problem: String(finding.problem || ""),
          impact: String(finding.impact || ""),
          severity:
            finding.severity === "Critique" ||
            finding.severity === "Élevée" ||
            finding.severity === "Moyenne"
              ? finding.severity
              : "Faible",
          impactLevel:
            finding.impactLevel === "Très important" ||
            finding.impactLevel === "Important" ||
            finding.impactLevel === "Moyen"
              ? finding.impactLevel
              : "Faible",
          improvementHint: String(finding.improvementHint || ""),
          blockId:
            typeof finding.blockId === "string" && validBlockIds.has(finding.blockId)
              ? finding.blockId
              : undefined,
        }))
      : [],
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string) {
  return Promise.race<T>([
    promise,
    new Promise<T>((_, reject) => {
      const timer = setTimeout(() => {
        clearTimeout(timer)
        reject(new Error(`${label} trop longue`))
      }, timeoutMs)
    }),
  ])
}

function extractJsonObject(raw: string) {
  const firstBrace = raw.indexOf("{")
  const lastBrace = raw.lastIndexOf("}")

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("JSON introuvable dans la réponse du modèle")
  }

  return raw.slice(firstBrace, lastBrace + 1)
}

function cleanJsonCandidate(raw: string) {
  return raw
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .replace(/\u0000/g, "")
    .replace(/\r/g, "")
    .trim()
}

function buildParseCandidates(raw: string) {
  const cleaned = cleanJsonCandidate(raw)
  const candidates: string[] = []

  candidates.push(cleaned)

  try {
    candidates.push(extractJsonObject(cleaned))
  } catch {}

  const extracted = candidates[candidates.length - 1] || cleaned
  const lastBrace = extracted.lastIndexOf("}")

  if (lastBrace > 0) {
    candidates.push(extracted.slice(0, lastBrace + 1))
  }

  const unique = Array.from(new Set(candidates.map((item) => item.trim()).filter(Boolean)))
  return unique
}

async function repairAuditJsonWithLLM(raw: string) {
  const openai = getOpenAIClient()
  const model = getModel()

  const completion = await openai.chat.completions.create({
    model,
    temperature: 0,
    max_tokens: 900,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: JSON_REPAIR_PROMPT,
      },
      {
        role: "user",
        content: cleanJsonCandidate(raw).slice(0, 12000),
      },
    ],
  })

  const content = completion.choices[0]?.message?.content

  if (!content) {
    throw new Error("Réparation JSON vide")
  }

  return content
}

async function parseAuditResponse(content: string): Promise<AuditLLMResult> {
  const candidates = buildParseCandidates(content)

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as AuditLLMResult
    } catch {}
  }

  const repaired = await withTimeout(
    repairAuditJsonWithLLM(content),
    JSON_REPAIR_TIMEOUT_MS,
    "Réparation JSON"
  )

  const repairedCandidates = buildParseCandidates(repaired)

  for (const candidate of repairedCandidates) {
    try {
      return JSON.parse(candidate) as AuditLLMResult
    } catch {}
  }

  throw new Error("JSON du modèle impossible à parser même après réparation")
}

async function runAuditWithLLM(params: {
  url: string
  pageTitle: string
  metaDescription: string
  textContent: string
  blocks: PageBlock[]
}) {
  const openai = getOpenAIClient()
  const model = getModel()

  const completion = await openai.chat.completions.create({
    model,
    temperature: 0.1,
    max_tokens: 650,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: buildUserPrompt(params),
      },
    ],
  })

  const content = completion.choices[0]?.message?.content

  if (!content) {
    throw new Error("Réponse vide du modèle")
  }

  const parsed = await parseAuditResponse(content)
  return sanitizeAuditResult(parsed, params.blocks)
}

async function markProcessing(jobId: string) {
  await updateJob(jobId, {
    status: "processing",
    updatedAt: Date.now(),
  })
}

export async function POST(req: Request) {
  let jobId = ""
  let lockAcquired = false

  try {
    const body = await req.json()
    jobId = typeof body?.jobId === "string" ? body.jobId : ""
    const url = typeof body?.url === "string" ? body.url : ""

    if (!jobId || !url) {
      return Response.json({ error: "jobId ou url manquant" }, { status: 400 })
    }

    lockAcquired = await acquireWorkerLock()

    if (!lockAcquired) {
      await updateJob(jobId, {
        status: "queued",
        updatedAt: Date.now(),
      })

      await requeueJob(jobId, url)

      return Response.json({
        success: true,
        jobId,
        status: "queued",
        message: "Job remis dans la file",
      })
    }

    console.log(`[worker] start jobId=${jobId}`)

    await markProcessing(jobId)

    const startedAt = Date.now()

    console.log(`[worker] snapshot start jobId=${jobId}`)
    const snapshot = await withTimeout(
      takePageSnapshot(url),
      SNAPSHOT_TIMEOUT_MS,
      "Capture"
    )
    console.log(`[worker] snapshot done jobId=${jobId}`)

    await markProcessing(jobId)

    console.log(`[worker] llm start jobId=${jobId}`)
    const audit = await withTimeout(
      runAuditWithLLM({
        url,
        pageTitle: snapshot.pageTitle,
        metaDescription: snapshot.metaDescription,
        textContent: snapshot.textContent.slice(0, 3200),
        blocks: snapshot.blocks,
      }),
      LLM_TIMEOUT_MS,
      "Analyse IA"
    )
    console.log(`[worker] llm done jobId=${jobId}`)

    await markProcessing(jobId)

    const annotations = buildAnnotations(audit.findings, snapshot.blocks)

    const result = {
      success: true,
      message: "Analyse terminée",
      url,
      score: audit.score,
      summary: audit.summary,
      screenshotUrl: snapshot.screenshotUrl,
      annotations,
      quickWins: audit.quickWins,
      estimatedUplift: audit.estimatedUplift,
      deliveryTime: `${Math.max(1, Math.round((Date.now() - startedAt) / 1000))} secondes`,
      priorities: audit.priorities,
    }

    console.log(
      `[worker] result sizes jobId=${jobId} screenshotChars=${snapshot.screenshotUrl.length} annotations=${annotations.length}`
    )

    await updateJob(jobId, {
      status: "done",
      result,
      error: undefined,
      updatedAt: Date.now(),
    })

    console.log(`[worker] done jobId=${jobId}`)

    return Response.json({
      success: true,
      jobId,
      status: "done",
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erreur inconnue"

    console.error(`[worker] error jobId=${jobId}`, error)

    if (jobId) {
      try {
        await updateJob(jobId, {
          status: "error",
          error: message,
          updatedAt: Date.now(),
        })
      } catch (updateError) {
        console.error(
          `[worker] impossible de passer le job en erreur jobId=${jobId}`,
          updateError
        )
      }
    }

    return Response.json({ error: "Erreur worker" }, { status: 500 })
  } finally {
    if (lockAcquired) {
      await releaseWorkerLock()
    }
  }
}