import fs from "node:fs"
import path from "node:path"
import chromium from "@sparticuz/chromium"
import puppeteer, { type Page } from "puppeteer-core"
import { PNG } from "pngjs"

export type PageBlockType =
  | "headline"
  | "subheadline"
  | "body"
  | "cta"
  | "input"
  | "form"
  | "pricing"
  | "testimonial"
  | "faq"
  | "proof"
  | "navigation"
  | "hero"
  | "media"
  | "card"
  | "section"
  | "content"

export type PageBlock = {
  id: string
  type: PageBlockType
  text: string
  x: number
  y: number
  width: number
  height: number
  selectorHint?: string
  domPath?: string
  targetLabel?: string
  tagName?: string
  role?: string
  href?: string
  ariaLabel?: string
  score?: number
}

export type PageSnapshot = {
  screenshotUrl: string
  blocks: PageBlock[]
  pageTitle: string
  metaDescription: string
  textContent: string
}

const VIEWPORT_WIDTH = 1440
const VIEWPORT_HEIGHT = 1200
const MAX_CAPTURE_HEIGHT = 20000
const MAX_FAST_FULLPAGE_HEIGHT = 4200
const SLICE_OVERLAP = 160
const SCROLL_STEP_RATIO = 0.86
const WAIT_AFTER_SCROLL_MS = 180
const WAIT_AFTER_TOP_RESET_MS = 260
const WAIT_AFTER_NAV_MS = 450
const WAIT_BEFORE_FIRST_SLICE_MS = 700
const WAIT_BEFORE_RETRY_FIRST_SLICE_MS = 1100
const WAIT_AFTER_FORCE_REVEAL_MS = 450
const JPEG_QUALITY = 72
const MAX_BLOCKS = 90

async function launchBrowser() {
  const localBinPath = path.join(
    process.cwd(),
    "node_modules",
    "@sparticuz",
    "chromium",
    "bin"
  )

  const executablePath = fs.existsSync(localBinPath)
    ? await chromium.executablePath(localBinPath)
    : await chromium.executablePath()

  return puppeteer.launch({
    args: [
      ...chromium.args,
      "--hide-scrollbars",
      "--disable-gpu",
      "--font-render-hinting=none",
    ],
    executablePath,
    headless: true,
  })
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function shortText(value: string, max = 180) {
  const clean = normalizeText(value)
  if (clean.length <= max) {
    return clean
  }
  return `${clean.slice(0, max)}...`
}

function normalizeForCompare(value: string) {
  return normalizeText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

async function waitForNetworkCalm(page: Page) {
  try {
    await page.waitForNetworkIdle({
      idleTime: 600,
      timeout: 5000,
    })
  } catch {}
}

async function waitForPageAssets(page: Page) {
  await page.evaluate(async () => {
    function wait(ms: number) {
      return new Promise((resolve) => setTimeout(resolve, ms))
    }

    try {
      if ("fonts" in document && document.fonts?.ready) {
        await Promise.race([document.fonts.ready, wait(2500)])
      }
    } catch {}

    const images = Array.from(document.images || []).slice(0, 140)

    await Promise.all(
      images.map((img) => {
        if (img.complete) {
          return Promise.resolve()
        }

        return new Promise<void>((resolve) => {
          const done = () => resolve()

          img.addEventListener("load", done, { once: true })
          img.addEventListener("error", done, { once: true })

          setTimeout(done, 2200)
        })
      })
    )

    const videos = Array.from(document.querySelectorAll("video")).slice(0, 24)

    videos.forEach((video) => {
      try {
        video.pause()
        video.currentTime = 0
      } catch {}
    })

    await wait(150)
  })
}

async function waitForStableViewport(page: Page, extraMs = 0) {
  await page.evaluate(async () => {
    function raf() {
      return new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve())
      })
    }

    await raf()
    await raf()
    await raf()

    void document.body?.offsetHeight
    void document.documentElement?.offsetHeight
    void document.scrollingElement?.scrollHeight
  })

  if (extraMs > 0) {
    await sleep(extraMs)
  }
}

async function forceTopRepaint(page: Page) {
  await page.evaluate(async () => {
    function wait(ms: number) {
      return new Promise((resolve) => setTimeout(resolve, ms))
    }

    window.scrollTo(0, 0)
    await wait(60)
    window.scrollTo(0, 1)
    await wait(60)
    window.scrollTo(0, 0)
    await wait(60)

    const root = document.documentElement
    const body = document.body

    if (root) {
      root.style.transform = "translateZ(0)"
    }

    if (body) {
      body.style.transform = "translateZ(0)"
    }

    await wait(80)

    if (root) {
      root.style.transform = ""
    }

    if (body) {
      body.style.transform = ""
    }

    await wait(80)
  })

  await waitForStableViewport(page, 160)
}

async function triggerLazyLoad(page: Page) {
  await page.evaluate(
    async ({
      stepRatio,
      waitMs,
    }: {
      stepRatio: number
      waitMs: number
    }) => {
      function wait(ms: number) {
        return new Promise((resolve) => setTimeout(resolve, ms))
      }

      const root = document.scrollingElement || document.documentElement
      const fullHeight = Math.max(
        root.scrollHeight,
        document.documentElement.scrollHeight,
        document.body?.scrollHeight || 0
      )

      const maxScroll = Math.max(0, fullHeight - window.innerHeight)
      const step = Math.max(480, Math.floor(window.innerHeight * stepRatio))

      let current = 0
      let loops = 0

      while (current < maxScroll && loops < 45) {
        current = Math.min(current + step, maxScroll)
        window.scrollTo(0, current)
        await wait(waitMs)
        loops += 1
      }

      await wait(180)
      window.scrollTo(0, 0)
      await wait(220)
    },
    {
      stepRatio: SCROLL_STEP_RATIO,
      waitMs: WAIT_AFTER_SCROLL_MS,
    }
  )
}

async function preparePageForStableScreenshot(page: Page) {
  await page.addStyleTag({
    content: `
      html, body {
        scroll-behavior: auto !important;
      }

      *, *::before, *::after {
        animation: none !important;
        transition-property: none !important;
        transition-duration: 0s !important;
        caret-color: transparent !important;
      }

      video, canvas {
        animation: none !important;
        transition: none !important;
      }

      [data-aos],
      [class*='parallax'],
      [class*='marquee'] {
        transform: none !important;
      }
    `,
  })

  await page.evaluate(() => {
    const hideSelectors = [
      "[class*='cookie']",
      "[id*='cookie']",
      "[class*='consent']",
      "[id*='consent']",
      "[class*='intercom']",
      "[id*='intercom']",
      "[class*='chat']",
      "[id*='chat']",
      "[class*='crisp']",
      "[id*='crisp']",
      "[class*='launcher']",
      "[id*='launcher']",
      "iframe[src*='intercom']",
      "iframe[src*='chat']",
      "iframe[src*='hubspot']",
      "iframe[src*='crisp']",
      "iframe[title*='chat']",
      "[aria-label*='chat']",
      "[aria-label*='support']",
      "[aria-label*='messenger']",
      "[data-testid*='cookie']",
      "[data-testid*='consent']",
    ]

    document.querySelectorAll(hideSelectors.join(",")).forEach((node) => {
      if (node instanceof HTMLElement) {
        node.style.setProperty("display", "none", "important")
        node.style.setProperty("visibility", "hidden", "important")
        node.style.setProperty("opacity", "0", "important")
        node.style.setProperty("pointer-events", "none", "important")
      }
    })

    const allElements = Array.from(document.querySelectorAll("*"))

    allElements.forEach((element) => {
      if (!(element instanceof HTMLElement)) {
        return
      }

      const style = window.getComputedStyle(element)
      const position = style.position

      if (position !== "fixed" && position !== "sticky") {
        return
      }

      const rect = element.getBoundingClientRect()
      const text = (element.innerText || "").trim().toLowerCase()

      const isTinyWidget = rect.width <= 220 && rect.height <= 160
      const isCornerWidget =
        rect.right > window.innerWidth - 40 &&
        rect.bottom > window.innerHeight - 40
      const isSuspiciousSupportWidget =
        text.includes("chat") ||
        text.includes("support") ||
        text.includes("aide") ||
        text.includes("help") ||
        text.includes("messenger")

      if ((isTinyWidget && isCornerWidget) || isSuspiciousSupportWidget) {
        element.style.setProperty("display", "none", "important")
        element.style.setProperty("visibility", "hidden", "important")
        element.style.setProperty("opacity", "0", "important")
        element.style.setProperty("pointer-events", "none", "important")
      }
    })
  })

  await page.evaluate(async () => {
    function wait(ms: number) {
      return new Promise((resolve) => setTimeout(resolve, ms))
    }

    window.scrollTo(0, 0)
    await wait(140)
  })
}

async function forceRevealAboveTheFoldContent(page: Page) {
  await page.evaluate(async () => {
    function wait(ms: number) {
      return new Promise((resolve) => setTimeout(resolve, ms))
    }

    function hasUsefulText(node: HTMLElement) {
      const text = (node.innerText || node.textContent || "").replace(/\s+/g, " ").trim()
      return text.length >= 2
    }

    function isLikelyUiElement(node: HTMLElement) {
      const tag = node.tagName.toLowerCase()
      const role = (node.getAttribute("role") || "").toLowerCase()
      const className = (node.className || "").toString().toLowerCase()
      const ariaLabel = (node.getAttribute("aria-label") || "").toLowerCase()
      const text = (node.innerText || node.textContent || "").replace(/\s+/g, " ").trim().toLowerCase()

      if (tag === "button" || tag === "a") return true
      if (role === "button") return true

      if (
        className.includes("hero") ||
        className.includes("badge") ||
        className.includes("chip") ||
        className.includes("cta") ||
        className.includes("logo") ||
        className.includes("brand") ||
        className.includes("trust") ||
        className.includes("reveal")
      ) {
        return true
      }

      if (
        ariaLabel.includes("button") ||
        ariaLabel.includes("cta") ||
        ariaLabel.includes("logo")
      ) {
        return true
      }

      if (
        text.includes("automatisation intelligente") ||
        text.includes("discutons de votre projet") ||
        text.includes("plus de 50 entrepreneurs nous font confiance")
      ) {
        return true
      }

      return false
    }

    function revealNode(node: HTMLElement) {
      node.style.setProperty("opacity", "1", "important")
      node.style.setProperty("visibility", "visible", "important")
      node.style.setProperty("transform", "none", "important")
      node.style.setProperty("filter", "none", "important")
      node.style.setProperty("clip-path", "none", "important")
      node.style.setProperty("mask-image", "none", "important")
      node.style.setProperty("-webkit-mask-image", "none", "important")
      node.style.setProperty("transition", "none", "important")
      node.style.setProperty("animation", "none", "important")
      node.style.setProperty("will-change", "auto", "important")
    }

    const heroRoots = Array.from(document.querySelectorAll("section, header, main, div")).filter(
      (node) => {
        if (!(node instanceof HTMLElement)) {
          return false
        }

        const rect = node.getBoundingClientRect()
        if (rect.top > window.innerHeight * 1.2 || rect.bottom < 0) {
          return false
        }

        const text = (node.innerText || node.textContent || "").toLowerCase()

        return (
          node.querySelector("h1") !== null ||
          text.includes("automatisation intelligente") ||
          text.includes("discutons de votre projet") ||
          text.includes("plus de 50 entrepreneurs nous font confiance")
        )
      }
    ) as HTMLElement[]

    const heroRoot = heroRoots[0] || document.body

    revealNode(heroRoot)

    const descendants = Array.from(heroRoot.querySelectorAll("*"))

    for (const node of descendants) {
      if (!(node instanceof HTMLElement)) {
        continue
      }

      const rect = node.getBoundingClientRect()
      const isNearHero =
        rect.bottom >= -80 && rect.top <= window.innerHeight * 1.45

      if (!isNearHero) {
        continue
      }

      if (hasUsefulText(node) || isLikelyUiElement(node)) {
        revealNode(node)
      }
    }

    const directTargets = Array.from(
      document.querySelectorAll(
        [
          "h1",
          "h2",
          "h3",
          "p",
          "button",
          "a",
          "[role='button']",
          "[data-reveal]",
          ".reveal",
          "[class*='hero']",
          "[class*='badge']",
          "[class*='chip']",
          "[class*='cta']",
          "[class*='logo']",
          "[class*='brand']",
          "[class*='trust']",
        ].join(",")
      )
    )

    for (const node of directTargets) {
      if (!(node instanceof HTMLElement)) {
        continue
      }

      const rect = node.getBoundingClientRect()
      const isAboveTheFold =
        rect.bottom >= -80 && rect.top <= window.innerHeight * 1.45

      if (!isAboveTheFold) {
        continue
      }

      if (hasUsefulText(node) || isLikelyUiElement(node)) {
        revealNode(node)
      }
    }

    window.scrollTo(0, 0)
    await wait(160)
  })

  await waitForStableViewport(page, WAIT_AFTER_FORCE_REVEAL_MS)
}

async function getPageMetrics(page: Page) {
  return page.evaluate((maxCaptureHeight) => {
    const root = document.scrollingElement || document.documentElement
    const all = Array.from(document.body?.querySelectorAll("*") || [])
    let maxBottom = 0

    for (const node of all) {
      if (!(node instanceof HTMLElement)) {
        continue
      }

      const style = window.getComputedStyle(node)

      if (style.display === "none" || style.visibility === "hidden") {
        continue
      }

      const rect = node.getBoundingClientRect()

      if (rect.width <= 0 || rect.height <= 0) {
        continue
      }

      const absoluteBottom = rect.bottom + window.scrollY
      if (absoluteBottom > maxBottom) {
        maxBottom = absoluteBottom
      }
    }

    const scrollHeight = Math.max(
      document.body?.scrollHeight || 0,
      document.documentElement.scrollHeight,
      document.body?.offsetHeight || 0,
      document.documentElement.offsetHeight,
      root.scrollHeight,
      Math.ceil(maxBottom)
    )

    return {
      fullHeight: Math.min(scrollHeight, maxCaptureHeight),
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      pageTitle: (document.title || "").trim(),
      metaDescription:
        document
          .querySelector('meta[name="description"]')
          ?.getAttribute("content")
          ?.trim() || "",
      textContent: (document.body?.innerText || "").replace(/\s+/g, " ").trim(),
    }
  }, MAX_CAPTURE_HEIGHT)
}

function getTagWeight(tagName: string) {
  if (tagName === "h1") return 100
  if (tagName === "h2") return 94
  if (tagName === "h3") return 88
  if (tagName === "button") return 92
  if (tagName === "input") return 90
  if (tagName === "textarea") return 88
  if (tagName === "form") return 90
  if (tagName === "section") return 66
  if (tagName === "article") return 64
  if (tagName === "header") return 70
  if (tagName === "a") return 72
  return 50
}

function getTypeWeight(type: PageBlockType) {
  if (type === "headline") return 100
  if (type === "subheadline") return 94
  if (type === "cta") return 96
  if (type === "form") return 92
  if (type === "input") return 88
  if (type === "pricing") return 85
  if (type === "testimonial") return 82
  if (type === "proof") return 80
  if (type === "hero") return 86
  if (type === "faq") return 72
  if (type === "section") return 56
  if (type === "card") return 62
  if (type === "body") return 55
  return 48
}

function inferBlockType(params: {
  tagName: string
  role: string
  text: string
  className: string
  id: string
  href: string
  ariaLabel: string
  rectWidth: number
  rectHeight: number
}) {
  const {
    tagName,
    role,
    text,
    className,
    id,
    href,
    ariaLabel,
    rectWidth,
    rectHeight,
  } = params

  const haystack = normalizeForCompare(
    `${text} ${className} ${id} ${ariaLabel} ${href}`
  )

  if (tagName === "h1") return "headline" as const
  if (tagName === "h2" || tagName === "h3") return "subheadline" as const
  if (tagName === "form") return "form" as const
  if (tagName === "input" || tagName === "textarea" || tagName === "select") {
    return "input" as const
  }

  if (
    tagName === "button" ||
    role === "button" ||
    (tagName === "a" &&
      (haystack.includes("demarrer") ||
        haystack.includes("commencer") ||
        haystack.includes("reserver") ||
        haystack.includes("essayer") ||
        haystack.includes("audit") ||
        haystack.includes("devis") ||
        haystack.includes("contact") ||
        haystack.includes("book") ||
        haystack.includes("start") ||
        haystack.includes("get started") ||
        haystack.includes("try")))
  ) {
    return "cta" as const
  }

  if (
    haystack.includes("testimonial") ||
    haystack.includes("temoign") ||
    haystack.includes("avis client") ||
    haystack.includes("ce qu'ils disent")
  ) {
    return "testimonial" as const
  }

  if (
    haystack.includes("pricing") ||
    haystack.includes("tarif") ||
    haystack.includes("offre") ||
    haystack.includes("plan")
  ) {
    return "pricing" as const
  }

  if (
    haystack.includes("faq") ||
    haystack.includes("question") ||
    haystack.includes("frequently asked")
  ) {
    return "faq" as const
  }

  if (
    haystack.includes("proof") ||
    haystack.includes("trusted") ||
    haystack.includes("vu sur") ||
    haystack.includes("ils nous font confiance") ||
    haystack.includes("client") ||
    haystack.includes("marque") ||
    haystack.includes("logo")
  ) {
    return "proof" as const
  }

  if (
    haystack.includes("hero") ||
    (rectWidth > 55 && rectHeight > 10 && (tagName === "section" || tagName === "header"))
  ) {
    return "hero" as const
  }

  if (tagName === "section" || tagName === "article" || tagName === "header") {
    return "section" as const
  }

  if (tagName === "a") {
    return "navigation" as const
  }

  if (rectWidth > 25 && rectHeight > 6) {
    return "card" as const
  }

  if (text.length > 80) {
    return "body" as const
  }

  return "content" as const
}

async function collectBlocks(page: Page): Promise<PageBlock[]> {
  const pageData = await page.evaluate((maxBlocks) => {
    function stripHtmlText(value: string) {
      return value.replace(/\s+/g, " ").trim()
    }

    function shortDomPath(element: Element) {
      const parts: string[] = []
      let current: Element | null = element
      let depth = 0

      while (current && depth < 5) {
        const tag = current.tagName.toLowerCase()
        const id = current.id ? `#${current.id}` : ""
        let cls = ""

        if (current instanceof HTMLElement) {
          const classNames = Array.from(current.classList).slice(0, 2)
          if (classNames.length) {
            cls = `.${classNames.join(".")}`
          }
        }

        parts.unshift(`${tag}${id}${cls}`)
        current = current.parentElement
        depth += 1
      }

      return parts.join(" > ")
    }

    const fullHeight = Math.max(
      document.body?.scrollHeight || 0,
      document.documentElement.scrollHeight,
      document.body?.offsetHeight || 0,
      document.documentElement.offsetHeight
    )

    const selector = [
      "h1",
      "h2",
      "h3",
      "h4",
      "p",
      "button",
      "a",
      "form",
      "input",
      "textarea",
      "select",
      "[role='button']",
      "[role='heading']",
      "section",
      "article",
      "header",
      "main section",
      "main article",
      "[class*='hero']",
      "[class*='cta']",
      "[class*='card']",
      "[class*='feature']",
      "[class*='testimonial']",
      "[class*='pricing']",
      "[class*='faq']",
      "[class*='proof']",
      "[data-testid]",
    ].join(",")

    const elements = Array.from(document.querySelectorAll(selector))
    const seen = new Set<string>()

    const blocks = elements
      .map((element, index) => {
        const rect = element.getBoundingClientRect()
        const style = window.getComputedStyle(element)
        const text = stripHtmlText(
          (element instanceof HTMLInputElement && element.placeholder) ||
            element.getAttribute("aria-label") ||
            element.textContent ||
            ""
        )

        if (style.display === "none" || style.visibility === "hidden") {
          return null
        }

        if (rect.width < 90 || rect.height < 20) {
          return null
        }

        if (rect.bottom < -40 || rect.top > window.innerHeight + 25000) {
          return null
        }

        const absTop = rect.top + window.scrollY
        const area = rect.width * rect.height

        if (area < 5000 && text.length < 18) {
          return null
        }

        const tagName = element.tagName.toLowerCase()
        const role = element.getAttribute("role") || ""
        const href =
          element instanceof HTMLAnchorElement ? element.getAttribute("href") || "" : ""
        const ariaLabel = element.getAttribute("aria-label") || ""
        const className =
          element instanceof HTMLElement ? element.className || "" : ""
        const id = element.id || ""

        const key = [
          Math.round(rect.left),
          Math.round(absTop),
          Math.round(rect.width),
          Math.round(rect.height),
          text.slice(0, 80),
          tagName,
        ].join("|")

        if (seen.has(key)) {
          return null
        }

        seen.add(key)

        return {
          id: `block-${index + 1}`,
          tagName,
          role,
          href,
          ariaLabel,
          className: typeof className === "string" ? className : "",
          rawId: id,
          text,
          x: Number(((rect.left / window.innerWidth) * 100).toFixed(2)),
          y: Number(((absTop / fullHeight) * 100).toFixed(2)),
          width: Number(((rect.width / window.innerWidth) * 100).toFixed(2)),
          height: Number(((rect.height / fullHeight) * 100).toFixed(2)),
          selectorHint:
            tagName +
            (id ? `#${id}` : "") +
            (typeof className === "string" && className.trim()
              ? `.${className.trim().split(/\s+/).slice(0, 2).join(".")}`
              : ""),
          domPath: shortDomPath(element),
          targetLabel:
            ariaLabel ||
            element.getAttribute("title") ||
            text.slice(0, 160),
        }
      })
      .filter(Boolean)
      .slice(0, maxBlocks)

    return { blocks }
  }, MAX_BLOCKS)

  const rawBlocks = pageData.blocks as Array<{
    id: string
    tagName: string
    role: string
    href: string
    ariaLabel: string
    className: string
    rawId: string
    text: string
    x: number
    y: number
    width: number
    height: number
    selectorHint?: string
    domPath?: string
    targetLabel?: string
  }>

  const blocks: PageBlock[] = rawBlocks
    .map((block) => {
      const type = inferBlockType({
        tagName: block.tagName,
        role: block.role,
        text: block.text,
        className: block.className,
        id: block.rawId,
        href: block.href,
        ariaLabel: block.ariaLabel,
        rectWidth: block.width,
        rectHeight: block.height,
      })

      const textWeight = Math.min(100, normalizeText(block.text).length)
      const score = Math.round(
        getTypeWeight(type) * 0.55 +
          getTagWeight(block.tagName) * 0.25 +
          textWeight * 0.2
      )

      return {
        id: block.id,
        type,
        text: shortText(normalizeText(block.text), 220),
        x: block.x,
        y: block.y,
        width: block.width,
        height: block.height,
        selectorHint: block.selectorHint,
        domPath: block.domPath,
        targetLabel: block.targetLabel ? shortText(block.targetLabel, 160) : undefined,
        tagName: block.tagName,
        role: block.role || undefined,
        href: block.href || undefined,
        ariaLabel: block.ariaLabel || undefined,
        score,
      }
    })
    .filter((block) => block.y >= 0 && block.y <= 100)
    .sort((a, b) => {
      if ((b.score || 0) !== (a.score || 0)) {
        return (b.score || 0) - (a.score || 0)
      }

      if (a.y !== b.y) {
        return a.y - b.y
      }

      return a.x - b.x
    })
    .slice(0, MAX_BLOCKS)

  return blocks
}

function buildScrollPositions(fullHeight: number, viewportHeight: number) {
  const cappedHeight = Math.min(fullHeight, MAX_CAPTURE_HEIGHT)
  const maxY = Math.max(0, cappedHeight - viewportHeight)
  const step = Math.max(420, viewportHeight - SLICE_OVERLAP)

  const positions: number[] = [0]
  let current = 0

  while (current < maxY) {
    current = Math.min(current + step, maxY)
    positions.push(current)

    if (current === maxY) {
      break
    }
  }

  return {
    positions,
    cappedHeight,
  }
}

function isLikelyBlankTopSlice(raw: Buffer) {
  try {
    const png = PNG.sync.read(raw)

    const sampleStepX = Math.max(8, Math.floor(png.width / 48))
    const sampleStepY = Math.max(8, Math.floor(png.height / 42))

    let count = 0
    let sum = 0
    let sumSquares = 0
    let nearWhiteCount = 0

    for (let y = 0; y < png.height; y += sampleStepY) {
      for (let x = 0; x < png.width; x += sampleStepX) {
        const idx = (png.width * y + x) << 2
        const r = png.data[idx]
        const g = png.data[idx + 1]
        const b = png.data[idx + 2]
        const a = png.data[idx + 3]

        if (a === 0) {
          continue
        }

        const gray = (r + g + b) / 3
        sum += gray
        sumSquares += gray * gray
        count += 1

        if (gray >= 240) {
          nearWhiteCount += 1
        }
      }
    }

    if (count === 0) {
      return false
    }

    const mean = sum / count
    const variance = Math.max(0, sumSquares / count - mean * mean)
    const stdDev = Math.sqrt(variance)
    const nearWhiteRatio = nearWhiteCount / count

    return mean >= 238 && stdDev <= 10 && nearWhiteRatio >= 0.94
  } catch {
    return false
  }
}

async function captureSingleViewportPng(page: Page) {
  return (await page.screenshot({
    type: "png",
    captureBeyondViewport: false,
  })) as Buffer
}

async function captureTopSliceWithRetry(page: Page) {
  await page.evaluate(() => {
    window.scrollTo(0, 0)
  })

  await waitForStableViewport(page, WAIT_BEFORE_FIRST_SLICE_MS)

  let raw = await captureSingleViewportPng(page)

  if (!isLikelyBlankTopSlice(raw)) {
    return raw
  }

  await forceTopRepaint(page)
  await waitForNetworkCalm(page)
  await waitForPageAssets(page)
  await waitForStableViewport(page, WAIT_BEFORE_RETRY_FIRST_SLICE_MS)

  raw = await captureSingleViewportPng(page)

  return raw
}

async function captureViewportSlices(page: Page, fullHeight: number) {
  const { positions, cappedHeight } = buildScrollPositions(
    fullHeight,
    VIEWPORT_HEIGHT
  )

  const finalPng = new PNG({
    width: VIEWPORT_WIDTH,
    height: cappedHeight,
  })

  for (let index = 0; index < positions.length; index += 1) {
    const y = positions[index]
    let raw: Buffer

    if (index === 0) {
      raw = await captureTopSliceWithRetry(page)
    } else {
      await page.evaluate((scrollY) => {
        window.scrollTo(0, scrollY)
      }, y)

      await waitForStableViewport(page, WAIT_AFTER_SCROLL_MS)
      raw = await captureSingleViewportPng(page)
    }

    const chunk = PNG.sync.read(raw)

    const sourceY = index === 0 ? 0 : SLICE_OVERLAP
    const destY = y + sourceY
    const remainingHeight = cappedHeight - destY
    const copyHeight = Math.min(chunk.height - sourceY, remainingHeight)

    if (copyHeight <= 0) {
      continue
    }

    PNG.bitblt(
      chunk,
      finalPng,
      0,
      sourceY,
      Math.min(chunk.width, VIEWPORT_WIDTH),
      copyHeight,
      0,
      destY
    )
  }

  return PNG.sync.write(finalPng)
}

async function captureFastFullPage(page: Page, fullHeight: number) {
  if (fullHeight > MAX_FAST_FULLPAGE_HEIGHT) {
    return null
  }

  try {
    const raw = (await page.screenshot({
      type: "jpeg",
      quality: JPEG_QUALITY,
      fullPage: true,
      captureBeyondViewport: true,
    })) as Buffer

    return `data:image/jpeg;base64,${raw.toString("base64")}`
  } catch {
    return null
  }
}

async function captureFallbackSlices(page: Page, fullHeight: number) {
  const stitchedScreenshot = await captureViewportSlices(page, fullHeight)

  return `data:image/png;base64,${Buffer.from(
    stitchedScreenshot
  ).toString("base64")}`
}

export async function takePageSnapshot(url: string): Promise<PageSnapshot> {
  const browser = await launchBrowser()

  try {
    const page = await browser.newPage()

    await page.setViewport({
      width: VIEWPORT_WIDTH,
      height: VIEWPORT_HEIGHT,
      deviceScaleFactor: 1,
    })

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    )

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    })

    await sleep(WAIT_AFTER_NAV_MS)
    await waitForNetworkCalm(page)
    await waitForPageAssets(page)
    await triggerLazyLoad(page)
    await waitForNetworkCalm(page)
    await waitForPageAssets(page)
    await preparePageForStableScreenshot(page)
    await waitForNetworkCalm(page)
    await waitForPageAssets(page)
    await forceRevealAboveTheFoldContent(page)
    await waitForNetworkCalm(page)
    await waitForPageAssets(page)
    await forceTopRepaint(page)
    await sleep(WAIT_AFTER_TOP_RESET_MS)

    const metrics = await getPageMetrics(page)
    const blocks = await collectBlocks(page)

    await page.evaluate(() => {
      window.scrollTo(0, 0)
    })

    await forceRevealAboveTheFoldContent(page)
    await forceTopRepaint(page)
    await sleep(WAIT_AFTER_TOP_RESET_MS)

    let screenshotUrl = await captureFastFullPage(page, metrics.fullHeight)

    if (!screenshotUrl) {
      screenshotUrl = await captureFallbackSlices(page, metrics.fullHeight)
    }

    return {
      screenshotUrl,
      blocks,
      pageTitle: normalizeText(metrics.pageTitle || ""),
      metaDescription: normalizeText(metrics.metaDescription || ""),
      textContent: normalizeText(metrics.textContent || "").slice(0, 18000),
    }
  } finally {
    await browser.close()
  }
}