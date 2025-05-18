const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const fs = require('fs');
const path = require('path');
const marked = require('marked'); // Added for Markdown processing
const hljs = require('highlight.js'); // Added for code highlighting

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();

// Create a write stream for logging
const accessLogStream = fs.createWriteStream(
  path.join(__dirname, 'access.log'),
  { flags: 'a' }
);

// Configure marked with highlight.js for code highlighting
marked.setOptions({
  highlight: function(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value;
    }
    return hljs.highlightAuto(code).value;
  },
  breaks: true,
  gfm: true
});

// Middleware setup
app.use(express.json({ limit: '10mb' }));
app.use(cors({
  origin: 'http://localhost:5173', 
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(helmet()); // Security headers
app.use(compression()); // Compress responses
app.use(morgan('combined', { stream: accessLogStream })); // Logging

// Rate limiting to prevent abuse
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests from this IP, please try again after 15 minutes'
});
app.use('/api/', apiLimiter);

// MongoDB connection with retry logic
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URL, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('Connected to MongoDB');
  } catch (err) {
    console.error('MongoDB connection error:', err);
    console.log('Retrying connection in 5 seconds...');
    setTimeout(connectDB, 5000);
  }
};

connectDB();

// Handle MongoDB disconnection events
mongoose.connection.on('disconnected', () => {
  console.log('MongoDB disconnected. Attempting to reconnect...');
  connectDB();
});

mongoose.connection.on('error', (err) => {
  console.error('MongoDB connection error:', err);
  connectDB();
});

// Initialize Google Generative AI
const genAI = new GoogleGenerativeAI(process.env.API_KEY);

// Schema and model definitions
const ResponseSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
    index: true // Add index for faster lookups
  },
  question: {
    type: String,
    required: true
  },
  answer: {
    type: String,
    required: true
  },
  formattedAnswer: {
    type: String,
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

const Response = mongoose.model('Response', ResponseSchema);

// Utility functions
const generateAIResponse = async (question) => {
  const model = genAI.getGenerativeModel({ 
    model: process.env.AI_MODEL || 'gemini-1.5-flash',
    generationConfig: {
      maxOutputTokens: parseInt(process.env.MAX_TOKENS || '1024'), // Increased token limit
      temperature: parseFloat(process.env.TEMPERATURE || '0.7'),
    }
  });
  
  const chat = model.startChat({
    history: [
      {
        role: 'user',
        parts: [{ text: 'Hello, I would like to chat with you.' }],
      },
      {
        role: 'model',
        parts: [{ text: 'Hi there! I\'m ChatMosaic, powered by Google\'s Gemini AI. How can I help you today?' }],
      },
      {
        role: 'user',
        parts: [{ text: 'Please format your responses using markdown when appropriate. Use **bold** for emphasis, *italics* for subtle emphasis, and code blocks with language specification for any code snippets. For example, use ```javascript for JavaScript code.' }],
      },
      {
        role: 'model',
        parts: [{ text: 'I understand! I\'ll format my responses using markdown with **bold** text, *italics*, and ```language code blocks when sharing code snippets. This will make my responses more readable and well-structured.' }],
      },
    ]
  });
  
  const result = await chat.sendMessage(question);
  const response = await result.response;
  return response.text();
};

// Format response text using markdown
const formatResponse = (text) => {
  // Process the raw text through marked to convert markdown to HTML
  return marked.parse(text);
};

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok',
    message: 'ChatMosaic API is running',
    dbStatus: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  const { question } = req.body;
  
  // Input validation
  if (!question || question.trim().length === 0) {
    return res.status(400).json({ error: 'Question is required and cannot be empty' });
  }
  
  try {
    // Generate response from AI
    const text = await generateAIResponse(question);
    
    // Format the response with markdown processing
    const formattedText = formatResponse(text);
    
    // Save to database
    const newResponse = new Response({
      id: Date.now().toString(),
      question: question,
      answer: text,
      formattedAnswer: formattedText
    });
    
    await newResponse.save();
    
    // Return response
    res.status(200).json({ 
      id: newResponse.id, 
      answer: text,
      formattedAnswer: formattedText,
      timestamp: newResponse.timestamp
    });
    
  } catch (error) { 
    console.error('Error processing request:', error);
    
    // Determine appropriate error status and message
    const statusCode = error.code === 'RESOURCE_EXHAUSTED' ? 429 : 500;
    const errorMessage = error.code === 'RESOURCE_EXHAUSTED' 
      ? 'AI service quota exceeded. Please try again later.'
      : 'Failed to process your request';
    
    res.status(statusCode).json({
      error: errorMessage,
      details: process.env.NODE_ENV === 'production' ? undefined : error.message
    });
  }
});

// Delete response endpoint
app.delete('/api/chat/:id', async (req, res) => {
  try {
    const result = await Response.findOneAndDelete({ id: req.params.id });
    
    if (result) {
      res.status(200).json({ 
        message: 'Response deleted successfully',
        id: req.params.id
      });
    } else {
      res.status(404).json({ error: 'Response not found' });
    }
  } catch (error) {
    console.error('Error deleting response:', error);
    res.status(500).json({
      error: 'Failed to delete response',
      details: process.env.NODE_ENV === 'production' ? undefined : error.message
    });
  }
});

// Get all responses (with pagination)
app.get('/api/chat', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    
    const responses = await Response.find()
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit);
      
    const total = await Response.countDocuments();
    
    res.status(200).json({ 
      responses,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching responses:', error);
    res.status(500).json({
      error: 'Failed to fetch responses',
      details: process.env.NODE_ENV === 'production' ? undefined : error.message
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    details: process.env.NODE_ENV === 'production' ? undefined : err.message
  });
});

// Handle 404 errors
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`ChatMosaic server is running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received. Shutting down gracefully...');
  mongoose.connection.close(() => {
    console.log('MongoDB connection closed');
    process.exit(0);
  });
});

module.exports = app;