"use client"

import { useEffect, useMemo, useRef, useState } from "react"

type AnnotationSeverity = "low" | "medium" | "high"

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

type Priorities = {
  clarity?: number
  trust?: number
  cta?: number
}

type AnalyseResult = {
  success?: boolean
  message?: string
  url?: string
  error?: string
  score?: number
  summary?: string
  screenshotUrl?: string
  annotations?: Annotation[]
  quickWins?: string[]
  estimatedUplift?: string
  deliveryTime?: string
  priorities?: Priorities
}

type JobStatus = "queued" | "processing" | "done" | "error"

type JobResponse = {
  status: JobStatus
  url: string
  createdAt?: number
  updatedAt?: number
  result?: AnalyseResult
  error?: string
}

type DisplayAnnotation = Annotation & {
  displayX: number
  displayY: number
}

const loadingSteps = [
  {
    title: "Analyse démarrée",
    text: "Nous préparons l'audit de ta landing page.",
  },
  {
    title: "Lecture de la page",
    text: "Nous examinons la structure, le message et les leviers de conversion.",
  },
  {
    title: "Capture complète",
    text: "Nous générons une vue nette pour repérer les zones qui freinent l'action.",
  },
  {
    title: "Détection des frictions",
    text: "Nous identifions ce qui réduit la clarté, la confiance et le passage à l'action.",
  },
  {
    title: "Finalisation du rapport",
    text: "Nous préparons l'affichage final avec les priorités de correction.",
  },
]

const demoProblems = [
  {
    label: "Promesse trop floue",
    text: "Le visiteur ne comprend pas assez vite pourquoi ton offre mérite son attention.",
  },
  {
    label: "CTA trop faible",
    text: "L'action à faire n'occupe pas assez l'espace visuel et mental.",
  },
  {
    label: "Réassurance insuffisante",
    text: "La page ne donne pas assez de raisons de croire, donc elle ralentit la décision.",
  },
]

const socialProof = [
  {
    quote:
      "On a gardé le même trafic. Le nombre de leads a bondi après la refonte.",
    author: "Thomas, agence B2B",
    result: "+87% de leads",
  },
  {
    quote:
      "Avant, notre page était propre. Après optimisation, elle a enfin commencé à vendre.",
    author: "Julie, infopreneure",
    result: "x2 sur les conversions",
  },
  {
    quote:
      "Le gain ne venait pas d'un détail. Il venait de la structure complète de la page.",
    author: "Amine, e-commerce",
    result: "trafic mieux rentabilisé",
  },
]

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function spreadAnnotations(annotations: Annotation[]) {
  if (!annotations.length) {
    return []
  }

  const sorted = [...annotations].sort((a, b) => {
    if (a.y === b.y) {
      return a.x - b.x
    }
    return a.y - b.y
  })

  const placed: DisplayAnnotation[] = []

  for (const annotation of sorted) {
    let displayX = clamp(annotation.x, 6, 94)
    let displayY = clamp(annotation.y, 4, 96)
    let attempts = 0

    while (attempts < 20) {
      const colliding = placed.filter((item) => {
        const dx = Math.abs(item.displayX - displayX)
        const dy = Math.abs(item.displayY - displayY)
        return dx < 12 && dy < 9
      })

      if (!colliding.length) {
        break
      }

      const shiftPattern = [
        { x: 10, y: 0 },
        { x: -10, y: 0 },
        { x: 7, y: 6 },
        { x: -7, y: 6 },
        { x: 7, y: -6 },
        { x: -7, y: -6 },
        { x: 14, y: 4 },
        { x: -14, y: 4 },
        { x: 0, y: 8 },
        { x: 0, y: -8 },
        { x: 12, y: -7 },
        { x: -12, y: -7 },
      ]

      const shift = shiftPattern[attempts % shiftPattern.length]
      displayX = clamp(annotation.x + shift.x, 6, 94)
      displayY = clamp(annotation.y + shift.y, 4, 96)
      attempts += 1
    }

    placed.push({
      ...annotation,
      displayX,
      displayY,
    })
  }

  return annotations.map((annotation) => {
    const positioned = placed.find((item) => item.id === annotation.id)

    return (
      positioned || {
        ...annotation,
        displayX: clamp(annotation.x, 6, 94),
        displayY: clamp(annotation.y, 4, 96),
      }
    )
  })
}

function getAnnotationUplift(annotation: Annotation) {
  if (annotation.upliftPercent) {
    return annotation.upliftPercent
  }

  if (annotation.severity === "high") {
    return "+12% à +18%"
  }

  if (annotation.severity === "medium") {
    return "+6% à +10%"
  }

  return "+2% à +5%"
}

function getSeverityLabel(severity: AnnotationSeverity) {
  if (severity === "high") return "impact fort"
  if (severity === "medium") return "impact moyen"
  return "impact faible"
}

function getSeverityClasses(severity: AnnotationSeverity, active: boolean) {
  if (severity === "high") {
    return active
      ? "border-[#ff6b57] bg-[#ff6b57] text-white shadow-[0_0_0_12px_rgba(255,107,87,0.22)]"
      : "border-white bg-[#ff6b57] text-white shadow-[0_0_0_10px_rgba(255,107,87,0.16)]"
  }

  if (severity === "medium") {
    return active
      ? "border-[#d9a14a] bg-[#d9a14a] text-black shadow-[0_0_0_12px_rgba(217,161,74,0.22)]"
      : "border-white bg-[#d9a14a] text-black shadow-[0_0_0_10px_rgba(217,161,74,0.16)]"
  }

  return active
    ? "border-[#7db487] bg-[#7db487] text-black shadow-[0_0_0_12px_rgba(125,180,135,0.22)]"
    : "border-white bg-[#7db487] text-black shadow-[0_0_0_10px_rgba(125,180,135,0.16)]"
}

function getLoadingStep(progress: number) {
  const index = Math.min(loadingSteps.length - 1, Math.floor(progress / 20))
  return loadingSteps[index]
}

function hasRenderableResultVisual(result: AnalyseResult | null) {
  if (!result || result.error) {
    return false
  }

  return Boolean(result.screenshotUrl)
}

function preloadImage(src: string) {
  return new Promise<void>((resolve, reject) => {
    const image = new window.Image()

    image.onload = async () => {
      try {
        if ("decode" in image) {
          await image.decode()
        }
      } catch {}

      resolve()
    }

    image.onerror = () => reject(new Error("Impossible de charger l'image"))
    image.src = src
  })
}

function getProgressTarget(params: {
  elapsedMs: number
  jobStatus: JobStatus | null
  isFinalizingVisual: boolean
}) {
  const { elapsedMs, jobStatus, isFinalizingVisual } = params
  const elapsedSeconds = elapsedMs / 1000

  if (isFinalizingVisual || jobStatus === "done") {
    return 99
  }

  if (jobStatus === "queued") {
    return Math.min(18, 6 + elapsedSeconds * 1.15)
  }

  if (jobStatus === "processing") {
    if (elapsedSeconds <= 8) {
      return 18 + elapsedSeconds * 4.2
    }

    if (elapsedSeconds <= 20) {
      return 51.6 + (elapsedSeconds - 8) * 1.9
    }

    if (elapsedSeconds <= 40) {
      return 74.4 + (elapsedSeconds - 20) * 0.72
    }

    if (elapsedSeconds <= 65) {
      return 88.8 + (elapsedSeconds - 40) * 0.18
    }

    return 93.3
  }

  return Math.min(14, 5 + elapsedSeconds * 0.9)
}

function getPollDelay(status: JobStatus | null, hadVisualGap: boolean) {
  if (status === "queued") {
    return 900
  }

  if (status === "processing") {
    return hadVisualGap ? 450 : 700
  }

  if (status === "done") {
    return 250
  }

  return 1000
}

function getAnnotationCardPosition(annotation: DisplayAnnotation) {
  const verticalClass =
    annotation.displayY > 74 ? "bottom-[calc(100%+18px)]" : "top-[calc(100%+18px)]"

  let horizontalClass = "-translate-x-1/2"

  if (annotation.displayX <= 18) {
    horizontalClass = "translate-x-0"
  } else if (annotation.displayX >= 82) {
    horizontalClass = "-translate-x-full"
  }

  return {
    verticalClass,
    horizontalClass,
  }
}

export default function Home() {
  const [url, setUrl] = useState("")
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [jobId, setJobId] = useState<string | null>(null)
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null)
  const [result, setResult] = useState<AnalyseResult | null>(null)
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null)
  const [scrollY, setScrollY] = useState(0)
  const [screenshotLoaded, setScreenshotLoaded] = useState(false)
  const [resultEntered, setResultEntered] = useState(false)
  const [isFinalizingVisual, setIsFinalizingVisual] = useState(false)

  const resultSectionRef = useRef<HTMLElement | null>(null)
  const loadingStartedAtRef = useRef<number>(0)

  const annotations = result?.annotations ?? []

  const displayAnnotations = useMemo(() => {
    return spreadAnnotations(annotations)
  }, [annotations])

  useEffect(() => {
    const onScroll = () => setScrollY(window.scrollY)
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  useEffect(() => {
    const resultRevealElements = Array.from(
      document.querySelectorAll<HTMLElement>("[data-reveal-result]")
    )

    if (resultRevealElements.length) {
      resultRevealElements.forEach((element) => {
        element.classList.add("is-visible")
      })
    }

    const elements = Array.from(
      document.querySelectorAll<HTMLElement>("[data-reveal]")
    )

    if (!elements.length) return

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible")
            observer.unobserve(entry.target)
          }
        })
      },
      {
        threshold: 0.12,
        rootMargin: "0px 0px -8% 0px",
      }
    )

    elements.forEach((element) => {
      if (element.hasAttribute("data-reveal-result")) {
        element.classList.add("is-visible")
        return
      }

      observer.observe(element)
    })

    return () => observer.disconnect()
  }, [loading, result, screenshotLoaded])

  useEffect(() => {
    if (!displayAnnotations.length) {
      setActiveAnnotationId(null)
      return
    }

    if (!activeAnnotationId) {
      setActiveAnnotationId(displayAnnotations[0]?.id ?? null)
      return
    }

    const exists = displayAnnotations.some(
      (annotation) => annotation.id === activeAnnotationId
    )

    if (!exists) {
      setActiveAnnotationId(displayAnnotations[0]?.id ?? null)
    }
  }, [displayAnnotations, activeAnnotationId])

  const activeAnnotation = useMemo(() => {
    if (!displayAnnotations.length || !activeAnnotationId) {
      return null
    }

    return (
      displayAnnotations.find((annotation) => annotation.id === activeAnnotationId) ??
      null
    )
  }, [displayAnnotations, activeAnnotationId])

  useEffect(() => {
    if (!loading) {
      return
    }

    const interval = window.setInterval(() => {
      const elapsedMs = Date.now() - loadingStartedAtRef.current
      const target = getProgressTarget({
        elapsedMs,
        jobStatus,
        isFinalizingVisual,
      })

      setProgress((current) => {
        if (jobStatus === "done" || isFinalizingVisual) {
          return Math.max(current, Math.min(target, 99))
        }

        const gap = Math.max(0, target - current)

        if (gap <= 0.25) {
          return current
        }

        const step = gap > 18 ? 1.4 : gap > 10 ? 1 : gap > 5 ? 0.7 : 0.35
        return Number(Math.min(current + step, target).toFixed(2))
      })
    }, 120)

    return () => window.clearInterval(interval)
  }, [loading, jobStatus, isFinalizingVisual])

  useEffect(() => {
    if (!jobId || !loading) {
      return
    }

    let stopped = false
    let timeoutId: number | null = null
    let hadVisualGap = false

    const clearScheduledPoll = () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
        timeoutId = null
      }
    }

    const finishWithError = (message: string) => {
      if (stopped) {
        return
      }

      setResult({ error: message })
      setJobStatus("error")
      setIsFinalizingVisual(false)
      setLoading(false)
      clearScheduledPoll()
    }

    const applyFinalResult = async (nextResult: AnalyseResult) => {
      if (stopped) {
        return
      }

      const visualReady = hasRenderableResultVisual(nextResult)

      if (visualReady && nextResult.screenshotUrl) {
        setIsFinalizingVisual(true)

        try {
          await preloadImage(nextResult.screenshotUrl)
          if (stopped) {
            return
          }
          setScreenshotLoaded(true)
        } catch {
          if (stopped) {
            return
          }
          setScreenshotLoaded(false)
        }
      } else {
        setScreenshotLoaded(false)
      }

      if (stopped) {
        return
      }

      setResult(nextResult)
      setProgress(100)
      setIsFinalizingVisual(false)
      setLoading(false)
      clearScheduledPoll()
    }

    const scheduleNextPoll = (status: JobStatus | null) => {
      clearScheduledPoll()
      const delay = getPollDelay(status, hadVisualGap)
      timeoutId = window.setTimeout(() => {
        void poll()
      }, delay)
    }

    const poll = async () => {
      try {
        const response = await fetch(`/api/analyse/status?jobId=${jobId}`, {
          method: "GET",
          cache: "no-store",
        })

        const data = await response.json()

        if (!response.ok) {
          finishWithError(data.error || "Erreur lors du suivi du job")
          return
        }

        const job: JobResponse = data.job
        setJobStatus(job.status)

        if (job.status === "done") {
          const nextResult = job.result ?? { error: "Résultat introuvable" }
          const visualReady = hasRenderableResultVisual(nextResult)

          if (!visualReady) {
            hadVisualGap = true
            scheduleNextPoll(job.status)
            return
          }

          await applyFinalResult(nextResult)
          return
        }

        if (job.status === "error") {
          finishWithError(job.error || "Erreur pendant l'analyse")
          return
        }

        scheduleNextPoll(job.status)
      } catch {
        finishWithError("Erreur lors du suivi du job")
      }
    }

    void poll()

    return () => {
      stopped = true
      clearScheduledPoll()
    }
  }, [jobId, loading])

  useEffect(() => {
    if (!result || result.error) {
      setScreenshotLoaded(false)
      setResultEntered(false)
      return
    }

    setResultEntered(true)
  }, [result])

  const isResultVisualReady = Boolean(
    result &&
      !result.error &&
      (!result.screenshotUrl || screenshotLoaded)
  )

  useEffect(() => {
    if (!isResultVisualReady || loading || !resultSectionRef.current) {
      return
    }

    const scrollToResult = () => {
      const rect = resultSectionRef.current?.getBoundingClientRect()

      if (!rect) {
        return
      }

      const top = window.scrollY + rect.top - 24

      window.scrollTo({
        top,
        behavior: "smooth",
      })
    }

    const frame1 = window.requestAnimationFrame(() => {
      const frame2 = window.requestAnimationFrame(() => {
        scrollToResult()
      })

      return () => window.cancelAnimationFrame(frame2)
    })

    return () => window.cancelAnimationFrame(frame1)
  }, [isResultVisualReady, loading])

  async function handleAnalyse() {
    if (!url.trim()) {
      setResult({ error: "Entre une URL valide" })
      return
    }

    try {
      loadingStartedAtRef.current = Date.now()
      setLoading(true)
      setProgress(6)
      setResult(null)
      setJobId(null)
      setJobStatus("queued")
      setActiveAnnotationId(null)
      setScreenshotLoaded(false)
      setResultEntered(false)
      setIsFinalizingVisual(false)

      const response = await fetch("/api/analyse", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url }),
      })

      const data = await response.json()

      if (!response.ok) {
        setResult({ error: data.error || "Erreur lors du lancement de l'analyse" })
        setLoading(false)
        return
      }

      setJobId(data.jobId)
      setJobStatus(data.status ?? "queued")
    } catch {
      setResult({ error: "Erreur lors du lancement de l'analyse" })
      setLoading(false)
    }
  }

  function toggleAnnotation(annotationId: string) {
    setActiveAnnotationId((current) => {
      if (current === annotationId) {
        return null
      }

      return annotationId
    })
  }

  const currentLoadingStep = getLoadingStep(progress)
  const shouldShowResult = Boolean(result && !result.error && !loading && isResultVisualReady)

  return (
    <>
      <main className="min-h-screen overflow-x-hidden bg-[#f3ede4] text-black">
        <div className="pointer-events-none fixed inset-0 opacity-[0.58]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(0,0,0,0.05),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(0,0,0,0.06),transparent_28%)]" />
          <div className="grain absolute inset-0" />
          <div
            className="absolute inset-0 opacity-70"
            style={{
              transform: `translateY(${scrollY * 0.08}px)`,
              background:
                "linear-gradient(120deg, rgba(212,177,115,0.08), transparent 28%, rgba(46,204,255,0.05) 62%, transparent 85%)",
            }}
          />
        </div>

        <section className="relative overflow-hidden border-b border-black/8 bg-[#0f0f10] text-white">
          <div className="hero-grid absolute inset-0 opacity-60" />
          <div className="hero-orb hero-orb-1" />
          <div className="hero-orb hero-orb-2" />
          <div
            className="hero-orb hero-orb-3"
            style={{ transform: `translate3d(0, ${scrollY * 0.06}px, 0)` }}
          />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.08),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(212,177,115,0.12),transparent_22%)]" />

          <div className="relative mx-auto max-w-[1720px] px-4 py-5 md:px-8 xl:px-10">
            <div
              data-reveal
              className="reveal flex items-center justify-between gap-4"
            >
              <a
                href="https://clickway.fr"
                target="_blank"
                rel="noreferrer"
                className="group inline-flex items-center rounded-full border border-white/12 bg-white/8 px-4 py-2 text-[12px] font-semibold uppercase tracking-[0.16em] text-white/88 transition duration-300 hover:-translate-y-0.5 hover:bg-white/12 hover:shadow-[0_10px_30px_rgba(255,255,255,0.08)]"
              >
                <span className="relative">
                  Clickway
                  <span className="absolute inset-x-0 -bottom-1 h-px scale-x-0 bg-white/70 transition duration-300 group-hover:scale-x-100" />
                </span>
              </a>

              <div className="hidden rounded-full border border-white/10 bg-white/5 px-4 py-2 text-[12px] font-semibold uppercase tracking-[0.16em] text-white/60 md:block">
                Audit CRO premium
              </div>
            </div>

            <div className="grid items-end gap-10 pb-12 pt-14 md:pb-16 md:pt-20 xl:grid-cols-[1.18fr_0.82fr] xl:gap-14 xl:pb-20">
              <div className="max-w-5xl">
                <div
                  data-reveal
                  className="reveal mb-6 flex flex-wrap gap-3"
                >
                  <div className="glass-chip">
                    Audit offert
                  </div>
                  <div className="glass-chip">
                    Analyse instantanée
                  </div>
                  <div className="glass-chip">
                    Frictions visibles
                  </div>
                </div>

                <div data-reveal className="reveal">
                  <h1 className="hero-title max-w-6xl text-[44px] font-semibold leading-[0.92] tracking-[-0.05em] text-white md:text-[78px] xl:text-[106px]">
                    Ta landing convertit mal ?
                    <br />
                    Voilà pourquoi.
                  </h1>

                  <p className="mt-6 max-w-3xl text-base leading-8 text-white/68 md:text-xl">
                    Colle ton URL. En quelques secondes, tu vois ce qui freine la conversion,
                    gaspille ton trafic et bloque la prise de décision.
                  </p>
                </div>

                <div
                  data-reveal
                  className="reveal mt-8 max-w-4xl rounded-[32px] border border-white/12 bg-white/8 p-4 shadow-[0_30px_100px_rgba(0,0,0,0.22)] backdrop-blur-xl md:p-5"
                >
                  <div className="pointer-events-none absolute inset-0 rounded-[32px] bg-[linear-gradient(135deg,rgba(255,255,255,0.08),transparent_35%,rgba(46,204,255,0.06)_70%,transparent)]" />
                  <div className="relative flex flex-col gap-4 md:flex-row">
                    <input
                      type="text"
                      placeholder="https://tonsite.com"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      className="field-glow h-14 w-full rounded-2xl border border-white/10 bg-white/95 px-5 text-base text-black outline-none transition placeholder:text-black/35 focus:border-[#2ecbff]/35 focus:ring-4 focus:ring-[#2ecbff]/12"
                    />

                    <button
                      onClick={handleAnalyse}
                      disabled={loading}
                      className="cta-primary inline-flex h-14 min-w-[240px] items-center justify-center rounded-2xl px-6 text-base font-semibold text-black transition disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {loading ? "Analyse en cours..." : "Analyser ma landing page"}
                    </button>
                  </div>

                  <div className="relative mt-4 flex flex-wrap items-center gap-3 text-sm text-white/62">
                    <span className="mini-chip">Gratuit</span>
                    <span className="mini-chip">Rapide</span>
                    <span className="mini-chip">Sans engagement</span>
                  </div>

                  <div className="relative mt-4 grid gap-3 md:grid-cols-3">
                    <div className="feature-chip">
                      Révèle les pertes invisibles
                    </div>
                    <div className="feature-chip">
                      Montre les points qui bloquent l'action
                    </div>
                    <div className="feature-chip">
                      Donne une direction claire
                    </div>
                  </div>

                  {result?.error && !loading && (
                    <div className="relative mt-5 rounded-2xl border border-red-300/30 bg-red-500/10 px-4 py-4 text-sm text-red-100">
                      {result.error}
                    </div>
                  )}
                </div>
              </div>

              <div className="relative">
                <div className="absolute -left-6 top-8 h-24 w-24 rounded-full bg-[#d4b173]/18 blur-3xl" />
                <div className="absolute bottom-6 right-0 h-32 w-32 rounded-full bg-white/10 blur-3xl" />

                <div
                  data-reveal
                  className="reveal relative rounded-[34px] border border-white/12 bg-white/[0.06] p-4 shadow-[0_40px_120px_rgba(0,0,0,0.25)] backdrop-blur-xl"
                >
                  <div className="shine-card rounded-[28px] border border-white/10 bg-[#f3ede4] p-4 text-black">
                    <div className="mb-4 flex items-center justify-between gap-3 rounded-[20px] border border-black/8 bg-white px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="h-3 w-3 rounded-full bg-[#ff6b57]" />
                        <span className="h-3 w-3 rounded-full bg-[#d9a14a]" />
                        <span className="h-3 w-3 rounded-full bg-[#7db487]" />
                      </div>
                      <span className="text-xs font-medium text-black/45">
                        Aperçu du diagnostic
                      </span>
                    </div>

                    <div className="rounded-[24px] border border-black/8 bg-[#111111] p-5 text-white">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/45">
                        En une analyse
                      </p>
                      <h2 className="mt-3 text-2xl font-semibold leading-tight">
                        Tu vois ce qui te coûte des clics, des leads et des ventes.
                      </h2>

                      <div className="mt-6 grid gap-3">
                        <div className="tilt-card rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                          <p className="text-sm font-semibold">URL</p>
                          <p className="mt-1 text-sm text-white/62">
                            Tu colles ta page.
                          </p>
                        </div>
                        <div className="tilt-card rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                          <p className="text-sm font-semibold">Diagnostic</p>
                          <p className="mt-1 text-sm text-white/62">
                            Tu récupères les frictions et les priorités.
                          </p>
                        </div>
                        <div className="tilt-card rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                          <p className="text-sm font-semibold">Suite logique</p>
                          <p className="mt-1 text-sm text-white/62">
                            Tu comprends quoi corriger en premier.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="relative mx-auto max-w-[1900px] px-4 py-8 md:px-8 md:py-10 xl:px-10">
          {!result && !loading && (
            <>
              <section className="mt-4">
                <div className="grid gap-6 xl:grid-cols-3">
                  <div
                    data-reveal
                    className="reveal section-card rounded-[32px] border border-black/10 bg-white p-6 shadow-[0_20px_60px_rgba(0,0,0,0.06)]"
                  >
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-black/42">
                      Comment ça marche
                    </p>
                    <h2 className="mt-3 text-2xl font-semibold leading-tight">
                      Un mini outil pour révéler les blocages avant qu'ils ne te coûtent plus cher.
                    </h2>
                    <p className="mt-4 text-sm leading-7 text-black/68">
                      Tu entres ton URL. L'outil analyse la hiérarchie, le message, la clarté, la réassurance et l'action attendue.
                    </p>
                  </div>

                  <div
                    data-reveal
                    className="reveal section-card rounded-[32px] border border-black/10 bg-[#faf6f0] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.05)]"
                  >
                    <div className="flex items-center gap-3">
                      <div className="step-badge flex h-10 w-10 items-center justify-center rounded-full bg-black text-sm font-semibold text-white">
                        1
                      </div>
                      <p className="text-lg font-semibold">Tu colles ton URL</p>
                    </div>
                    <p className="mt-4 text-sm leading-7 text-black/66">
                      Quelques secondes suffisent pour lancer l'analyse.
                    </p>
                  </div>

                  <div
                    data-reveal
                    className="reveal section-card rounded-[32px] border border-black/10 bg-[#faf6f0] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.05)]"
                  >
                    <div className="flex items-center gap-3">
                      <div className="step-badge flex h-10 w-10 items-center justify-center rounded-full bg-black text-sm font-semibold text-white">
                        2
                      </div>
                      <p className="text-lg font-semibold">Tu reçois un diagnostic</p>
                    </div>
                    <p className="mt-4 text-sm leading-7 text-black/66">
                      Frictions détectées, conséquences business et axes de correction.
                    </p>
                  </div>
                </div>
              </section>

              <section className="mt-8">
                <div className="grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
                  <div
                    data-reveal
                    className="reveal section-card rounded-[36px] border border-black/10 bg-white p-6 shadow-[0_24px_80px_rgba(0,0,0,0.08)] md:p-8"
                  >
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-black/42">
                      Ce qui se passe sur la plupart des pages
                    </p>
                    <h2 className="mt-3 max-w-3xl text-3xl font-semibold leading-tight tracking-[-0.03em] md:text-4xl">
                      Le problème n'est pas toujours le trafic.
                      Le problème, c'est ce que ta page en fait.
                    </h2>
                    <p className="mt-5 max-w-4xl text-base leading-8 text-black/68 md:text-lg">
                      Beaucoup de pages ont l'air correctes. Pourtant elles perdent des ventes sur des points simples à repérer et coûteux à ignorer.
                    </p>

                    <div className="mt-8 grid gap-4 md:grid-cols-3">
                      <div className="soft-panel rounded-[24px] border border-black/8 bg-[#faf6f0] p-5">
                        <p className="text-sm font-semibold text-black">Promesse trop vague</p>
                        <p className="mt-2 text-sm leading-6 text-black/64">
                          Le visiteur comprend mal l'offre dans les premières secondes.
                        </p>
                      </div>
                      <div className="soft-panel rounded-[24px] border border-black/8 bg-[#faf6f0] p-5">
                        <p className="text-sm font-semibold text-black">CTA trop discret</p>
                        <p className="mt-2 text-sm leading-6 text-black/64">
                          L'action principale n'occupe pas assez l'attention.
                        </p>
                      </div>
                      <div className="soft-panel rounded-[24px] border border-black/8 bg-[#faf6f0] p-5">
                        <p className="text-sm font-semibold text-black">Réassurance trop faible</p>
                        <p className="mt-2 text-sm leading-6 text-black/64">
                          La page donne trop peu de raisons de croire et d'agir.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div
                    data-reveal
                    className="reveal dark-panel rounded-[36px] border border-black/10 bg-[#111111] p-6 text-white shadow-[0_24px_80px_rgba(0,0,0,0.14)] md:p-8"
                  >
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40">
                      Tension utile
                    </p>
                    <h3 className="mt-3 text-3xl font-semibold leading-tight">
                      90 % des landing pages laissent de l'argent sur la table.
                    </h3>
                    <p className="mt-5 text-base leading-8 text-white/68">
                      L'analyse sert à mettre ce manque en face de toi sans te noyer dans le technique.
                    </p>

                    <div className="mt-8 space-y-4">
                      <div className="dark-tile rounded-[22px] border border-white/10 bg-white/5 p-4">
                        <p className="text-sm font-semibold">Tu dépenses pour attirer du trafic</p>
                        <p className="mt-2 text-sm leading-6 text-white/62">
                          Mais la page ne transforme pas assez cette attention en action.
                        </p>
                      </div>

                      <div className="dark-tile rounded-[22px] border border-white/10 bg-white/5 p-4">
                        <p className="text-sm font-semibold">Tu crois que la page est correcte</p>
                        <p className="mt-2 text-sm leading-6 text-white/62">
                          Alors qu'elle freine la décision à plusieurs endroits en même temps.
                        </p>
                      </div>

                      <div className="dark-tile rounded-[22px] border border-white/10 bg-white/5 p-4">
                        <p className="text-sm font-semibold">Tu perds sans le voir</p>
                        <p className="mt-2 text-sm leading-6 text-white/62">
                          Et c'est précisément ce qui coûte le plus cher.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              <section className="mt-8">
                <div
                  data-reveal
                  className="reveal section-card rounded-[36px] border border-black/10 bg-white p-6 shadow-[0_24px_80px_rgba(0,0,0,0.08)] md:p-8"
                >
                  <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-black/42">
                        Exemple de résultat
                      </p>
                      <h2 className="mt-2 text-2xl font-semibold md:text-4xl">
                        Voilà ce qu'un bon diagnostic fait apparaître tout de suite.
                      </h2>
                    </div>

                    <div className="rounded-full border border-black/10 bg-[#faf6f0] px-4 py-2 text-sm text-black/64">
                      Frictions. Conséquences. Priorités.
                    </div>
                  </div>

                  <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
                    <div className="dark-panel rounded-[30px] border border-black/10 bg-[#111111] p-6 text-white">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/40">
                        Diagnostic
                      </p>

                      <h3 className="mt-4 text-3xl font-semibold leading-tight">
                        La page n'est pas cassée.
                        Elle manque surtout de force aux endroits qui déclenchent l'action.
                      </h3>

                      <p className="mt-5 text-sm leading-7 text-white/66">
                        Tu ne cherches pas un joli rapport. Tu cherches les blocages qui font perdre des leads sur le trafic actuel.
                      </p>

                      <div className="dark-tile mt-6 rounded-[22px] border border-white/10 bg-white/5 p-4">
                        <p className="text-sm font-semibold">Conséquences concrètes</p>
                        <div className="mt-3 space-y-2 text-sm leading-6 text-white/62">
                          <p>Moins de conversions sur le trafic actuel</p>
                          <p>Campagnes rentables plus difficiles à scaler</p>
                          <p>Offre moins forte dans l'esprit du visiteur</p>
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-3">
                      {demoProblems.map((item) => (
                        <div
                          key={item.label}
                          className="soft-panel rounded-[28px] border border-black/10 bg-[#faf6f0] p-5"
                        >
                          <div className="inline-flex rounded-full bg-black px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-white">
                            Point bloquant
                          </div>
                          <h3 className="mt-4 text-xl font-semibold leading-tight">
                            {item.label}
                          </h3>
                          <p className="mt-3 text-sm leading-7 text-black/66">
                            {item.text}
                          </p>
                        </div>
                      ))}

                      <div className="soft-panel rounded-[28px] border border-[#d4b173]/40 bg-[#f2e7d6] p-5 md:col-span-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-black/46">
                          Révélation
                        </p>
                        <h3 className="mt-3 text-2xl font-semibold leading-tight text-black">
                          Ta landing page n'est pas mauvaise. Elle est sous-optimisée.
                        </h3>
                        <p className="mt-3 max-w-4xl text-sm leading-7 text-black/68">
                          Et c'est ce qui rend le problème dangereux. Elle paraît correcte, donc tu repousses la vraie correction alors qu'elle te coûte déjà des résultats.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            </>
          )}

          {shouldShowResult && (
            <section ref={resultSectionRef} className="mt-6">
              <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.72fr)_390px]">
                <div className="min-w-0">
                  <div
                    data-reveal
                    data-reveal-result
                    className="reveal mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between"
                  >
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-black/42">
                        Capture analysée
                      </p>
                      <h2 className="mt-2 max-w-4xl text-3xl font-semibold leading-tight tracking-[-0.03em] md:text-5xl">
                        Voilà où ta landing page perd des conversions.
                      </h2>
                    </div>

                    <div className="flex flex-wrap gap-3">
                      <div className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm text-black/64 shadow-sm">
                        {displayAnnotations.length} friction{displayAnnotations.length > 1 ? "s" : ""} détectée{displayAnnotations.length > 1 ? "s" : ""}
                      </div>

                      {result?.deliveryTime && (
                        <div className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm text-black/64 shadow-sm">
                          Rapport généré en {result.deliveryTime}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="xl:hidden">
                    <div
                      data-reveal
                      data-reveal-result
                      className="reveal mb-6"
                    >
                      <div className="sticky top-4 z-40">
                        <aside className="dark-panel rounded-[36px] border border-black/10 bg-[#111111] p-5 text-white shadow-[0_28px_100px_rgba(0,0,0,0.18)]">
                          <div className="mb-5">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40">
                              Priorités
                            </p>
                            <h3 className="mt-2 text-2xl font-semibold leading-tight">
                              Les points qui freinent le plus ta page.
                            </h3>
                          </div>

                          <div className="max-h-[34vh] overflow-y-auto pr-1">
                            <div className="space-y-3">
                              {displayAnnotations.map((annotation, index) => {
                                const isActive = activeAnnotationId === annotation.id

                                return (
                                  <button
                                    key={annotation.id}
                                    type="button"
                                    onClick={() => toggleAnnotation(annotation.id)}
                                    className={`w-full rounded-[24px] border p-4 text-left transition ${
                                      isActive
                                        ? "border-white/20 bg-white/10 text-white"
                                        : "border-white/8 bg-white/5 text-white hover:border-white/14 hover:bg-white/[0.08]"
                                    }`}
                                  >
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="flex items-start gap-3">
                                        <div
                                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                                            annotation.severity === "high"
                                              ? "bg-[#ff6b57] text-white"
                                              : annotation.severity === "medium"
                                              ? "bg-[#d9a14a] text-black"
                                              : "bg-[#7db487] text-black"
                                          }`}
                                        >
                                          {index + 1}
                                        </div>

                                        <div>
                                          <p className="text-sm font-semibold">
                                            {annotation.title}
                                          </p>
                                          <p className="mt-1 text-xs text-white/52">
                                            {annotation.impactLabel || getSeverityLabel(annotation.severity)}
                                          </p>
                                        </div>
                                      </div>

                                      <div className="rounded-full bg-white/8 px-2 py-1 text-[11px] font-semibold text-white/74">
                                        {getAnnotationUplift(annotation)}
                                      </div>
                                    </div>
                                  </button>
                                )
                              })}
                            </div>
                          </div>

                          {activeAnnotation && (
                            <div className="mt-5 rounded-[24px] border border-white/10 bg-white/5 p-4">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/38">
                                Détail actif
                              </p>
                              <h4 className="mt-2 text-lg font-semibold">
                                {activeAnnotation.title}
                              </h4>
                              <div className="mt-3 max-h-[22vh] overflow-y-auto pr-1">
                                <p className="text-sm leading-6 text-white/64">
                                  {activeAnnotation.text}
                                </p>
                              </div>
                            </div>
                          )}
                        </aside>
                      </div>
                    </div>
                  </div>

                  <div
                    data-reveal
                    data-reveal-result
                    className="reveal section-card rounded-[36px] border border-black/10 bg-white p-3 shadow-[0_28px_100px_rgba(0,0,0,0.08)] md:p-4"
                  >
                    <div className="mb-3 flex items-center justify-between gap-3 rounded-[22px] border border-black/8 bg-[#faf6f0] px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="h-3 w-3 rounded-full bg-[#ff6b57]" />
                        <span className="h-3 w-3 rounded-full bg-[#d9a14a]" />
                        <span className="h-3 w-3 rounded-full bg-[#7db487]" />
                      </div>

                      <p className="truncate text-sm text-black/52">
                        {result?.url}
                      </p>
                    </div>

                    <div className="relative overflow-visible rounded-[30px] border border-black/8 bg-[#ece1cf]">
                      <div className="overflow-hidden rounded-[30px]">
                        {result?.screenshotUrl ? (
                          <img
                            src={result.screenshotUrl}
                            alt="Screenshot landing page"
                            className={`block h-auto w-full transition duration-500 ${
                              screenshotLoaded ? "opacity-100" : "opacity-0"
                            }`}
                            loading="eager"
                            decoding="async"
                            onLoad={() => setScreenshotLoaded(true)}
                            onError={() => setScreenshotLoaded(false)}
                          />
                        ) : (
                          <div className="flex min-h-[760px] items-center justify-center text-black/45">
                            Screenshot indisponible
                          </div>
                        )}
                      </div>

                      <div className="pointer-events-none absolute inset-0 rounded-[30px] bg-[linear-gradient(to_top,rgba(0,0,0,0.03),transparent_18%)]" />

                      {screenshotLoaded &&
                        displayAnnotations.map((annotation, index) => {
                          const isActive = activeAnnotationId === annotation.id
                          const cardPosition = getAnnotationCardPosition(annotation)

                          return (
                            <div
                              key={annotation.id}
                              className={`absolute transition duration-300 ${
                                resultEntered ? "opacity-100" : "opacity-0"
                              }`}
                              style={{
                                left: `${annotation.displayX}%`,
                                top: `${annotation.displayY}%`,
                                transform: "translate(-50%, -50%)",
                                zIndex: isActive ? 120 : 30,
                              }}
                            >
                              <button
                                type="button"
                                onClick={() => toggleAnnotation(annotation.id)}
                                className={`group relative flex h-12 w-12 items-center justify-center rounded-full border-2 text-sm font-bold transition duration-200 hover:scale-110 ${
                                  isActive ? "z-[120]" : "z-[40]"
                                } ${getSeverityClasses(
                                  annotation.severity,
                                  isActive
                                )}`}
                                aria-label={annotation.title}
                                title={annotation.title}
                              >
                                <span className="absolute inset-0 rounded-full bg-current opacity-20 animate-ping" />
                                <span className="relative z-10">{index + 1}</span>
                              </button>

                              {isActive && (
                                <div
                                  className={`absolute left-1/2 ${cardPosition.verticalClass} ${cardPosition.horizontalClass} z-[130] w-[min(340px,calc(100vw-48px))] rounded-[26px] border border-black/10 bg-white p-5 shadow-[0_34px_80px_rgba(0,0,0,0.22)]`}
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div>
                                      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-black/45">
                                        Point {index + 1}
                                      </p>
                                      <h3 className="mt-1 text-base font-semibold text-black">
                                        {annotation.title}
                                      </h3>
                                    </div>

                                    <span className="rounded-full bg-black/6 px-2 py-1 text-[10px] font-semibold uppercase text-black/60">
                                      {getSeverityLabel(annotation.severity)}
                                    </span>
                                  </div>

                                  <div className="mt-4 rounded-2xl bg-[#f2e7d6] px-4 py-3">
                                    <p className="text-[11px] uppercase tracking-[0.08em] text-black/45">
                                      Gain estimé
                                    </p>
                                    <p className="mt-1 text-sm font-semibold text-black">
                                      {getAnnotationUplift(annotation)} de conversion
                                    </p>
                                  </div>

                                  <p className="mt-4 text-sm leading-6 text-black/70">
                                    {annotation.text}
                                  </p>
                                </div>
                              )}
                            </div>
                          )
                        })}
                    </div>
                  </div>

                  <section className="mt-8">
                    <div
                      data-reveal
                      data-reveal-result
                      className="reveal section-card rounded-[36px] border border-black/10 bg-white p-6 shadow-[0_24px_80px_rgba(0,0,0,0.08)] md:p-8"
                    >
                      <div className="mb-5">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-black/42">
                          Ce que ton audit dit vraiment
                        </p>
                        <h2 className="mt-2 text-2xl font-semibold md:text-3xl">
                          Le problème n'est pas qu'il n'y a rien.
                          Le problème, c'est qu'il manque ce qui fait agir.
                        </h2>
                      </div>

                      <p className="max-w-5xl text-base leading-8 text-black/72 md:text-lg">
                        {result?.summary}
                      </p>

                      <div className="mt-6 grid gap-4 md:grid-cols-3">
                        <div className="soft-panel rounded-[24px] border border-black/8 bg-[#faf6f0] p-4">
                          <p className="text-sm font-semibold text-black">
                            Ton trafic a plus de valeur que ce que la page en extrait
                          </p>
                          <p className="mt-2 text-sm leading-6 text-black/62">
                            Une meilleure structure augmente la valeur du trafic déjà payé.
                          </p>
                        </div>

                        <div className="soft-panel rounded-[24px] border border-black/8 bg-[#faf6f0] p-4">
                          <p className="text-sm font-semibold text-black">
                            Chaque friction ralentit la décision
                          </p>
                          <p className="mt-2 text-sm leading-6 text-black/62">
                            Le manque de clarté et de hiérarchie baisse le passage à l'action.
                          </p>
                        </div>

                        <div className="soft-panel rounded-[24px] border border-black/8 bg-[#faf6f0] p-4">
                          <p className="text-sm font-semibold text-black">
                            Le gain existe déjà
                          </p>
                          <p className="mt-2 text-sm leading-6 text-black/62">
                            Il est bloqué dans une page qui n'appuie pas assez fort au bon endroit.
                          </p>
                        </div>
                      </div>
                    </div>
                  </section>
                </div>

                <div className="hidden xl:block">
                  <div className="sticky top-4 h-[calc(100vh-32px)]">
                    <div
                      data-reveal
                      data-reveal-result
                      className="reveal is-visible h-full"
                    >
                      <aside className="dark-panel flex h-full min-h-0 flex-col overflow-hidden rounded-[36px] border border-black/10 bg-[#111111] p-5 text-white shadow-[0_28px_100px_rgba(0,0,0,0.12)]">
                        <div className="mb-5 shrink-0">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40">
                            Priorités
                          </p>
                          <h3 className="mt-2 text-2xl font-semibold leading-tight">
                            Les points qui freinent le plus ta page.
                          </h3>
                        </div>

                        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                          <div className="space-y-3">
                            {displayAnnotations.map((annotation, index) => {
                              const isActive = activeAnnotationId === annotation.id

                              return (
                                <button
                                  key={annotation.id}
                                  type="button"
                                  onClick={() => toggleAnnotation(annotation.id)}
                                  className={`w-full rounded-[24px] border p-4 text-left transition ${
                                    isActive
                                      ? "border-white/20 bg-white/10 text-white"
                                      : "border-white/8 bg-white/5 text-white hover:border-white/14 hover:bg-white/[0.08]"
                                  }`}
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="flex items-start gap-3">
                                      <div
                                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                                          annotation.severity === "high"
                                            ? "bg-[#ff6b57] text-white"
                                            : annotation.severity === "medium"
                                            ? "bg-[#d9a14a] text-black"
                                            : "bg-[#7db487] text-black"
                                        }`}
                                      >
                                        {index + 1}
                                      </div>

                                      <div>
                                        <p className="text-sm font-semibold">
                                          {annotation.title}
                                        </p>
                                        <p className="mt-1 text-xs text-white/52">
                                          {annotation.impactLabel || getSeverityLabel(annotation.severity)}
                                        </p>
                                      </div>
                                    </div>

                                    <div className="rounded-full bg-white/8 px-2 py-1 text-[11px] font-semibold text-white/74">
                                      {getAnnotationUplift(annotation)}
                                    </div>
                                  </div>
                                </button>
                              )
                            })}
                          </div>
                        </div>

                        {activeAnnotation && (
                          <div className="mt-5 shrink-0 rounded-[24px] border border-white/10 bg-white/5 p-4">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/38">
                              Détail actif
                            </p>
                            <h4 className="mt-2 text-[28px] font-semibold leading-tight">
                              {activeAnnotation.title}
                            </h4>
                            <div className="mt-3 max-h-[28vh] overflow-y-auto pr-1">
                              <p className="text-sm leading-7 text-white/64">
                                {activeAnnotation.text}
                              </p>
                            </div>
                          </div>
                        )}
                      </aside>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}

          <section className="mt-8">
            <div
              data-reveal
              className="reveal overflow-hidden rounded-[40px] border border-black/10 bg-[#111111] text-white shadow-[0_40px_120px_rgba(0,0,0,0.18)]"
            >
              <div className="grid gap-0 xl:grid-cols-[1.2fr_0.8fr]">
                <div className="p-6 md:p-8 xl:p-10">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40">
                    Ce que l'outil ne fait pas à ta place
                  </p>

                  <h2 className="mt-3 max-w-3xl text-3xl font-semibold leading-tight tracking-[-0.03em] md:text-4xl xl:text-5xl">
                    Voir les problèmes, c'est utile.
                    Les corriger avec méthode, c'est ce qui fait rentrer l'argent.
                  </h2>

                  <p className="mt-5 max-w-3xl text-base leading-8 text-white/72 md:text-lg">
                    Un outil révèle le manque. Une vraie expertise reconstruit la page pour qu'elle vende plus.
                  </p>

                  <div className="mt-8 space-y-4">
                    <p className="text-base leading-8 text-white/78">
                      Une landing page rentable ne repose pas sur un seul élément. Elle repose sur l'alignement entre promesse, structure, preuve, rythme visuel et CTA.
                    </p>

                    <p className="text-base leading-8 text-white/78">
                      C'est pour ça qu'une correction superficielle ne suffit pas. Il faut une page pensée pour convertir.
                    </p>

                    <p className="text-base leading-8 text-white/78">
                      C'est exactement le rôle de Clickway.
                    </p>
                  </div>

                  <div className="mt-8 grid gap-4 md:grid-cols-2">
                    <div className="dark-tile rounded-[24px] border border-white/10 bg-white/5 p-5">
                      <p className="text-sm font-semibold text-white">
                        Ce que Clickway travaille
                      </p>

                      <div className="mt-4 space-y-3 text-sm leading-6 text-white/72">
                        <p>La promesse</p>
                        <p>La hiérarchie visuelle</p>
                        <p>Le copywriting</p>
                        <p>La réassurance</p>
                        <p>Les CTA</p>
                      </div>
                    </div>

                    <div className="dark-tile rounded-[24px] border border-white/10 bg-white/5 p-5">
                      <p className="text-sm font-semibold text-white">
                        Ce que tu gagnes
                      </p>

                      <div className="mt-4 space-y-3 text-sm leading-6 text-white/72">
                        <p>Plus de leads à trafic égal</p>
                        <p>Des ventes mieux déclenchées</p>
                        <p>Une offre mieux perçue</p>
                        <p>Une page pensée pour vendre</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="border-t border-white/10 bg-white/5 p-6 md:p-8 xl:border-l xl:border-t-0 xl:p-10">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40">
                    Preuves sociales
                  </p>

                  <h3 className="mt-3 text-2xl font-semibold leading-tight">
                    Quand la page change, le résultat change.
                  </h3>

                  <div className="mt-6 space-y-4">
                    {socialProof.map((item) => (
                      <div
                        key={item.author}
                        className="dark-tile rounded-[22px] border border-white/10 bg-black/20 p-5"
                      >
                        <p className="text-sm leading-7 text-white/78">
                          “{item.quote}”
                        </p>
                        <div className="mt-4 flex items-center justify-between gap-4">
                          <p className="text-xs uppercase tracking-[0.12em] text-white/44">
                            {item.author}
                          </p>
                          <div className="rounded-full bg-[#efe4d2] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-black">
                            {item.result}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="dark-tile mt-6 rounded-[24px] border border-white/10 bg-white/5 p-5">
                    <p className="text-sm font-semibold text-white">
                      Offre
                    </p>
                    <p className="mt-3 text-sm leading-7 text-white/68">
                      Audit stratégique ou landing page pensée pour convertir. L'objectif n'est pas d'avoir une page de plus. L'objectif est d'avoir une page qui rapporte plus.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="mt-8">
            <div
              data-reveal
              className="reveal section-card rounded-[40px] border border-black/10 bg-white p-6 shadow-[0_30px_100px_rgba(0,0,0,0.08)] md:p-8 xl:p-10"
            >
              <div className="grid gap-8 xl:grid-cols-[1.1fr_0.9fr]">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-black/42">
                    Dernière étape
                  </p>
                  <h2 className="mt-3 max-w-3xl text-3xl font-semibold leading-tight tracking-[-0.03em] md:text-4xl xl:text-5xl">
                    Ne laisse plus une page moyenne limiter un bon trafic.
                  </h2>
                  <p className="mt-5 max-w-3xl text-base leading-8 text-black/68 md:text-lg">
                    Tu sais maintenant où ça bloque. La suite logique, c'est d'avoir une landing page pensée pour convertir plus fort.
                  </p>

                  <div className="mt-8 flex flex-col gap-4 sm:flex-row">
                    <a
                      href="https://clickway.fr"
                      target="_blank"
                      rel="noreferrer"
                      className="cta-dark inline-flex items-center justify-center rounded-2xl px-6 py-4 text-base font-semibold text-white transition"
                    >
                      Optimiser ma landing page
                    </a>

                    <a
                      href="https://clickway.fr"
                      target="_blank"
                      rel="noreferrer"
                      className="cta-light inline-flex items-center justify-center rounded-2xl border border-black/12 bg-[#f3ede4] px-6 py-4 text-base font-semibold text-black transition"
                    >
                      Obtenir une landing page qui convertit
                    </a>
                  </div>

                  <p className="mt-4 text-sm text-black/52">
                    Audit offert. Réponse rapide. Sans engagement.
                  </p>
                </div>

                <div className="rounded-[30px] border border-black/10 bg-[#faf6f0] p-6">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-black/42">
                    Variantes de CTA
                  </p>

                  <div className="mt-5 space-y-4">
                    <div className="soft-panel rounded-[22px] border border-black/8 bg-white p-4">
                      <p className="text-sm font-semibold text-black">
                        Variante 1
                      </p>
                      <p className="mt-2 text-sm leading-6 text-black/66">
                        Réserver mon audit offert
                      </p>
                    </div>

                    <div className="soft-panel rounded-[22px] border border-black/8 bg-white p-4">
                      <p className="text-sm font-semibold text-black">
                        Variante 2
                      </p>
                      <p className="mt-2 text-sm leading-6 text-black/66">
                        Faire passer ma landing page au niveau supérieur
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>

        {loading && (
          <div className="fixed inset-0 z-[100]">
            <div className="absolute inset-0 bg-black/35 backdrop-blur-[14px]" />

            <div className="absolute inset-0 overflow-hidden">
              <div className="absolute left-[8%] top-[10%] h-40 w-40 rounded-full bg-[#d4b173]/18 blur-3xl" />
              <div className="absolute bottom-[12%] right-[10%] h-52 w-52 rounded-full bg-white/12 blur-3xl" />
              <div className="absolute left-1/2 top-1/3 h-56 w-56 -translate-x-1/2 rounded-full bg-[#efe4d2]/8 blur-3xl" />
            </div>

            <div className="relative flex min-h-screen items-center justify-center px-4">
              <div className="w-full max-w-5xl rounded-[38px] border border-white/12 bg-[#111111]/88 p-4 text-white shadow-[0_40px_120px_rgba(0,0,0,0.4)] md:p-6 xl:p-7">
                <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
                  <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5 md:p-6">
                    <div className="flex items-center gap-3">
                      <div className="relative flex h-14 w-14 items-center justify-center rounded-full border border-white/12 bg-white/6">
                        <div className="absolute h-14 w-14 rounded-full border border-[#efe4d2]/25 animate-ping" />
                        <div className="h-7 w-7 rounded-full border-2 border-[#efe4d2] border-t-transparent animate-spin" />
                      </div>

                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40">
                          Analyse en cours
                        </p>
                        <h3 className="mt-1 text-2xl font-semibold leading-tight">
                          {isFinalizingVisual ? "Finalisation de l'affichage" : currentLoadingStep.title}
                        </h3>
                      </div>
                    </div>

                    <p className="mt-5 max-w-xl text-base leading-8 text-white/68">
                      {isFinalizingVisual
                        ? "Nous chargeons la capture finale pour afficher le rapport complet d'un seul coup."
                        : currentLoadingStep.text}
                    </p>

                    <div className="mt-6">
                      <div className="mb-3 flex items-center justify-between gap-4">
                        <p className="text-sm font-medium text-white/70">
                          Progression de l'audit
                        </p>
                        <p className="text-sm font-semibold text-white/65">
                          {Math.round(progress)}%
                        </p>
                      </div>

                      <div className="h-3 w-full overflow-hidden rounded-full bg-white/10">
                        <div
                          className="progress-shine h-full rounded-full bg-[#efe4d2] transition-[width] duration-300 ease-out"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>

                    <div className="mt-6 grid gap-3">
                      {loadingSteps.map((step, index) => {
                        const threshold = (index + 1) * 20
                        const isDone = progress >= threshold
                        const isCurrent = !isFinalizingVisual && currentLoadingStep.title === step.title

                        return (
                          <div
                            key={step.title}
                            className={`rounded-[18px] border px-4 py-4 transition ${
                              isCurrent
                                ? "border-[#efe4d2]/22 bg-[#efe4d2]/10"
                                : isDone
                                ? "border-white/10 bg-white/[0.06]"
                                : "border-white/8 bg-white/[0.03]"
                            }`}
                          >
                            <div className="flex items-start gap-3">
                              <div
                                className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                                  isCurrent
                                    ? "bg-[#efe4d2] text-black"
                                    : isDone
                                    ? "bg-white text-black"
                                    : "bg-white/10 text-white/60"
                                }`}
                              >
                                {isDone ? "✓" : index + 1}
                              </div>

                              <div>
                                <p className="text-sm font-semibold text-white">
                                  {step.title}
                                </p>
                                <p className="mt-1 text-sm leading-6 text-white/56">
                                  {step.text}
                                </p>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  <div className="rounded-[28px] border border-white/10 bg-[#f3ede4] p-4 text-black md:p-5">
                    <div className="mb-4 flex items-center justify-between gap-3 rounded-[20px] border border-black/8 bg-white px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="h-3 w-3 rounded-full bg-[#ff6b57]" />
                        <span className="h-3 w-3 rounded-full bg-[#d9a14a]" />
                        <span className="h-3 w-3 rounded-full bg-[#7db487]" />
                      </div>

                      <p className="text-xs font-medium text-black/45">
                        Aperçu du rapport
                      </p>
                    </div>

                    <div className="rounded-[24px] border border-black/8 bg-[#111111] p-5 text-white">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/40">
                        Pendant l'analyse
                      </p>

                      <h3 className="mt-3 text-2xl font-semibold leading-tight">
                        Nous préparons un rapport qui montre ce qui affaiblit ta page et ce qu'il faut corriger en premier.
                      </h3>

                      <div className="mt-6 grid gap-3">
                        <div className="animate-float rounded-2xl border border-white/10 bg-white/5 p-4">
                          <p className="text-sm font-semibold">Promesse trop large</p>
                          <p className="mt-1 text-sm text-white/60">
                            Le bénéfice n'est pas perçu assez vite.
                          </p>
                        </div>

                        <div className="animate-float-delayed rounded-2xl border border-white/10 bg-white/5 p-4">
                          <p className="text-sm font-semibold">CTA pas assez fort</p>
                          <p className="mt-1 text-sm text-white/60">
                            L'action principale manque de domination visuelle.
                          </p>
                        </div>

                        <div className="animate-float-slower rounded-2xl border border-white/10 bg-white/5 p-4">
                          <p className="text-sm font-semibold">Réassurance trop faible</p>
                          <p className="mt-1 text-sm text-white/60">
                            La page donne trop peu de raisons de croire tout de suite.
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 rounded-[22px] border border-black/8 bg-white px-4 py-4">
                      <p className="text-sm font-semibold text-black">
                        Résultat attendu
                      </p>
                      <p className="mt-2 text-sm leading-6 text-black/62">
                        À la fin, tu obtiens une capture annotée, une lecture claire des pertes et une direction nette pour améliorer la conversion.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      <style jsx global>{`
        html {
          scroll-behavior: smooth;
        }

        body {
          background: #f3ede4;
        }

        .grain {
          background-image:
            radial-gradient(rgba(0, 0, 0, 0.035) 0.7px, transparent 0.7px);
          background-size: 10px 10px;
          mix-blend-mode: multiply;
        }

        .hero-grid {
          background-image:
            linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px);
          background-size: 56px 56px;
          mask-image: radial-gradient(circle at center, black 38%, transparent 88%);
        }

        .hero-orb {
          position: absolute;
          border-radius: 9999px;
          filter: blur(90px);
          opacity: 0.6;
          will-change: transform;
          pointer-events: none;
        }

        .hero-orb-1 {
          left: -4rem;
          top: 3rem;
          width: 18rem;
          height: 18rem;
          background: rgba(46, 203, 255, 0.12);
          animation: orbFloat 12s ease-in-out infinite;
        }

        .hero-orb-2 {
          right: 8%;
          top: 12%;
          width: 22rem;
          height: 22rem;
          background: rgba(212, 177, 115, 0.14);
          animation: orbFloatReverse 14s ease-in-out infinite;
        }

        .hero-orb-3 {
          left: 35%;
          bottom: -6rem;
          width: 20rem;
          height: 20rem;
          background: rgba(255, 255, 255, 0.08);
        }

        .hero-title {
          text-wrap: balance;
        }

        .reveal {
          opacity: 0;
          transform: translateY(34px);
          transition:
            opacity 0.8s ease,
            transform 0.8s ease;
          will-change: opacity, transform;
        }

        .reveal.is-visible {
          opacity: 1;
          transform: translateY(0);
        }

        .glass-chip {
          border-radius: 9999px;
          border: 1px solid rgba(255,255,255,0.12);
          background: rgba(255,255,255,0.06);
          padding: 0.5rem 1rem;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: rgba(255,255,255,0.72);
          backdrop-filter: blur(14px);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.06);
        }

        .mini-chip {
          border-radius: 9999px;
          border: 1px solid rgba(255,255,255,0.1);
          background: rgba(255,255,255,0.06);
          padding: 0.5rem 0.85rem;
          backdrop-filter: blur(12px);
          transition:
            transform 0.25s ease,
            background 0.25s ease,
            border-color 0.25s ease;
        }

        .mini-chip:hover {
          transform: translateY(-2px);
          background: rgba(255,255,255,0.09);
          border-color: rgba(255,255,255,0.16);
        }

        .feature-chip {
          position: relative;
          overflow: hidden;
          border-radius: 1rem;
          border: 1px solid rgba(255,255,255,0.1);
          background: rgba(255,255,255,0.06);
          padding: 0.85rem 1rem;
          font-size: 0.875rem;
          color: rgba(255,255,255,0.68);
          backdrop-filter: blur(12px);
          transition:
            transform 0.25s ease,
            border-color 0.25s ease,
            background 0.25s ease;
        }

        .feature-chip::after {
          content: "";
          position: absolute;
          inset: 0;
          background: linear-gradient(120deg, transparent, rgba(255,255,255,0.12), transparent);
          transform: translateX(-120%);
          transition: transform 0.8s ease;
        }

        .feature-chip:hover::after {
          transform: translateX(120%);
        }

        .feature-chip:hover {
          transform: translateY(-3px);
          background: rgba(255,255,255,0.08);
          border-color: rgba(255,255,255,0.16);
        }

        .field-glow {
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.35),
            0 0 0 rgba(46,203,255,0);
        }

        .field-glow:focus {
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.35),
            0 0 0 1px rgba(46,203,255,0.16),
            0 12px 40px rgba(46,203,255,0.08);
        }

        .cta-primary {
          position: relative;
          overflow: hidden;
          background: linear-gradient(135deg, #efe4d2, #d4b173 180%);
          box-shadow:
            0 16px 36px rgba(212,177,115,0.18),
            inset 0 1px 0 rgba(255,255,255,0.55);
        }

        .cta-primary::before {
          content: "";
          position: absolute;
          inset: -2px;
          border-radius: inherit;
          background: radial-gradient(circle at center, rgba(255,255,255,0.6), transparent 60%);
          opacity: 0;
          transition: opacity 0.25s ease;
        }

        .cta-primary::after {
          content: "";
          position: absolute;
          inset: 0;
          background: linear-gradient(120deg, transparent, rgba(255,255,255,0.28), transparent);
          transform: translateX(-120%);
          transition: transform 0.9s ease;
        }

        .cta-primary:hover {
          transform: translateY(-2px) scale(1.01);
          box-shadow:
            0 22px 44px rgba(212,177,115,0.24),
            0 0 0 8px rgba(212,177,115,0.08),
            inset 0 1px 0 rgba(255,255,255,0.6);
        }

        .cta-primary:hover::before {
          opacity: 1;
        }

        .cta-primary:hover::after {
          transform: translateX(120%);
        }

        .cta-primary:active {
          transform: translateY(0) scale(0.995);
        }

        .shine-card {
          position: relative;
          overflow: hidden;
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.55),
            0 24px 60px rgba(0,0,0,0.08);
        }

        .shine-card::before {
          content: "";
          position: absolute;
          inset: 0;
          background:
            radial-gradient(circle at top left, rgba(255,255,255,0.6), transparent 30%),
            linear-gradient(135deg, rgba(255,255,255,0.08), transparent 42%);
          pointer-events: none;
        }

        .tilt-card,
        .section-card,
        .soft-panel,
        .dark-tile,
        .stat-tile,
        .stat-box {
          transition:
            transform 0.28s ease,
            box-shadow 0.28s ease,
            border-color 0.28s ease,
            background 0.28s ease;
          will-change: transform;
        }

        .tilt-card:hover,
        .section-card:hover,
        .soft-panel:hover,
        .dark-tile:hover,
        .stat-tile:hover,
        .stat-box:hover {
          transform: translateY(-4px);
        }

        .section-card:hover,
        .stat-box:hover {
          box-shadow: 0 28px 80px rgba(0,0,0,0.1);
        }

        .soft-panel:hover,
        .stat-tile:hover {
          box-shadow: 0 18px 40px rgba(0,0,0,0.08);
          border-color: rgba(0,0,0,0.12);
        }

        .dark-panel {
          position: relative;
          overflow: hidden;
        }

        .dark-panel::before {
          content: "";
          position: absolute;
          inset: 0;
          background:
            radial-gradient(circle at top right, rgba(46,203,255,0.08), transparent 24%),
            radial-gradient(circle at bottom left, rgba(212,177,115,0.1), transparent 26%);
          pointer-events: none;
        }

        .dark-tile:hover {
          border-color: rgba(255,255,255,0.16);
          background: rgba(255,255,255,0.08);
          box-shadow: 0 18px 34px rgba(0,0,0,0.24);
        }

        .progress-shine {
          position: relative;
          overflow: hidden;
        }

        .progress-shine::after {
          content: "";
          position: absolute;
          inset: 0;
          background: linear-gradient(120deg, transparent, rgba(255,255,255,0.32), transparent);
          animation: progressSweep 2.8s linear infinite;
        }

        .step-badge {
          box-shadow: 0 10px 22px rgba(0,0,0,0.12);
        }

        .cta-dark {
          position: relative;
          overflow: hidden;
          background: linear-gradient(135deg, #111111, #232323);
          box-shadow:
            0 18px 44px rgba(0,0,0,0.18),
            inset 0 1px 0 rgba(255,255,255,0.08);
        }

        .cta-dark::after,
        .cta-light::after {
          content: "";
          position: absolute;
          inset: 0;
          background: linear-gradient(120deg, transparent, rgba(255,255,255,0.22), transparent);
          transform: translateX(-120%);
          transition: transform 0.9s ease;
        }

        .cta-dark:hover,
        .cta-light:hover {
          transform: translateY(-2px) scale(1.01);
        }

        .cta-dark:hover::after,
        .cta-light:hover::after {
          transform: translateX(120%);
        }

        .cta-dark:hover {
          box-shadow:
            0 22px 48px rgba(0,0,0,0.24),
            0 0 0 8px rgba(0,0,0,0.05);
        }

        .cta-light {
          position: relative;
          overflow: hidden;
          box-shadow:
            0 14px 34px rgba(0,0,0,0.08),
            inset 0 1px 0 rgba(255,255,255,0.4);
        }

        .cta-light:hover {
          background: #efe4d2;
          box-shadow:
            0 20px 44px rgba(0,0,0,0.1),
            0 0 0 8px rgba(212,177,115,0.08);
        }

        @keyframes floatSoft {
          0% {
            transform: translateY(0px);
          }
          50% {
            transform: translateY(-6px);
          }
          100% {
            transform: translateY(0px);
          }
        }

        @keyframes orbFloat {
          0% {
            transform: translate3d(0, 0, 0) scale(1);
          }
          50% {
            transform: translate3d(24px, -16px, 0) scale(1.04);
          }
          100% {
            transform: translate3d(0, 0, 0) scale(1);
          }
        }

        @keyframes orbFloatReverse {
          0% {
            transform: translate3d(0, 0, 0) scale(1);
          }
          50% {
            transform: translate3d(-18px, 20px, 0) scale(1.06);
          }
          100% {
            transform: translate3d(0, 0, 0) scale(1);
          }
        }

        @keyframes progressSweep {
          0% {
            transform: translateX(-120%);
          }
          100% {
            transform: translateX(120%);
          }
        }

        .animate-float {
          animation: floatSoft 3.4s ease-in-out infinite;
        }

        .animate-float-delayed {
          animation: floatSoft 4.1s ease-in-out infinite;
        }

        .animate-float-slower {
          animation: floatSoft 4.8s ease-in-out infinite;
        }

        @media (prefers-reduced-motion: reduce) {
          html {
            scroll-behavior: auto;
          }

          .reveal,
          .animate-float,
          .animate-float-delayed,
          .animate-float-slower,
          .hero-orb-1,
          .hero-orb-2,
          .progress-shine::after,
          .feature-chip::after,
          .cta-primary::after,
          .cta-dark::after,
          .cta-light::after {
            animation: none !important;
            transition: none !important;
            transform: none !important;
          } 
        }
      `}</style>
    </>
  )
}    