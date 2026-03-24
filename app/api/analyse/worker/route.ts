import OpenAI from "openai"
import { redis, updateJob } from "@/app/lib/redis"
import { takePageSnapshot, type PageBlock } from "@/app/lib/screenshot"

type AnnotationSeverity = "low" | "medium" | "high"

type AuditFindingSeverity = "Faible" | "Moyenne" | "Élevée" | "Critique"
type AuditFindingImpactLevel = "Faible" | "Moyen" | "Important" | "Très important"

type AuditFindingCategory =
  | "message"
  | "structure"
  | "trust"
  | "cta"
  | "ux"
  | "offer"
  | "friction"

type AuditFinding = {
  title: string
  category: AuditFindingCategory
  problem: string
  businessImpact: string
  missedOpportunity: string
  severity: AuditFindingSeverity
  impactLevel: AuditFindingImpactLevel
  conversionPotential: string
  strategicDirection: string
  whyNow: string
  targetId?: string
  targetText?: string
  targetType?: string
  confidence?: number
}

type AuditLLMResult = {
  score: number
  estimatedUplift: string
  summary: string
  strategicSummary: string
  missingRevenue: string
  missingRevenueRange?: {
    low: number
    high: number
    currency: string
    period: string
  }
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

type AuditReportResult = {
  success: boolean
  message: string
  url: string
  score: number
  summary: string
  strategicSummary: string
  missingRevenue: string
  missingRevenueRange?: {
    low: number
    high: number
    currency: string
    period: string
  }
  screenshotUrl: string
  annotations: Annotation[]
  quickWins: string[]
  estimatedUplift: string
  deliveryTime: string
  priorities: {
    clarity: number
    trust: number
    cta: number
  }
  findings: Array<{
    title: string
    category: AuditFindingCategory
    problem: string
    businessImpact: string
    missedOpportunity: string
    severity: AuditFindingSeverity
    impactLevel: AuditFindingImpactLevel
    conversionPotential: string
    strategicDirection: string
    whyNow: string
  }>
}

const SYSTEM_PROMPT = `
Tu es un consultant senior en CRO, UX, copywriting et stratégie de conversion.
Tu travailles comme une agence premium qui vend des audits et des refontes de landing pages.

Contexte business fondamental :
ce rapport n'est pas un audit complet.
C'est un pré-audit commercial.
Il doit être crédible, humain, stratégique, frustrant de manière utile, et orienté vente.
Il doit montrer les problèmes, montrer le potentiel, faire sentir le manque à gagner, mais sans donner le plan d'exécution détaillé.

Objectif :
- détecter les freins visibles à la conversion
- diversifier les critiques
- quantifier le potentiel par point
- donner une lecture business de la page
- pousser vers une suite logique avec une agence
- ne jamais donner une solution précise étape par étape

Angle attendu :
- parler comme un humain qui a déjà audité beaucoup de pages
- ton clair, direct, crédible, consultant
- les critiques doivent avoir une portée business, pas juste design
- l'analyse doit faire sentir que la page n'est pas "cassée" mais sous-performante

Règle de diversité obligatoire :
tu dois couvrir plusieurs catégories.
Tu dois produire 5 findings maximum, idéalement 5.
Tu dois répartir les findings sur ces axes :
- 1 problème de message, promesse ou offre perçue
- 1 problème de structure, hiérarchie ou ordre de lecture
- 1 problème de confiance, preuve ou réassurance
- 1 problème de passage à l'action, friction ou conversion
- 1 problème complémentaire lié à la lisibilité, densité, focus, cohérence visuelle ou compréhension

Interdictions absolues :
- pas plus d'un finding principalement centré sur le CTA, sauf problème critique évident
- pas de répétition du même problème reformulé
- pas de critique générique
- pas de recommandations opératoires détaillées
- pas de texte du type "mettre un bouton rouge", "ajouter 3 témoignages", "déplacer exactement tel bloc sous tel bloc"
- pas de checklist d'exécution
- pas de jargon inutile
- pas d'invention de texte ou de cible absente de la page

Tu peux donner une direction stratégique, jamais une recette détaillée.
La direction stratégique doit faire comprendre l'axe de correction sans livrer le travail complet.

Chaque finding doit comporter :
- un problème concret observé
- un impact business
- un manque à gagner ou opportunité perdue
- un potentiel de conversion plausible
- une direction stratégique non détaillée
- une raison business qui rend ce point prioritaire maintenant

Le rapport global doit aussi contenir :
- score global de la page
- potentiel global de conversion
- résumé standard
- résumé stratégique plus vendeur
- manque à gagner global
- quick wins formulés à haut niveau, sans mode d'emploi
- priorités chiffrées

Important :
le score doit refléter le niveau actuel de performance perçue de la landing page, pas sa qualité esthétique.
estimatedUplift doit être crédible, pas extravagant.
missingRevenue doit être exprimé comme un manque à gagner potentiel, même si c'est une fourchette prudente.
Si le contexte ne permet pas de chiffrage fiable, garde une formulation prudente.

Tu réponds uniquement en JSON valide compact sur une seule ligne.

Format attendu :
{
  "score": 0,
  "estimatedUplift": "+18% à +31%",
  "summary": "string",
  "strategicSummary": "string",
  "missingRevenue": "string",
  "missingRevenueRange": {
    "low": 0,
    "high": 0,
    "currency": "EUR",
    "period": "mois"
  },
  "quickWins": ["string", "string", "string", "string", "string"],
  "priorities": {
    "clarity": 0,
    "trust": 0,
    "cta": 0
  },
  "findings": [
    {
      "title": "string",
      "category": "message|structure|trust|cta|ux|offer|friction",
      "problem": "string",
      "businessImpact": "string",
      "missedOpportunity": "string",
      "severity": "Faible|Moyenne|Élevée|Critique",
      "impactLevel": "Faible|Moyen|Important|Très important",
      "conversionPotential": "+4% à +8%",
      "strategicDirection": "string",
      "whyNow": "string",
      "targetId": "target-1",
      "targetText": "texte précis ou quasi exact",
      "targetType": "headline|cta|form|pricing|testimonial|proof|faq|body|hero|section|input",
      "confidence": 0.91
    }
  ]
}

Règles complémentaires :
- quickWins doit rester haut niveau, pas trop actionnable
- strategicDirection doit orienter sans expliquer comment exécuter
- missingRevenue doit rester crédible et prudent
- targetId doit pointer vers un id existant si tu es sûr
- targetText doit reprendre le texte réel ou quasi exact
- confidence doit refléter ton vrai niveau de certitude
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

const WORKER_LOCK_TTL_SECONDS = 180
const SNAPSHOT_TIMEOUT_MS = 60000
const LLM_TIMEOUT_MS = 60000
const JSON_REPAIR_TIMEOUT_MS = 15000
const MAX_SERIALIZED_BLOCKS = 42
const MIN_VISIBLE_ANNOTATION_CONFIDENCE = 0.78
const MAX_VISIBLE_ANNOTATIONS = 4

function getWorkerLockKey(jobId: string) {
  return `audit:worker:lock:${jobId}`
}

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

async function acquireWorkerLock(jobId: string) {
  const locked = await redis.set(
    getWorkerLockKey(jobId),
    { startedAt: Date.now(), jobId },
    {
      nx: true,
      ex: WORKER_LOCK_TTL_SECONDS,
    }
  )

  return locked === "OK"
}

async function releaseWorkerLock(jobId: string) {
  await redis.del(getWorkerLockKey(jobId))
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

      if ((block as any).tagName) parts.push(`tag=${shortText((block as any).tagName, 40)}`)
      if ((block as any).role) parts.push(`role=${shortText((block as any).role, 40)}`)
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
Réalise un pré-audit CRO commercial de cette landing page.

URL : ${url}
Titre de page : ${pageTitle || "Non disponible"}
Meta description : ${metaDescription || "Non disponible"}
Contenu texte extrait : ${textContent || "Non disponible"}

Blocs visibles annotables disponibles :
${serializeBlocks(blocks)}

Mission :
- détecter les principaux freins visibles à la conversion
- hiérarchiser les problèmes
- estimer le niveau global de performance
- faire sentir l'écart entre le niveau actuel et le potentiel réel
- associer chaque finding à une cible réelle et précise quand c'est possible
- rester crédible comme un consultant humain
- ne jamais inventer une cible ni un texte qui n'existe pas visiblement sur la page

Rappels critiques :
- ce rapport doit vendre une suite logique, pas livrer l'intégralité du plan
- strategicDirection doit orienter sans expliquer précisément comment faire
- quickWins doit rester haut niveau
- missingRevenue doit être prudent mais tangible
- targetId doit pointer vers un id existant si tu es sûr
- targetText doit reprendre le texte réel ou quasi exact de la cible
- confidence doit refléter ton vrai niveau de certitude
`.trim()
}

function normalizeSeverity(severity: AuditFindingSeverity): AnnotationSeverity {
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

function parseCategory(value: unknown): AuditFindingCategory {
  if (
    value === "message" ||
    value === "structure" ||
    value === "trust" ||
    value === "cta" ||
    value === "ux" ||
    value === "offer" ||
    value === "friction"
  ) {
    return value
  }

  return "ux"
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
      ((block as any).ariaLabel as string) || "",
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

function buildAnnotationText(finding: AuditFinding) {
  return [
    finding.problem,
    finding.businessImpact,
    finding.missedOpportunity,
    `Direction : ${finding.strategicDirection}`,
  ]
    .filter(Boolean)
    .join(" ")
    .trim()
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
      text: buildAnnotationText(finding),
      x: fallback.x,
      y: fallback.y,
      severity: normalizeSeverity(finding.severity),
      upliftPercent: finding.conversionPotential || mapImpactLevelToUplift(finding.impactLevel),
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

  const usedTypes = new Set<string>()
  const usedCategories = new Set<AuditFindingCategory>()

  const deduped = validated.filter((item, index, array) => {
    const type = item.block.type
    const category = item.finding.category

    const duplicateByBlockOrTitle =
      array.findIndex((other) => {
        const sameBlock = other.block.id === item.block.id
        const sameTitle =
          normalizeForCompare(other.finding.title) ===
          normalizeForCompare(item.finding.title)

        return sameBlock || sameTitle
      }) !== index

    if (duplicateByBlockOrTitle) {
      return false
    }

    if (usedCategories.has(category) && category !== "ux") {
      return false
    }

    if (
      usedTypes.has(type) &&
      (type === "cta" || type === "headline" || type === "section")
    ) {
      return false
    }

    usedTypes.add(type)
    usedCategories.add(category)

    return true
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
    text: buildAnnotationText(item.finding),
    x: item.anchorX,
    y: item.anchorY,
    severity: normalizeSeverity(item.finding.severity),
    upliftPercent:
      item.finding.conversionPotential || mapImpactLevelToUplift(item.finding.impactLevel),
    impactLabel: item.finding.impactLevel.toLowerCase(),
  }))
}

function sanitizeMissingRevenueRange(value: unknown) {
  if (!value || typeof value !== "object") {
    return undefined
  }

  const raw = value as {
    low?: unknown
    high?: unknown
    currency?: unknown
    period?: unknown
  }

  const low = Math.max(0, Number(raw.low) || 0)
  const high = Math.max(low, Number(raw.high) || 0)
  const currency =
    typeof raw.currency === "string" && raw.currency.trim()
      ? raw.currency.trim().slice(0, 8)
      : "EUR"
  const period =
    typeof raw.period === "string" && raw.period.trim()
      ? raw.period.trim().slice(0, 24)
      : "mois"

  if (!low && !high) {
    return undefined
  }

  return { low, high, currency, period }
}

function sanitizeAuditResult(data: AuditLLMResult, blocks: PageBlock[]): AuditLLMResult {
  const validBlockIds = new Set(blocks.map((block) => block.id))

  const findings: AuditFinding[] = Array.isArray(data.findings)
    ? data.findings
        .slice(0, 5)
        .map((finding): AuditFinding => ({
          title: String(finding.title || "Point à surveiller").trim(),
          category: parseCategory(finding.category),
          problem: String(finding.problem || "").trim(),
          businessImpact: String(finding.businessImpact || "").trim(),
          missedOpportunity: String(finding.missedOpportunity || "").trim(),
          severity: parseSeverity(finding.severity),
          impactLevel: parseImpactLevel(finding.impactLevel),
          conversionPotential:
            typeof finding.conversionPotential === "string" && finding.conversionPotential.trim()
              ? finding.conversionPotential.trim()
              : mapImpactLevelToUplift(parseImpactLevel(finding.impactLevel)),
          strategicDirection: String(finding.strategicDirection || "").trim(),
          whyNow: String(finding.whyNow || "").trim(),
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
            (finding.problem ||
              finding.businessImpact ||
              finding.missedOpportunity ||
              finding.strategicDirection)
        )
    : []

  return {
    score: Math.max(0, Math.min(100, Number(data.score) || 0)),
    estimatedUplift:
      typeof data.estimatedUplift === "string" && data.estimatedUplift.trim()
        ? data.estimatedUplift.trim()
        : "+10% à +18%",
    summary:
      typeof data.summary === "string" && data.summary.trim()
        ? data.summary.trim()
        : "L'analyse montre plusieurs frictions visibles qui limitent la performance commerciale de la page.",
    strategicSummary:
      typeof data.strategicSummary === "string" && data.strategicSummary.trim()
        ? data.strategicSummary.trim()
        : "La page n'est pas incohérente, mais elle ne transforme pas assez bien l'attention en décision. Le potentiel existe déjà dans le trafic actuel.",
    missingRevenue:
      typeof data.missingRevenue === "string" && data.missingRevenue.trim()
        ? data.missingRevenue.trim()
        : "Une partie du trafic acquis ne se transforme pas en opportunité commerciale à cause de plusieurs frictions visibles.",
    missingRevenueRange: sanitizeMissingRevenueRange(data.missingRevenueRange),
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
    max_tokens: 1200,
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
    temperature: 0.15,
    max_tokens: 1600,
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

    lockAcquired = await acquireWorkerLock(jobId)

    if (!lockAcquired) {
      console.log(`[worker] duplicate ignored jobId=${jobId}`)

      return Response.json(
        {
          success: true,
          jobId,
          status: "processing",
          message: "Job déjà en cours",
        },
        { status: 202 }
      )
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
        textContent: snapshot.textContent.slice(0, 5000),
        blocks: snapshot.blocks,
      }),
      LLM_TIMEOUT_MS,
      "Analyse IA"
    )
    console.log(`[worker] llm done jobId=${jobId}`)

    await markProcessing(jobId)

    const annotations = buildAnnotations(audit.findings, snapshot.blocks)

    const result: AuditReportResult = {
      success: true,
      message: "Analyse terminée",
      url,
      score: audit.score,
      summary: audit.summary,
      strategicSummary: audit.strategicSummary,
      missingRevenue: audit.missingRevenue,
      missingRevenueRange: audit.missingRevenueRange,
      screenshotUrl: snapshot.screenshotUrl,
      annotations,
      quickWins: audit.quickWins,
      estimatedUplift: audit.estimatedUplift,
      deliveryTime: `${Math.max(1, Math.round((Date.now() - startedAt) / 1000))} secondes`,
      priorities: audit.priorities,
      findings: audit.findings.map((finding) => ({
        title: finding.title,
        category: finding.category,
        problem: finding.problem,
        businessImpact: finding.businessImpact,
        missedOpportunity: finding.missedOpportunity,
        severity: finding.severity,
        impactLevel: finding.impactLevel,
        conversionPotential: finding.conversionPotential,
        strategicDirection: finding.strategicDirection,
        whyNow: finding.whyNow,
      })),
    }

    console.log(
      `[worker] result sizes jobId=${jobId} screenshotChars=${snapshot.screenshotUrl.length} annotations=${annotations.length} findings=${audit.findings.length}`
    )

    await updateJob(jobId, {
      status: "done",
      result,
      error: undefined,
      updatedAt: Date.now(),
    })

    await redis.expire(`job:${jobId}`, 600)

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
    if (lockAcquired && jobId) {
      await releaseWorkerLock(jobId)
    }
  }
}