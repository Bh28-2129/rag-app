require("dotenv").config({
  path: "backend/.env"
});

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const path = require("path");
const fs = require("fs");

const upload = require("./upload");
const { extractPDFText, chunkText } = require("./rag");
const { pool, initDb } = require("./db");

const { OpenAI } = require("openai");

const app = express();
app.set("trust proxy", 1);

const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN;
const isProduction = process.env.NODE_ENV === "production";

app.use(
  cors({
    origin: CLIENT_ORIGIN || true,
    credentials: true
  })
);
app.use(express.json());
app.use(
  session({
    store: new PgSession({
      pool,
      createTableIfMissing: true
    }),
    secret: process.env.SESSION_SECRET || "dev-session-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction,
      maxAge: 1000 * 60 * 60 * 24
    }
  })
);

const openai = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1"
});

const storedChunksByUser = new Map();

function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({
      error: "Unauthorized"
    });
  }

  return next();
}

function tryParseJson(text) {
  if (!text) {
    return null;
  }

  const cleaned = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) {
    return null;
  }

  try {
    return JSON.parse(match[0]);
  } catch (err) {
    return null;
  }
}

function buildPrompt(question, context, followUp) {
  if (followUp) {
    return `
Answer only using the provided context.

This is a follow-up request. Put the deeper explanation, examples, or step-by-step details ONLY in "extra_info".
Keep "answer" to a single-sentence recap.

Use a structured Markdown format with headings and an "Examples" subheading when examples are requested.

Return a JSON object with these keys:
- "answer": a one-sentence recap
- "extra_info": the detailed follow-up explanation with headings and examples
- "related_topics": an array of 3 to 6 short topic suggestions

Context:
${context}

Question:
${question}
`;
  }

  return `
Answer only using the provided context.

Provide a clear, easy-to-understand response with deep analysis. Use a structured Markdown format:
- Start with a main heading
- Use subheadings for sections (e.g., Overview, Key Points, Notation, Examples)
- If examples are included, add an "Examples" subheading with the examples beneath it

If the topic uses formulas, symbols, or notation, include them and explain what they mean in simple terms.
If the user asks to elaborate, expand the explanation with examples or step-by-step reasoning when possible.

Return a JSON object with these keys:
- "answer": structured Markdown with headings
- "extra_info": additional structured Markdown (can include deeper analysis, notation, or steps)
- "related_topics": an array of 3 to 6 short topic suggestions that a user might ask next

Context:
${context}

Question:
${question}
`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createCompletionWithRetry({ model, messages }, maxRetries = 2) {
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await openai.chat.completions.create({ model, messages });
    } catch (err) {
      lastError = err;
      if (err?.status === 429 && attempt < maxRetries) {
        await sleep(12000);
        continue;
      }
      break;
    }
  }

  throw lastError;
}

app.get("/", (req, res) => {
  res.send("RAG Server Running");
});

app.post("/auth/signup", async (req, res) => {
  try {
    const { name, email, password } = req.body || {};

    if (!name || !email || !password) {
      return res.status(400).json({
        error: "Name, email, and password are required."
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      "INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email",
      [name.trim(), email.trim().toLowerCase(), passwordHash]
    );

    const user = result.rows[0];
    req.session.userId = user.id;
    req.session.userName = user.name;
    req.session.userEmail = user.email;

    res.json({
      user
    });
  } catch (err) {
    if (err?.code === "23505") {
      return res.status(409).json({
        error: "Email already registered."
      });
    }

    console.error("Signup error", err);
    res.status(500).json({
      error: "Signup failed"
    });
  }
});

app.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({
        error: "Email and password are required."
      });
    }

    const result = await pool.query(
      "SELECT id, name, email, password_hash FROM users WHERE email = $1",
      [email.trim().toLowerCase()]
    );

    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({
        error: "Invalid credentials."
      });
    }

    const matches = await bcrypt.compare(password, user.password_hash);
    if (!matches) {
      return res.status(401).json({
        error: "Invalid credentials."
      });
    }

    req.session.userId = user.id;
    req.session.userName = user.name;
    req.session.userEmail = user.email;

    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email
      }
    });
  } catch (err) {
    console.error("Login error", err);
    res.status(500).json({
      error: "Login failed"
    });
  }
});

app.post("/auth/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Logout error", err);
      return res.status(500).json({
        error: "Logout failed"
      });
    }

    res.clearCookie("connect.sid");
    res.json({
      success: true
    });
  });
});

app.get("/auth/me", (req, res) => {
  if (!req.session?.userId) {
    return res.status(401).json({
      error: "Unauthorized"
    });
  }

  return res.json({
    user: {
      id: req.session.userId,
      name: req.session.userName || "",
      email: req.session.userEmail || ""
    }
  });
});

app.post("/upload", requireAuth, upload.single("pdf"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: "No file uploaded"
      });
    }

    const tempDir = path.join("/tmp", "rag-app");
    fs.mkdirSync(tempDir, { recursive: true });

    const safeName = `${Date.now()}${path.extname(req.file.originalname)}`;
    const pdfPath = path.join(tempDir, safeName);
    fs.writeFileSync(pdfPath, req.file.buffer);

    const text = await extractPDFText(req.file.buffer);

    const chunks = chunkText(text);
    storedChunksByUser.set(req.session.userId, chunks);

    const result = await pool.query(
      "INSERT INTO documents (user_id, original_name, stored_path) VALUES ($1, $2, $3) RETURNING id",
      [req.session.userId, req.file.originalname, pdfPath]
    );

    req.session.currentDocumentId = result.rows[0].id;
    req.session.lastQuestionId = null;

    res.json({
      success: true,
      chunks: chunks.length,
      documentId: req.session.currentDocumentId
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Upload failed"
    });
  }
});

app.post("/ask", requireAuth, async (req, res) => {
  try {

    const { question, followUp } = req.body;
    const currentDocumentId = req.session.currentDocumentId;
    const userId = req.session.userId;

    if (!currentDocumentId) {
      return res.status(400).json({
        error: "Upload a document first"
      });
    }

    const storedChunks = storedChunksByUser.get(userId) || [];
    if (!storedChunks.length) {
      return res.status(400).json({
        error: "No document uploaded"
      });
    }

    if (followUp && !req.session.lastQuestionId) {
      return res.status(400).json({
        error: "Ask a first question before follow-up"
      });
    }

    const questionResult = await pool.query(
      "INSERT INTO questions (user_id, document_id, question_text, is_followup, parent_question_id) VALUES ($1, $2, $3, $4, $5) RETURNING id",
      [
        userId,
        currentDocumentId,
        question,
        Boolean(followUp),
        followUp ? req.session.lastQuestionId : null
      ]
    );

    if (!followUp) {
      req.session.lastQuestionId = questionResult.rows[0].id;
    }

    const rawContext = storedChunks
      .slice(0, followUp ? 3 : 4)
      .join("\n");

    const context = rawContext.slice(0, 4000);
    const prompt = buildPrompt(question, context, followUp);

    const model = (process.env.GROQ_MODEL || "llama-3.1-8b-instant").trim();

    const response = await createCompletionWithRetry({
      model,
      messages: [
        {
          role: "user",
          content: prompt
        }
      ]
    });

    const content = response.choices[0]?.message?.content || "";
    const parsed = tryParseJson(content);

    const normalizedExtra = followUp
      ? (parsed?.extra_info || parsed?.answer || "")
      : (parsed?.extra_info || "");

    res.json({
      answer: parsed?.answer || content,
      extra_info: normalizedExtra,
      related_topics: Array.isArray(parsed?.related_topics)
        ? parsed.related_topics
        : []
    });

  } catch (err) {
    if (err?.status === 429) {
      return res.status(429).json({
        error: "Rate limited. Please wait a few seconds and try again.",
        details: {
          message: err?.message,
          status: err?.status,
          code: err?.code,
          type: err?.type
        }
      });
    }

    const errorDetails = {
      message: err?.message,
      status: err?.status,
      code: err?.code,
      type: err?.type,
      error: err?.error
    };

    console.error("Ask error", errorDetails);

    res.status(500).json({
      error: "Question failed",
      details: errorDetails
    });
  }
});

if (require.main === module) {
  initDb()
    .then(() => {
      app.listen(process.env.PORT, () => {
        console.log(
          `Server running on port ${process.env.PORT}`
        );
      });
    })
    .catch((err) => {
      console.error("Database init failed", err);
      process.exit(1);
    });
} else {
  initDb().catch((err) => {
    console.error("Database init failed", err);
  });
}

module.exports = app;