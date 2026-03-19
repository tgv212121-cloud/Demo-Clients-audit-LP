import OpenAI from "openai"
import { redis, updateJob } from "@/app/lib/redis"
import { qstash } from "@/app/lib/qstash"
import { takePageSnapshot, type PageBlock } from "@/app/lib/screenshot"

type AnnotationSeverity = "low" | "medium" | "high"

type AuditFindingSeverity = "Faible" | "Moyenne" | "Élevée" | "Critique"
type AuditFindingImpactLevel = "Faible" | "Moyen" | "Important" | "Très important"

type AuditFinding = {
  title: string
  problem: string
  impact: string
  severity: AuditFindingSeverity
  impactLevel: AuditFindingImpactLevel
  improvementHint: string
  targetId?: string
  targetText?: string
  targetType?: string
  confidence?: number
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
Tu es un expert senior en CRO, UX, copywriting de conversion et audit de landing page.
Tu travailles comme une agence haut de gamme.

Objectif :
- produire un audit crédible
- détecter les freins à la conversion
- cibler uniquement des éléments visibles et réellement présents dans les blocs fournis
- ne jamais inventer une cible
- ne jamais choisir une cible vague si une cible plus précise existe

Règles absolues :
- tu réponds uniquement en JSON valide compact sur une seule ligne
- tu réponds en français
- tu donnes exactement 5 quickWins
- tu donnes entre 3 et 5 findings
- chaque finding doit viser une cible précise si possible
- si tu n'es pas sûr d'une cible, confidence doit être basse
- tu privilégies les titres, CTA, formulaires, inputs, sections de preuve, pricing, témoignages, FAQ
- tu évites de viser un gros conteneur générique si un élément plus précis existe dedans

Pour chaque finding :
- targetId doit être un id existant parmi les blocs fournis quand tu as une bonne cible
- targetText doit reprendre le texte réel ou quasi exact de la cible
- targetType doit décrire la zone visée
- confidence doit être un nombre entre 0 et 1

Tu ne donnes jamais un plan détaillé de correction.
Tu peux donner un indice stratégique général dans improvementHint.

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
      "targetId": "target-1",
      "targetText": "texte précis ou quasi exact",
      "targetType": "headline|cta|form|pricing|testimonial|proof|faq|body|hero|section|input",
      "confidence": 0.91
    }
  ]
}

Contraintes :
- pas de markdown
- pas de texte avant ou après le JSON
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
const MAX_SERIALIZED_BLOCKS = 42
const MIN_VISIBLE_ANNOTATION_CONFIDENCE = 0.78
const MAX_VISIBLE_ANNOTATIONS = 4

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

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function normalizeText(value: string) {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function shortText(value: string, max = 140) {
  const normalized = normalizeText(value)
  if (normalized.length <= max) {
    return normalized
  }
  return `${normalized.slice(0, max)}...`
}

function normalizeForCompare(value: string) {
  return normalizeText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

function tokenize(value: string) {
  return normalizeForCompare(value)
    .split(/[^a-z0-9]+/i)
    .map((item) => item.trim())
    .filter((item) => item.length >= 3)
}

function getBlockPriority(block: PageBlock) {
  if (block.type === "headline") return 100
  if (block.type === "cta") return 96
  if (block.type === "subheadline") return 92
  if (block.type === "input") return 88
  if (block.type === "form") return 86
  if (block.type === "pricing") return 84
  if (block.type === "testimonial") return 82
  if (block.type === "proof") return 80
  if (block.type === "faq") return 78
  if (block.type === "hero") return 76
  if (block.type === "card") return 68
  if (block.type === "body") return 62
  if (block.type === "section") return 44
  return 50
}

function serializeBlocks(blocks: PageBlock[]) {
  return blocks
    .slice(0, MAX_SERIALIZED_BLOCKS)
    .map((block) => {
      const parts = [
        `id=${block.id}`,
        `type=${block.type}`,
        `x=${block.x}`,
        `y=${block.y}`,
        `width=${block.width}`,
        `height=${block.height}`,
      ]

      if (block.tagName) parts.push(`tag=${block.tagName}`)
      if (block.role) parts.push(`role=${block.role}`)
      if (block.selectorHint) parts.push(`selector=${shortText(block.selectorHint, 80)}`)
      if (block.targetLabel) parts.push(`label=${shortText(block.targetLabel, 120)}`)
      if (block.text) parts.push(`text=${shortText(block.text, 180)}`)

      return parts.join(" | ")
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

URL : ${url}
Titre de page : ${pageTitle || "Non disponible"}
Meta description : ${metaDescription || "Non disponible"}
Contenu texte extrait : ${textContent || "Non disponible"}

Blocs visibles annotables disponibles :
${serializeBlocks(blocks)}

Ta mission :
- détecter les principaux freins à la conversion
- hiérarchiser les problèmes
- estimer le niveau global de performance
- rester crédible comme un consultant humain
- associer chaque finding à une cible réelle et précise quand c'est possible
- ne jamais inventer une cible ni un texte qui n'existe pas visiblement sur la page

Rappel :
- targetId doit pointer vers un id existant si tu es sûr de la cible
- targetText doit reprendre le texte réel ou quasi exact de la cible
- confidence doit refléter ton vrai niveau de certitude
`.trim()
}

function normalizeSeverity(
  severity: AuditFindingSeverity
): AnnotationSeverity {
  if (severity === "Critique" || severity === "Élevée") {
    return "high"
  }

  if (severity === "Moyenne") {
    return "medium"
  }

  return "low"
}

function mapImpactLevelToUplift(impactLevel: AuditFindingImpactLevel) {
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

function parseSeverity(value: unknown): AuditFindingSeverity {
  if (value === "Faible" || value === "Moyenne" || value === "Élevée" || value === "Critique") {
    return value
  }
  return "Faible"
}

function parseImpactLevel(value: unknown): AuditFindingImpactLevel {
  if (
    value === "Faible" ||
    value === "Moyen" ||
    value === "Important" ||
    value === "Très important"
  ) {
    return value
  }
  return "Faible"
}

function findBlockById(blocks: PageBlock[], blockId?: string) {
  if (!blockId) {
    return null
  }

  return blocks.find((block) => block.id === blockId) ?? null
}

function scoreTextMatch(query: string, candidate: string) {
  const left = normalizeForCompare(query)
  const right = normalizeForCompare(candidate)

  if (!left || !right) {
    return 0
  }

  if (left === right) {
    return 1
  }

  if (right.includes(left)) {
    return 0.94
  }

  if (left.includes(right) && right.length >= 12) {
    return 0.88
  }

  const leftTokens = tokenize(left)
  const rightTokens = tokenize(right)

  if (!leftTokens.length || !rightTokens.length) {
    return 0
  }

  const leftSet = new Set(leftTokens)
  const rightSet = new Set(rightTokens)

  let overlap = 0
  for (const token of leftSet) {
    if (rightSet.has(token)) {
      overlap += 1
    }
  }

  const overlapRatio = overlap / Math.max(leftSet.size, rightSet.size)
  const coverageRatio = overlap / Math.max(1, leftSet.size)

  return Number((overlapRatio * 0.55 + coverageRatio * 0.45).toFixed(4))
}

function findBestBlockByText(blocks: PageBlock[], targetText?: string) {
  const wanted = normalizeText(targetText || "")

  if (!wanted) {
    return null
  }

  let best: { block: PageBlock; score: number } | null = null

  for (const block of blocks) {
    const candidates = [
      block.text,
      block.targetLabel || "",
      block.ariaLabel || "",
      block.selectorHint || "",
    ]

    let localBest = 0
    for (const candidate of candidates) {
      const score = scoreTextMatch(wanted, candidate || "")
      if (score > localBest) {
        localBest = score
      }
    }

    if (!best || localBest > best.score) {
      best = {
        block,
        score: localBest,
      }
    }
  }

  if (!best || best.score < 0.72) {
    return null
  }

  return best
}

function resolveFindingBlock(finding: AuditFinding, blocks: PageBlock[]) {
  const byId = findBlockById(blocks, finding.targetId)

  if (byId) {
    const idTextScore = scoreTextMatch(
      finding.targetText || "",
      byId.text || byId.targetLabel || ""
    )

    if (!finding.targetText || idTextScore >= 0.5) {
      return {
        block: byId,
        matchedBy: "id" as const,
        textScore: idTextScore || 0.84,
      }
    }
  }

  const byText = findBestBlockByText(blocks, finding.targetText)

  if (byText) {
    return {
      block: byText.block,
      matchedBy: "text" as const,
      textScore: byText.score,
    }
  }

  return null
}

function getBlockAnchor(block: PageBlock) {
  if (block.type === "cta" || block.type === "input" || block.type === "form") {
    return {
      x: block.x + block.width / 2,
      y: block.y + block.height / 2,
    }
  }

  if (block.type === "headline" || block.type === "subheadline") {
    return {
      x: block.x + clamp(block.width * 0.18, 4, 16),
      y: block.y + clamp(block.height * 0.38, 2.2, 5.8),
    }
  }

  if (
    block.type === "pricing" ||
    block.type === "testimonial" ||
    block.type === "proof" ||
    block.type === "faq" ||
    block.type === "card"
  ) {
    return {
      x: block.x + clamp(block.width * 0.16, 4.5, 14),
      y: block.y + clamp(block.height * 0.22, 2.5, 7),
    }
  }

  return {
    x: block.x + clamp(block.width * 0.14, 4, 14),
    y: block.y + clamp(block.height * 0.28, 2.5, 7.5),
  }
}

function buildFallbackAnnotations(findings: AuditFinding[]): Annotation[] {
  const fallbackZones = [
    { x: 18, y: 14 },
    { x: 78, y: 22 },
    { x: 22, y: 42 },
    { x: 76, y: 58 },
  ]

  return findings.slice(0, 2).map((finding, index) => {
    const fallback = fallbackZones[index] ?? { x: 50, y: 50 }

    return {
      id: `a-fallback-${index + 1}`,
      title: finding.title,
      text: `${finding.problem} ${finding.impact} ${finding.improvementHint}`.trim(),
      x: fallback.x,
      y: fallback.y,
      severity: normalizeSeverity(finding.severity),
      upliftPercent: mapImpactLevelToUplift(finding.impactLevel),
      impactLabel: finding.impactLevel.toLowerCase(),
    }
  })
}

function buildAnnotations(findings: AuditFinding[], blocks: PageBlock[]): Annotation[] {
  const validated: Array<{
    finding: AuditFinding
    block: PageBlock
    anchorX: number
    anchorY: number
    credibility: number
  }> = []

  for (const finding of findings.slice(0, 5)) {
    const resolved = resolveFindingBlock(finding, blocks)

    if (!resolved) {
      continue
    }

    const confidence = clamp(Number(finding.confidence) || 0, 0, 1)
    const priorityBoost = getBlockPriority(resolved.block) / 100
    const credibility = Number(
      (
        confidence * 0.68 +
        resolved.textScore * 0.24 +
        priorityBoost * 0.08
      ).toFixed(4)
    )

    if (credibility < MIN_VISIBLE_ANNOTATION_CONFIDENCE) {
      continue
    }

    const anchor = getBlockAnchor(resolved.block)

    validated.push({
      finding,
      block: resolved.block,
      anchorX: clamp(Number(anchor.x.toFixed(2)), 8, 92),
      anchorY: clamp(Number(anchor.y.toFixed(2)), 8, 92),
      credibility,
    })
  }

  const deduped = validated.filter((item, index, array) => {
    return (
      array.findIndex((other) => {
        const sameBlock = other.block.id === item.block.id
        const sameTitle =
          normalizeForCompare(other.finding.title) ===
          normalizeForCompare(item.finding.title)
        return sameBlock || sameTitle
      }) === index
    )
  })

  const selected = deduped
    .sort((a, b) => {
      const impactOrder = (value: AuditFindingImpactLevel) => {
        if (value === "Très important") return 4
        if (value === "Important") return 3
        if (value === "Moyen") return 2
        return 1
      }

      const severityOrder = (value: AuditFindingSeverity) => {
        if (value === "Critique") return 4
        if (value === "Élevée") return 3
        if (value === "Moyenne") return 2
        return 1
      }

      const scoreA =
        a.credibility * 100 +
        impactOrder(a.finding.impactLevel) * 5 +
        severityOrder(a.finding.severity) * 3

      const scoreB =
        b.credibility * 100 +
        impactOrder(b.finding.impactLevel) * 5 +
        severityOrder(b.finding.severity) * 3

      return scoreB - scoreA
    })
    .slice(0, MAX_VISIBLE_ANNOTATIONS)

  if (!selected.length) {
    return buildFallbackAnnotations(findings)
  }

  return selected.map((item, index) => ({
    id: `a${index + 1}`,
    title: item.finding.title,
    text: `${item.finding.problem} ${item.finding.impact} ${item.finding.improvementHint}`.trim(),
    x: item.anchorX,
    y: item.anchorY,
    severity: normalizeSeverity(item.finding.severity),
    upliftPercent: mapImpactLevelToUplift(item.finding.impactLevel),
    impactLabel: item.finding.impactLevel.toLowerCase(),
  }))
}

function sanitizeAuditResult(data: AuditLLMResult, blocks: PageBlock[]): AuditLLMResult {
  const validBlockIds = new Set(blocks.map((block) => block.id))

  const findings: AuditFinding[] = Array.isArray(data.findings)
    ? data.findings
        .slice(0, 5)
        .map((finding): AuditFinding => ({
          title: String(finding.title || "Point à surveiller").trim(),
          problem: String(finding.problem || "").trim(),
          impact: String(finding.impact || "").trim(),
          severity: parseSeverity(finding.severity),
          impactLevel: parseImpactLevel(finding.impactLevel),
          improvementHint: String(finding.improvementHint || "").trim(),
          targetId:
            typeof finding.targetId === "string" && validBlockIds.has(finding.targetId)
              ? finding.targetId
              : undefined,
          targetText: String(finding.targetText || "").trim(),
          targetType: String(finding.targetType || "").trim(),
          confidence: clamp(Number(finding.confidence) || 0, 0, 1),
        }))
        .filter(
          (finding) =>
            finding.title &&
            (finding.problem || finding.impact || finding.improvementHint)
        )
    : []

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
      ? data.quickWins
          .slice(0, 5)
          .map((item) => String(item).trim())
          .filter(Boolean)
      : [],
    priorities: {
      clarity: Math.max(0, Math.min(100, Number(data.priorities?.clarity) || 0)),
      trust: Math.max(0, Math.min(100, Number(data.priorities?.trust) || 0)),
      cta: Math.max(0, Math.min(100, Number(data.priorities?.cta) || 0)),
    },
    findings,
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

  return Array.from(new Set(candidates.map((item) => item.trim()).filter(Boolean)))
}

async function repairAuditJsonWithLLM(raw: string) {
  const openai = getOpenAIClient()
  const model = getModel()

  const completion = await openai.chat.completions.create({
    model,
    temperature: 0,
    max_tokens: 1000,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: JSON_REPAIR_PROMPT,
      },
      {
        role: "user",
        content: cleanJsonCandidate(raw).slice(0, 14000),
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
    max_tokens: 900,
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
        textContent: snapshot.textContent.slice(0, 3800),
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
    const message = error instanceof Error ? error.message : "Erreur inconnue"
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