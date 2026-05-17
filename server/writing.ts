import { Router, Response, NextFunction } from "express";
import { guestOrAuthMiddleware, AuthRequest } from "./auth";
import prisma from "./db";
import OpenAI from "openai";

const router = Router();

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const USE_REAL_AI = !!(
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY &&
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL
);

const openai = USE_REAL_AI
  ? new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    })
  : null;

type Plan = "FREE" | "BASE" | "PRO";

async function getUserPlan(userId: string): Promise<Plan> {
  try {
    const ent = await prisma.entitlement.findUnique({ where: { userId } });
    if (!ent) return "FREE";
    if (ent.expiresAt && ent.expiresAt.getTime() < Date.now()) return "FREE";
    const p = ent.plan.toUpperCase();
    if (p === "PRO") return "PRO";
    if (p === "BASE") return "BASE";
    return "FREE";
  } catch {
    return "FREE";
  }
}

const REVIEWER_EMAIL = "reviewer@studymindapp.com";

function requirePlan(...allowed: Plan[]) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (req.user?.email === REVIEWER_EMAIL) return next();
    const plan = await getUserPlan(req.user!.id);
    if (allowed.includes(plan)) return next();
    const highest = allowed.includes("BASE") ? "BASE" : "PRO";
    return res
      .status(403)
      .json({ type: "PAYWALL_REQUIRED", planRequired: highest });
  };
}

interface BucketRecord {
  count: number;
  resetAt: number;
}

const minuteBuckets = new Map<string, BucketRecord>();
const dayBuckets = new Map<string, BucketRecord>();

function cleanBuckets(map: Map<string, BucketRecord>) {
  const now = Date.now();
  for (const [k, v] of map) {
    if (v.resetAt <= now) map.delete(k);
  }
}
setInterval(() => cleanBuckets(minuteBuckets), 60_000);
setInterval(() => cleanBuckets(dayBuckets), 300_000);

function writingRateLimit() {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const uid = req.user!.id;
    const now = Date.now();

    let minRec = minuteBuckets.get(uid);
    if (!minRec || minRec.resetAt <= now) {
      minRec = { count: 0, resetAt: now + 60_000 };
      minuteBuckets.set(uid, minRec);
    }
    minRec.count++;
    if (minRec.count > 2) {
      return res.status(429).json({ code: "RATE_LIMIT_MINUTE" });
    }

    const isReviewer = req.user?.email === REVIEWER_EMAIL;
    const plan = isReviewer ? "PRO" : await getUserPlan(uid);
    const dayMax = plan === "FREE" ? 5 : 50;

    const dayKey = `${uid}:day`;
    let dayRec = dayBuckets.get(dayKey);
    if (!dayRec || dayRec.resetAt <= now) {
      const midnight = new Date();
      midnight.setHours(23, 59, 59, 999);
      dayRec = { count: 0, resetAt: midnight.getTime() };
      dayBuckets.set(dayKey, dayRec);
    }
    dayRec.count++;
    if (dayRec.count > dayMax) {
      return res.status(429).json({ code: "RATE_LIMIT_DAY" });
    }

    next();
  };
}

const SYSTEM_PROMPT = `You are an educational writing tutor. Your purpose is to help students improve their own academic writing skills.

Rules you MUST follow:
- Never write essays, papers, or assignments on the student's behalf that could be submitted as their own work without substantial personal contribution.
- Never fabricate citations, references, or sources. If a source is needed, insert "(Source needed)" as a placeholder.
- Never help students evade plagiarism detection.
- Always encourage original thinking and proper attribution.
- Focus on teaching writing techniques, not producing final submissions.`;

async function callAI(userPrompt: string): Promise<string | null> {
  if (!openai) {
    if (IS_PRODUCTION) return null;
    return null;
  }
  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    max_tokens: 3000,
    temperature: 0.7,
  });
  return resp.choices[0]?.message?.content ?? null;
}

function requireAI(_req: AuthRequest, res: Response, next: NextFunction) {
  if (!USE_REAL_AI && IS_PRODUCTION) {
    return res.status(503).json({ code: "AI_UNAVAILABLE" });
  }
  next();
}

// POST /outline
router.post(
  "/outline",
  guestOrAuthMiddleware,
  requireAI,
  writingRateLimit(),
  async (req: AuthRequest, res: Response) => {
    try {
      const { thesis, subject, level } = req.body;
      if (!thesis) return res.status(400).json({ error: "thesis is required" });

      const prompt = `Create an academic paper outline for the following thesis:
"${thesis}"
${subject ? `Subject area: ${subject}` : ""}
${level ? `Academic level: ${level}` : ""}

Provide:
1. A refined thesis statement
2. 3-5 main sections with brief descriptions of what each should cover
3. A counterargument section
4. A conclusion section
5. 5 search keywords the student should use to find credible sources

Format as structured text with clear headings.`;

      const result = await callAI(prompt);
      if (!result) {
        if (IS_PRODUCTION)
          return res.status(503).json({ code: "AI_UNAVAILABLE" });
        return res.json({
          outline: `# Outline for: ${thesis}\n\n## 1. Introduction\nPresent the thesis: "${thesis}"\n\n## 2. Background & Context\nProvide relevant history and definitions.\n\n## 3. Main Argument\nPresent evidence supporting the thesis.\n\n## 4. Supporting Evidence\nAdditional data, studies, and examples.\n\n## 5. Counterargument\nAddress opposing viewpoints and rebut them.\n\n## 6. Conclusion\nSummarize findings and restate thesis.\n\n### Search Keywords\n1. ${subject || "academic research"}\n2. ${thesis.split(" ").slice(0, 3).join(" ")}\n3. scholarly analysis\n4. peer-reviewed studies\n5. literature review`,
        });
      }
      res.json({ outline: result });
    } catch (error) {
      console.error("Writing outline error:", error);
      res.status(500).json({ error: "Failed to generate outline" });
    }
  },
);

// POST /draft
router.post(
  "/draft",
  guestOrAuthMiddleware,
  requireAI,
  writingRateLimit(),
  async (req: AuthRequest, res: Response) => {
    try {
      const { outlineText, wordCount, tone } = req.body;
      if (!outlineText)
        return res.status(400).json({ error: "outlineText is required" });

      const targetWords = wordCount || 800;
      const low = Math.round(targetWords * 0.9);
      const high = Math.round(targetWords * 1.1);

      const prompt = `Using the following outline, write a draft academic paper. The draft should be ${low}-${high} words.
${tone ? `Tone: ${tone}` : "Tone: academic and formal"}

Outline:
${outlineText}

At the end, add a "What to verify" checklist with items the student should fact-check, sources they need to find, and claims that need citations. Mark any unsupported claims with "(Source needed)".`;

      const result = await callAI(prompt);
      if (!result) {
        if (IS_PRODUCTION)
          return res.status(503).json({ code: "AI_UNAVAILABLE" });
        return res.json({
          draft: `# Draft\n\nBased on the provided outline, here is a starting draft.\n\n${outlineText}\n\n---\n\n## What to verify\n- [ ] Find primary sources for main claims\n- [ ] Verify statistical data (Source needed)\n- [ ] Add proper citations in required format\n- [ ] Check all quotes for accuracy\n- [ ] Confirm counterargument sources`,
        });
      }
      res.json({ draft: result });
    } catch (error) {
      console.error("Writing draft error:", error);
      res.status(500).json({ error: "Failed to generate draft" });
    }
  },
);

// POST /revise
router.post(
  "/revise",
  guestOrAuthMiddleware,
  requireAI,
  writingRateLimit(),
  async (req: AuthRequest, res: Response) => {
    try {
      const { text, instructions } = req.body;
      if (!text) return res.status(400).json({ error: "text is required" });

      const prompt = `Revise the following academic text to improve its quality. ${instructions ? `Special instructions: ${instructions}` : ""}

Original text:
${text}

Provide:
1. The improved version of the full text
2. A bullet-point summary of exactly 5 improvements you made and why

Do NOT add new factual claims. Mark any existing unsupported claims with "(Source needed)".`;

      const result = await callAI(prompt);
      if (!result) {
        if (IS_PRODUCTION)
          return res.status(503).json({ code: "AI_UNAVAILABLE" });
        return res.json({
          revised: `${text}\n\n---\n\n### Improvements Made\n- Improved sentence structure for clarity\n- Enhanced transitions between paragraphs\n- Strengthened topic sentences\n- Refined word choice for academic tone\n- Added logical connectors for better flow`,
        });
      }
      res.json({ revised: result });
    } catch (error) {
      console.error("Writing revise error:", error);
      res.status(500).json({ error: "Failed to revise text" });
    }
  },
);

// POST /style-edit
router.post(
  "/style-edit",
  guestOrAuthMiddleware,
  requireAI,
  writingRateLimit(),
  async (req: AuthRequest, res: Response) => {
    try {
      const { text, mode } = req.body;
      if (!text) return res.status(400).json({ error: "text is required" });

      const validModes = [
        "clearer",
        "formal",
        "casual",
        "shorten",
        "flow",
        "grammar",
      ];
      const editMode = validModes.includes(mode) ? mode : "clearer";

      const modeInstructions: Record<string, string> = {
        clearer:
          "Rewrite for maximum clarity. Simplify complex sentences. Remove ambiguity.",
        formal:
          "Adjust the tone to be more formal and academic. Use precise vocabulary.",
        casual:
          "Adjust the tone to be more conversational and accessible while keeping accuracy.",
        shorten:
          "Condense the text by ~30% while preserving all key information.",
        flow: "Improve the flow and transitions between sentences and paragraphs.",
        grammar:
          "Fix all grammar, punctuation, and spelling errors. Do not change meaning or style.",
      };

      const prompt = `Apply the following style edit to the text. Mode: "${editMode}"
Instructions: ${modeInstructions[editMode]}

IMPORTANT: Do NOT introduce any new facts, claims, or information. Only edit the style/presentation.

Text:
${text}`;

      const result = await callAI(prompt);
      if (!result) {
        if (IS_PRODUCTION)
          return res.status(503).json({ code: "AI_UNAVAILABLE" });
        return res.json({ edited: text });
      }
      res.json({ edited: result });
    } catch (error) {
      console.error("Writing style-edit error:", error);
      res.status(500).json({ error: "Failed to style-edit text" });
    }
  },
);

// POST /clean
router.post(
  "/clean",
  guestOrAuthMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const { text } = req.body;
      if (!text || typeof text !== "string") {
        return res.status(400).json({ error: "text is required" });
      }

      const original = text;
      let cleaned = text;

      cleaned = cleaned.replace(/<[^>]*>/g, "");

      cleaned = cleaned.replace(
        /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g,
        "",
      );

      cleaned = cleaned.replace(/[\u2018\u2019]/g, "'");
      cleaned = cleaned.replace(/[\u201C\u201D]/g, '"');
      cleaned = cleaned.replace(/\u2014/g, "—");
      cleaned = cleaned.replace(/\u2013/g, "–");
      cleaned = cleaned.replace(/\u2026/g, "...");

      cleaned = cleaned.replace(/[^\S\n]+/g, " ");
      cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
      cleaned = cleaned.trim();

      const htmlTagsRemoved = (original.match(/<[^>]*>/g) || []).length;
      const zeroWidthRemoved = (
        original.match(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g) || []
      ).length;
      const smartQuotesFixed = (
        original.match(/[\u2018\u2019\u201C\u201D]/g) || []
      ).length;
      const charDiff = original.length - cleaned.length;

      res.json({
        cleanedText: cleaned,
        stats: {
          originalLength: original.length,
          cleanedLength: cleaned.length,
          charactersRemoved: charDiff,
          htmlTagsRemoved,
          zeroWidthCharsRemoved: zeroWidthRemoved,
          smartQuotesNormalized: smartQuotesFixed,
        },
      });
    } catch (error) {
      console.error("Writing clean error:", error);
      res.status(500).json({ error: "Failed to clean text" });
    }
  },
);

export default router;
