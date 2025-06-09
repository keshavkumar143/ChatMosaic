const express = require("express");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const compression = require("compression");
const morgan = require("morgan");
const fs = require("fs");
const path = require("path");
const marked = require("marked");
const hljs = require("highlight.js");
const createDOMPurify = require("isomorphic-dompurify");

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();

// Create a write stream for logging
const accessLogStream = fs.createWriteStream(
  path.join(__dirname, "access.log"),
  { flags: "a" }
);

// Configure marked with advanced renderer and styling
const renderer = new marked.Renderer();

// Custom renderer for better styling
renderer.heading = function (text, level) {
  const escapedText = text.toLowerCase().replace(/[^\w]+/g, "-");
  return `<h${level} id="${escapedText}" class="heading-${level} mb-4 font-bold text-gray-800 dark:text-gray-200">
    ${text}
  </h${level}>`;
};

renderer.paragraph = function (text) {
  return `<p class="mb-4 text-gray-700 dark:text-gray-300 leading-relaxed">${text}</p>`;
};

renderer.code = function (code, language) {
  const validLang = hljs.getLanguage(language || "") ? language : "";
  const highlighted = validLang
    ? hljs.highlight(code, { language: validLang }).value
    : hljs.highlightAuto(code).value;

  return `<pre class="bg-gray-900 rounded-lg p-4 mb-4 overflow-x-auto">
    <code class="hljs ${validLang} text-sm">${highlighted}</code>
  </pre>`;
};

renderer.blockquote = function (quote) {
  return `<blockquote class="border-l-4 border-blue-500 pl-4 mb-4 italic text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 py-2">
    ${quote}
  </blockquote>`;
};

renderer.list = function (body, ordered, start) {
  const type = ordered ? "ol" : "ul";
  const className = ordered
    ? "list-decimal list-inside mb-4 space-y-2"
    : "list-disc list-inside mb-4 space-y-2";
  return `<${type} class="${className} text-gray-700 dark:text-gray-300">${body}</${type}>`;
};

renderer.listitem = function (text) {
  return `<li class="mb-1 leading-relaxed">${text}</li>`;
};

renderer.table = function (header, body) {
  return `<div class="overflow-x-auto mb-4">
    <table class="min-w-full border-collapse border border-gray-300 dark:border-gray-600">
      <thead class="bg-gray-50 dark:bg-gray-800">${header}</thead>
      <tbody>${body}</tbody>
    </table>
  </div>`;
};

renderer.tablerow = function (content) {
  return `<tr class="border-b border-gray-200 dark:border-gray-700">${content}</tr>`;
};

renderer.tablecell = function (content, flags) {
  const type = flags.header ? "th" : "td";
  const className = flags.header
    ? "px-4 py-2 text-left font-semibold text-gray-900 dark:text-gray-100"
    : "px-4 py-2 text-gray-700 dark:text-gray-300";
  return `<${type} class="${className}">${content}</${type}>`;
};

renderer.strong = function (text) {
  return `<strong class="font-bold text-gray-900 dark:text-gray-100">${text}</strong>`;
};

renderer.em = function (text) {
  return `<em class="italic text-gray-800 dark:text-gray-200">${text}</em>`;
};

renderer.codespan = function (text) {
  return `<code class="bg-gray-100 dark:bg-gray-800 text-pink-600 dark:text-pink-400 px-1 py-0.5 rounded text-sm font-mono">${text}</code>`;
};

renderer.link = function (href, title, text) {
  return `<a href="${href}" ${
    title ? `title="${title}"` : ""
  } class="text-blue-600 dark:text-blue-400 hover:underline" target="_blank" rel="noopener noreferrer">${text}</a>`;
};

// Configure marked with enhanced options
marked.setOptions({
  renderer: renderer,
  highlight: function (code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value;
    }
    return hljs.highlightAuto(code).value;
  },
  breaks: true,
  gfm: true,
  sanitize: false, // We'll use DOMPurify instead
  smartLists: true,
  smartypants: true,
});

// Middleware setup
app.use(express.json({ limit: "10mb" }));
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:3000",
      "https://your-domain.com",
    ],
    methods: ["GET", "POST", "DELETE", "PUT", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    credentials: true,
  })
);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
      },
    },
  })
);
app.use(compression());
app.use(morgan("combined", { stream: accessLogStream }));

// Enhanced rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many requests from this IP",
    retryAfter: "15 minutes",
  },
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === "/api/health";
  },
});
app.use("/api/", apiLimiter);

// MongoDB connection with retry logic
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URL, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    console.log("Connected to MongoDB");
  } catch (err) {
    console.error("MongoDB connection error:", err);
    console.log("Retrying connection in 5 seconds...");
    setTimeout(connectDB, 5000);
  }
};

connectDB();

// Handle MongoDB events
mongoose.connection.on("disconnected", () => {
  console.log("MongoDB disconnected. Attempting to reconnect...");
  connectDB();
});

mongoose.connection.on("error", (err) => {
  console.error("MongoDB connection error:", err);
});

mongoose.connection.on("reconnected", () => {
  console.log("MongoDB reconnected");
});

// Initialize Google Generative AI
const genAI = new GoogleGenerativeAI(process.env.API_KEY);

// Enhanced Response Schema
const ResponseSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    question: {
      type: String,
      required: true,
      maxlength: 5000,
      trim: true,
    },
    answer: {
      type: String,
      required: true,
    },
    formattedAnswer: {
      type: String,
      required: true,
    },
    processingTime: {
      type: Number,
      default: 0,
    },
    metadata: {
      hasContext: { type: Boolean, default: false },
      questionLength: Number,
      responseLength: Number,
      userAgent: String,
      ipAddress: String,
      model: String,
      temperature: Number,
    },
    tags: [String],
    rating: {
      type: Number,
      min: 1,
      max: 5,
    },
    isStarred: {
      type: Boolean,
      default: false,
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Add text search index
ResponseSchema.index(
  {
    question: "text",
    answer: "text",
  },
  {
    weights: {
      question: 10,
      answer: 5,
    },
  }
);

// Add compound indexes for better query performance
ResponseSchema.index({ timestamp: -1, rating: -1 });
ResponseSchema.index({ isStarred: 1, timestamp: -1 });

const Response = mongoose.model("Response", ResponseSchema);

// Utility functions
const validateAndSanitizeInput = (question) => {
  if (!question || typeof question !== "string") {
    throw new Error("Question must be a non-empty string");
  }

  const trimmed = question.trim();

  if (trimmed.length === 0) {
    throw new Error("Question cannot be empty");
  }

  if (trimmed.length > 5000) {
    throw new Error("Question is too long (maximum 5000 characters)");
  }

  // Basic content filtering for safety
  const suspiciousPatterns = [
    /(?:hack|exploit|vulnerability|malware|virus)\s+(?:system|network|database)/i,
    /(?:how\s+to\s+(?:hack|break|exploit))/i,
    /(?:illegal|drugs|weapons|violence)\s+(?:buy|sell|make|create)/i,
  ];

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(trimmed)) {
      console.warn(
        "Potentially suspicious input detected:",
        trimmed.substring(0, 100)
      );
      // Don't block, just log for monitoring
    }
  }

  return trimmed;
};

const generateAIResponse = async (
  question,
  context = null,
  userPreferences = {}
) => {
  const model = genAI.getGenerativeModel({
    model: process.env.AI_MODEL || "gemini-1.5-flash",
    generationConfig: {
      maxOutputTokens: parseInt(process.env.MAX_TOKENS || "2048"),
      temperature: parseFloat(
        userPreferences.temperature || process.env.TEMPERATURE || "0.7"
      ),
      topP: 0.9,
      topK: 40,
    },
  });

  const systemPrompt = `You are ChatMosaic, an intelligent AI assistant. Follow these guidelines:

**Formatting Rules:**
- Use **bold** for important terms and emphasis
- Use *italics* for subtle emphasis or technical terms
- Use proper markdown headers (##, ###) for section organization
- Format code with language-specific blocks: \`\`\`javascript, \`\`\`python, etc.
- Use > for important quotes or callouts
- Create numbered lists for steps and bullet points for features
- Use tables for structured data comparison
- Use horizontal rules (---) to separate major sections when appropriate

**Response Quality:**
- Provide comprehensive, well-structured answers
- Include practical examples when explaining concepts
- Break down complex topics into digestible sections
- Use appropriate technical depth based on question complexity
- Provide actionable advice when possible
- Include relevant context and background information

**Code Examples:**
- Always include complete, working examples
- Add comments to explain complex logic
- Use consistent naming conventions
- Include error handling where appropriate

**Tone & Style:**
- Professional yet approachable and friendly
- Clear and concise explanations
- Encouraging and helpful
- Avoid overly casual language
- Be enthusiastic about helping solve problems`;

  const chat = model.startChat({
    history: [
      {
        role: "user",
        parts: [{ text: systemPrompt }],
      },
      {
        role: "model",
        parts: [
          {
            text: "I understand! I'll provide well-formatted, comprehensive responses using proper markdown structure with appropriate styling for headings, code blocks, lists, and emphasis. I'll maintain a professional yet friendly tone while ensuring clarity, practical examples, and actionable advice in all my responses.",
          },
        ],
      },
    ],
  });

  // Add context if provided (for follow-up questions)
  const contextualQuestion = context
    ? `Context from previous conversation: ${context}\n\nCurrent question: ${question}`
    : question;

  const result = await chat.sendMessage(contextualQuestion);
  const response = await result.response;
  return response.text();
};

const formatResponse = (text) => {
  try {
    // Process markdown to HTML
    let html = marked.parse(text);

    // Sanitize HTML to prevent XSS while preserving styling
    html = createDOMPurify.sanitize(html, {
      ALLOWED_TAGS: [
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "p",
        "br",
        "strong",
        "em",
        "u",
        "i",
        "b",
        "ul",
        "ol",
        "li",
        "blockquote",
        "code",
        "pre",
        "a",
        "table",
        "thead",
        "tbody",
        "tr",
        "th",
        "td",
        "div",
        "span",
        "img",
        "hr",
      ],
      ALLOWED_ATTR: [
        "class",
        "id",
        "href",
        "target",
        "rel",
        "src",
        "alt",
        "title",
      ],
      ALLOWED_URI_REGEXP:
        /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|cid|xmpp):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
    });

    // Add wrapper div with responsive classes
    return `<div class="prose prose-lg max-w-none dark:prose-invert prose-headings:text-gray-900 prose-headings:dark:text-gray-100 prose-p:text-gray-700 prose-p:dark:text-gray-300 prose-a:text-blue-600 prose-a:dark:text-blue-400 prose-strong:text-gray-900 prose-strong:dark:text-gray-100 prose-code:text-pink-600 prose-code:dark:text-pink-400 prose-pre:bg-gray-900 prose-pre:dark:bg-gray-800">
      ${html}
    </div>`;
  } catch (error) {
    console.error("Error formatting response:", error);
    // Fallback to simple HTML escaping
    return `<div class="prose prose-lg max-w-none">
      <p class="text-gray-700 dark:text-gray-300">${text
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")}</p>
    </div>`;
  }
};

// API Routes

// Health check endpoint
app.get("/api/health", (req, res) => {
  const dbStatus = mongoose.connection.readyState;
  const dbStatusText =
    {
      0: "disconnected",
      1: "connected",
      2: "connecting",
      3: "disconnecting",
    }[dbStatus] || "unknown";

  res.status(200).json({
    status: "ok",
    message: "ChatMosaic API is running",
    timestamp: new Date().toISOString(),
    dbStatus: dbStatusText,
    version: process.env.API_VERSION || "1.0.0",
    uptime: process.uptime(),
  });
});

// Enhanced chat endpoint
app.post("/api/chat", async (req, res) => {
  const startTime = Date.now();

  try {
    const { question, context, preferences = {} } = req.body;

    // Validate and sanitize input
    const sanitizedQuestion = validateAndSanitizeInput(question);

    // Get user info for metadata
    const userAgent = req.get("User-Agent") || "unknown";
    const ipAddress = req.ip || req.connection.remoteAddress || "unknown";

    // Generate response from AI with context and preferences
    const text = await generateAIResponse(
      sanitizedQuestion,
      context,
      preferences
    );

    // Format the response with enhanced styling
    const formattedText = formatResponse(text);

    // Save to database with enhanced metadata
    const newResponse = new Response({
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      question: sanitizedQuestion,
      answer: text,
      formattedAnswer: formattedText,
      processingTime: Date.now() - startTime,
      metadata: {
        hasContext: !!context,
        questionLength: sanitizedQuestion.length,
        responseLength: text.length,
        userAgent: userAgent,
        ipAddress: ipAddress.replace(/^.*:/, ""), // Remove IPv6 prefix if present
        model: process.env.AI_MODEL || "gemini-1.5-flash",
        temperature:
          preferences.temperature ||
          parseFloat(process.env.TEMPERATURE || "0.7"),
      },
    });

    await newResponse.save();

    // Return enhanced response
    res.status(200).json({
      id: newResponse.id,
      answer: text,
      formattedAnswer: formattedText,
      timestamp: newResponse.timestamp,
      processingTime: newResponse.processingTime,
      metadata: {
        questionLength: newResponse.metadata.questionLength,
        responseLength: newResponse.metadata.responseLength,
        model: newResponse.metadata.model,
      },
    });
  } catch (error) {
    console.error("Error processing request:", error);

    // Enhanced error handling
    let statusCode = 500;
    let errorMessage = "Failed to process your request";
    let errorCode = "INTERNAL_ERROR";

    if (error.message.includes("Question")) {
      statusCode = 400;
      errorMessage = error.message;
      errorCode = "VALIDATION_ERROR";
    } else if (
      error.code === "RESOURCE_EXHAUSTED" ||
      error.message.includes("quota")
    ) {
      statusCode = 429;
      errorMessage = "AI service quota exceeded. Please try again later.";
      errorCode = "QUOTA_EXCEEDED";
    } else if (error.name === "ValidationError") {
      statusCode = 400;
      errorMessage = "Invalid input data";
      errorCode = "VALIDATION_ERROR";
    } else if (error.code === "ENOTFOUND" || error.code === "ECONNREFUSED") {
      statusCode = 503;
      errorMessage = "Service temporarily unavailable";
      errorCode = "SERVICE_UNAVAILABLE";
    }

    res.status(statusCode).json({
      error: errorMessage,
      code: errorCode,
      timestamp: new Date().toISOString(),
      requestId: `req_${Date.now()}`,
      details:
        process.env.NODE_ENV === "production" ? undefined : error.message,
    });
  }
});

// Get all responses with enhanced filtering and sorting
app.get("/api/chat", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 10, 50); // Max 50 per page
    const skip = (page - 1) * limit;
    const sortBy = req.query.sortBy || "timestamp";
    const sortOrder = req.query.sortOrder === "asc" ? 1 : -1;
    const starred = req.query.starred === "true";
    const minRating = req.query.minRating
      ? parseInt(req.query.minRating)
      : null;

    // Build filter object
    const filter = {};
    if (starred) filter.isStarred = true;
    if (minRating) filter.rating = { $gte: minRating };

    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder;

    const responses = await Response.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .select("-metadata.userAgent -metadata.ipAddress"); // Exclude sensitive data

    const total = await Response.countDocuments(filter);

    res.status(200).json({
      responses,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit),
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1,
      },
      filters: {
        starred,
        minRating,
        sortBy,
        sortOrder: sortOrder === 1 ? "asc" : "desc",
      },
    });
  } catch (error) {
    console.error("Error fetching responses:", error);
    res.status(500).json({
      error: "Failed to fetch responses",
      code: "FETCH_ERROR",
      timestamp: new Date().toISOString(),
      details:
        process.env.NODE_ENV === "production" ? undefined : error.message,
    });
  }
});

// Get single response by ID
app.get("/api/chat/:id", async (req, res) => {
  try {
    const response = await Response.findOne({ id: req.params.id }).select(
      "-metadata.userAgent -metadata.ipAddress"
    );

    if (!response) {
      return res.status(404).json({
        error: "Response not found",
        code: "NOT_FOUND",
        id: req.params.id,
      });
    }

    res.status(200).json(response);
  } catch (error) {
    console.error("Error fetching response:", error);
    res.status(500).json({
      error: "Failed to fetch response",
      code: "FETCH_ERROR",
      details:
        process.env.NODE_ENV === "production" ? undefined : error.message,
    });
  }
});

// Update response (star, rate, tag)
app.put("/api/chat/:id", async (req, res) => {
  try {
    const { isStarred, rating, tags } = req.body;
    const updateData = {};

    if (typeof isStarred === "boolean") updateData.isStarred = isStarred;
    if (rating && rating >= 1 && rating <= 5) updateData.rating = rating;
    if (Array.isArray(tags)) updateData.tags = tags;

    const response = await Response.findOneAndUpdate(
      { id: req.params.id },
      updateData,
      { new: true, runValidators: true }
    ).select("-metadata.userAgent -metadata.ipAddress");

    if (!response) {
      return res.status(404).json({
        error: "Response not found",
        code: "NOT_FOUND",
      });
    }

    res.status(200).json({
      message: "Response updated successfully",
      response,
    });
  } catch (error) {
    console.error("Error updating response:", error);
    res.status(500).json({
      error: "Failed to update response",
      code: "UPDATE_ERROR",
      details:
        process.env.NODE_ENV === "production" ? undefined : error.message,
    });
  }
});

// Delete response endpoint
app.delete("/api/chat/:id", async (req, res) => {
  try {
    const result = await Response.findOneAndDelete({ id: req.params.id });

    if (result) {
      res.status(200).json({
        message: "Response deleted successfully",
        id: req.params.id,
      });
    } else {
      res.status(404).json({
        error: "Response not found",
        code: "NOT_FOUND",
        id: req.params.id,
      });
    }
  } catch (error) {
    console.error("Error deleting response:", error);
    res.status(500).json({
      error: "Failed to delete response",
      code: "DELETE_ERROR",
      details:
        process.env.NODE_ENV === "production" ? undefined : error.message,
    });
  }
});

// Search endpoint
app.get("/api/search", async (req, res) => {
  try {
    const { q, page = 1, limit = 10 } = req.query;

    if (!q || q.trim().length === 0) {
      return res.status(400).json({
        error: "Search query is required",
        code: "VALIDATION_ERROR",
      });
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const results = await Response.find(
      { $text: { $search: q } },
      { score: { $meta: "textScore" } }
    )
      .sort({ score: { $meta: "textScore" } })
      .skip(skip)
      .limit(parseInt(limit))
      .select("-metadata.userAgent -metadata.ipAddress");

    const total = await Response.countDocuments({ $text: { $search: q } });

    res.json({
      query: q,
      results,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("Search error:", error);
    res.status(500).json({
      error: "Search failed",
      code: "SEARCH_ERROR",
      details:
        process.env.NODE_ENV === "production" ? undefined : error.message,
    });
  }
});

// Analytics endpoint
app.get("/api/analytics", async (req, res) => {
  try {
    const [summary, recentActivity, topRated] = await Promise.all([
      Response.aggregate([
        {
          $group: {
            _id: null,
            totalResponses: { $sum: 1 },
            avgProcessingTime: { $avg: "$processingTime" },
            avgQuestionLength: { $avg: "$metadata.questionLength" },
            avgResponseLength: { $avg: "$metadata.responseLength" },
            starredCount: { $sum: { $cond: ["$isStarred", 1, 0] } },
            ratedCount: { $sum: { $cond: [{ $ne: ["$rating", null] }, 1, 0] } },
          },
        },
      ]),
      Response.find()
        .sort({ timestamp: -1 })
        .limit(5)
        .select("question timestamp processingTime rating"),
      Response.find({ rating: { $exists: true } })
        .sort({ rating: -1, timestamp: -1 })
        .limit(5)
        .select("question rating timestamp"),
    ]);

    res.json({
      summary: summary[0] || {},
      recentActivity,
      topRated,
    });
  } catch (error) {
    console.error("Analytics error:", error);
    res.status(500).json({
      error: "Failed to generate analytics",
      code: "ANALYTICS_ERROR",
    });
  }
});

// Export responses endpoint
app.get("/api/export", async (req, res) => {
  try {
    const format = req.query.format || "json";
    const responses = await Response.find()
      .sort({ timestamp: -1 })
      .select("-metadata.userAgent -metadata.ipAddress -__v");

    if (format === "csv") {
      // Simple CSV export
      const csv = [
        "ID,Question,Answer,Timestamp,Rating,Starred",
        ...responses.map(
          (r) =>
            `"${r.id}","${r.question.replace(/"/g, '""')}","${r.answer.replace(
              /"/g,
              '""'
            )}","${r.timestamp}","${r.rating || ""}","${r.isStarred || false}"`
        ),
      ].join("\n");

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="chatmosaic-export.csv"'
      );
      res.send(csv);
    } else {
      res.setHeader("Content-Type", "application/json");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="chatmosaic-export.json"'
      );
      res.json(responses);
    }
  } catch (error) {
    console.error("Export error:", error);
    res.status(500).json({
      error: "Export failed",
      code: "EXPORT_ERROR",
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({
    error: "Internal server error",
    code: "INTERNAL_ERROR",
    timestamp: new Date().toISOString(),
    requestId: `req_${Date.now()}`,
    details: process.env.NODE_ENV === "production" ? undefined : err.message,
  });
});

// Handle 404 errors
app.use((req, res) => {
  res.status(404).json({
    error: "Endpoint not found",
    code: "NOT_FOUND",
    path: req.path,
    method: req.method,
  });
});

// Start server
const PORT = process.env.PORT || 8000;
const server = app.listen(PORT, () => {
  console.log(`ChatMosaic server is running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`API Version: ${process.env.API_VERSION || "1.0.0"}`);
});

// Graceful shutdown
const gracefulShutdown = (signal) => {
  console.log(`${signal} signal received. Shutting down gracefully...`);
  server.close(() => {
    console.log("HTTP server closed");
    mongoose.connection.close(() => {
      console.log("MongoDB connection closed");
      process.exit(0);
    });
  });
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Handle uncaught exceptions
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
  // Attempt graceful shutdown
  gracefulShutdown("UNCAUGHT_EXCEPTION");
});

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  // Close server and exit process
  server.close(() => {
    process.exit(1);
  });
});

module.exports = app;
