const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const cors = require('cors');

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors({
  origin: 'http://localhost:5173'
}));

mongoose.connect(process.env.MONGO_URL, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => {
  console.log('Connected to MongoDB');
}).catch((err) => {
  console.error('MongoDB connection error:', err);
});


mongoose.connection.on('disconnected', () => {
  console.log('MongoDB disconnected. Attempting to reconnect...');
  mongoose.connect(process.env.MONGO_URL);
});

const genAI = new GoogleGenerativeAI(process.env.API_KEY);

const ResponseSchema = new mongoose.Schema({
  id: String,
  question: String,
  answer: String
});

const Response = mongoose.model('Response', ResponseSchema);

app.post('/api/chat', async (req, res) => {
  const { question } = req.body;

  if (!question || question.trim().length === 0) {
    return res.status(400).json({ error: 'Question is required and cannot be empty' });
  }

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const chat = model.startChat({
      history: [
        {
          role: 'user',
          parts: [{ text: 'Hello, I have 2 dogs in my house.' }],
        },
        {
          role: 'model',
          parts: [{ text: 'Great to meet you. What would you like to know?' }],
        },
      ],
      generationConfig: {
        maxOutputTokens: 200,
      },
    });

    const result = await chat.sendMessage(question);
    const response = await result.response;
    const text = response.text();
    
   
    const newResponse = new Response({
      id: Date.now().toString(),
      question: question,
      answer: text
    });
    await newResponse.save();

    res.status(200).json({ id: newResponse.id, answer: text });
  } catch (error) {
    console.error('Error fetching from Google Generative AI:', error);
    res.status(500).json({ 
      error: 'Failed to fetch response from Google Generative AI', 
      details: error.message 
    });
  }
});

app.delete('/api/chat/:id', async (req, res) => {
  try {
    await Response.findOneAndDelete({ id: req.params.id });
    res.status(200).json({ message: 'Response deleted successfully' });
  } catch (error) {
    console.error('Error deleting response:', error);
    res.status(500).json({ 
      error: 'Failed to delete response', 
      details: error.message 
    });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});