import fs from "node:fs"
import path from "node:path"
import chromium from "@sparticuz/chromium"
import puppeteer, { type Page } from "puppeteer-core"
import { PNG } from "pngjs"

export type PageBlock = {
  id: string
  type: string
  text: string
  x: number
  y: number
  width: number
  height: number
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
const JPEG_QUALITY = 72

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

    const images = Array.from(document.images || []).slice(0, 120)

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

      while (current < maxScroll && loops < 40) {
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

async function collectBlocks(page: Page): Promise<PageBlock[]> {
  const pageData = await page.evaluate(() => {
    function stripHtmlText(value: string) {
      return value.replace(/\s+/g, " ").trim()
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
      "button",
      "a",
      "[role='button']",
      "section",
      "article",
      "header",
      "main > div",
      "main section",
      "[class*='hero']",
      "[class*='cta']",
      "[class*='card']",
      "[class*='feature']",
      "[class*='testimonial']",
      "[class*='pricing']",
    ].join(",")

    const elements = Array.from(document.querySelectorAll(selector))
    const seen = new Set<string>()

    const blocks = elements
      .map((element, index) => {
        const rect = element.getBoundingClientRect()
        const style = window.getComputedStyle(element)
        const text = stripHtmlText(element.textContent || "")

        if (style.display === "none" || style.visibility === "hidden") {
          return null
        }

        if (rect.width < 120 || rect.height < 28) {
          return null
        }

        const absTop = rect.top + window.scrollY
        const area = rect.width * rect.height

        if (area < 8000) {
          return null
        }

        const key = [
          Math.round(rect.left),
          Math.round(absTop),
          Math.round(rect.width),
          Math.round(rect.height),
          text.slice(0, 80),
        ].join("|")

        if (seen.has(key)) {
          return null
        }

        seen.add(key)

        const tag = element.tagName.toLowerCase()
        let type = "content"

        if (tag === "h1" || tag === "h2" || tag === "h3") {
          type = "headline"
        } else if (
          tag === "button" ||
          tag === "a" ||
          element.getAttribute("role") === "button"
        ) {
          type = "cta"
        } else if (
          tag === "section" ||
          tag === "article" ||
          tag === "header"
        ) {
          type = "section"
        }

        return {
          id: `block-${index + 1}`,
          type,
          text,
          x: Number(((rect.left / window.innerWidth) * 100).toFixed(2)),
          y: Number(((absTop / fullHeight) * 100).toFixed(2)),
          width: Number(((rect.width / window.innerWidth) * 100).toFixed(2)),
          height: Number(((rect.height / fullHeight) * 100).toFixed(2)),
        }
      })
      .filter(Boolean)
      .slice(0, 60)

    return { blocks }
  })

  return (pageData.blocks as PageBlock[])
    .map((block) => ({
      ...block,
      text: normalizeText(block.text),
    }))
    .filter((block) => block.y >= 0 && block.y <= 100)
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
    await forceTopRepaint(page)
    await sleep(WAIT_AFTER_TOP_RESET_MS)

    const metrics = await getPageMetrics(page)
    const blocks = await collectBlocks(page)

    await page.evaluate(() => {
      window.scrollTo(0, 0)
    })

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