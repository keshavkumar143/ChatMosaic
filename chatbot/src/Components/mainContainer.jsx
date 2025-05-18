import { useState, useRef, useEffect } from "react";
import axios from "axios";
import { Mic, MicOff, Send, Trash2, RotateCcw } from "lucide-react";

function MainContainer() {
  const [error, setError] = useState("");
  const [value, setValue] = useState("");
  const [responses, setResponses] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [isSpeechSupported, setIsSpeechSupported] = useState(false);
  const messagesEndRef = useRef(null);
  const recognition = useRef(null);
  
  // API base URL - pointing to localhost:3000
  const API_BASE_URL = "http://localhost:8000/api";

  useEffect(() => {
    // Check if speech recognition is supported
    const speechRecognitionAPI =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (speechRecognitionAPI) {
      try {
        // Initialize speech recognition
        recognition.current = new speechRecognitionAPI();
        recognition.current.continuous = true;
        recognition.current.interimResults = true;

        recognition.current.onresult = (event) => {
          const transcript = Array.from(event.results)
            .map((result) => result[0])
            .map((result) => result.transcript)
            .join("");

          setValue(transcript);
        };

        recognition.current.onerror = (event) => {
          console.error("Speech recognition error", event.error);
          setIsListening(false);
        };

        setIsSpeechSupported(true);
      } catch (err) {
        console.error("Failed to initialize speech recognition:", err);
        setIsSpeechSupported(false);
      }
    } else {
      console.log("Speech recognition not supported in this browser");
      setIsSpeechSupported(false);
    }
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(scrollToBottom, [responses]);

  const handleInputChange = (e) => {
    setValue(e.target.value);
    if (e.target.value.trim() !== "") {
      setError("");
    }
  };

  const toggleListening = () => {
    if (!isSpeechSupported) {
      setError("Speech recognition is not supported in your browser");
      return;
    }

    if (isListening) {
      try {
        recognition.current.stop();
      } catch (err) {
        console.error("Error stopping speech recognition:", err);
      }
      setIsListening(false);
    } else {
      try {
        recognition.current.start();
        setIsListening(true);
        setError("");
      } catch (err) {
        console.error("Speech recognition error:", err);
        setIsListening(false);
        setError("Failed to start speech recognition. Try again.");
      }
    }
  };

  const handleAsk = async () => {
    if (value.trim() === "") {
      setError("Please enter a question.");
      return;
    }

    if (isListening && recognition.current) {
      try {
        recognition.current.stop();
        setIsListening(false);
      } catch (err) {
        console.error("Error stopping speech recognition:", err);
      }
    }

    setIsLoading(true);
    try {
      // Send request to localhost backend
      const response = await axios.post(`${API_BASE_URL}/chat`, {
        question: value,
      });

      const newResponse = {
        id: response.data.id,
        question: value,
        answer: response.data.answer,
      };
      
      setResponses([...responses, newResponse]);
      setValue("");
      setIsLoading(false);
    } catch (error) {
      console.error("Error details:", error);
      setError(
        error.response?.data?.error || 
        "Failed to connect to localhost:8000. Make sure your backend is running."
      );
      setIsLoading(false);
    }
  };

  const handleClear = () => {
    setValue("");
    setError("");
  };

  const handleDelete = async (id) => {
    try {
      await axios.delete(`${API_BASE_URL}/chat/${id}`);
      setResponses(responses.filter((response) => response.id !== id));
    } catch (error) {
      setError("Failed to delete response. Please try again.");
      console.error(error);
    }
  };

  const toggleDarkMode = () => {
    setDarkMode(!darkMode);
  };

  const themeClass = darkMode
    ? "bg-gray-900 text-white"
    : "bg-gradient-to-br from-blue-50 to-indigo-50 text-gray-800";

  const headerClass = darkMode
    ? "bg-gray-800 border-b border-gray-700"
    : "bg-white bg-opacity-80 backdrop-blur-md border-b border-indigo-100 shadow-sm";

  const inputClass = darkMode
    ? "bg-gray-800 border border-gray-600 text-white"
    : "bg-white border border-indigo-100 text-gray-800";

  const buttonClass = darkMode
    ? "bg-indigo-600 hover:bg-indigo-700"
    : "bg-indigo-500 hover:bg-indigo-600";

  const messageBubbleUser = darkMode
    ? "bg-indigo-600 text-white"
    : "bg-indigo-100 text-indigo-900";

  const messageBubbleBot = darkMode
    ? "bg-gray-800 border border-gray-700 text-white"
    : "bg-white border border-indigo-50 text-gray-800";

  return (
    <div className={`flex flex-col h-screen ${themeClass}`}>
      <header
        className={`p-4 flex items-center justify-between ${headerClass}`}
      >
        <div className="flex items-center space-x-3">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight leading-tight">ChatMosaic</h1>
            <span className="text-xs text-indigo-400 font-medium">
              AI-powered Conversations (localhost:8000)
            </span>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={toggleDarkMode}
            className="p-2 rounded-full hover:bg-opacity-10 hover:bg-gray-500"
            title="Toggle dark mode"
          >
            {darkMode ? "☀️" : "🌙"}
          </button>
          {!isSpeechSupported && (
            <span
              className="text-xs bg-yellow-500 text-white py-1 px-2 rounded-full"
              title="Speech recognition not available"
            >
              🎤 Not Supported
            </span>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {responses.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center p-8 rounded-lg max-w-md">
              <h2 className="text-2xl font-semibold mb-3">
                Welcome to ChatMosaic (Local Development)
              </h2>
              <p className="opacity-70">
                Ask a question{" "}
                {isSpeechSupported ? "or use the microphone to speak" : ""}.
                Your conversations will appear here.
              </p>
              <p className="mt-2 text-sm p-2 bg-green-100 text-green-800 rounded-md">
                Connected to localhost:8000
              </p>
              {!isSpeechSupported && (
                <p className="mt-2 text-sm p-2 bg-yellow-100 text-yellow-800 rounded-md">
                  Note: Voice input is not supported in your browser.
                </p>
              )}
            </div>
          </div>
        ) : (
          responses.map((response) => (
            <div
              key={response.id}
              className="flex flex-col space-y-2 animate-fadeIn"
            >
              <div
                className={`rounded-lg p-3 px-4 self-end max-w-md ${messageBubbleUser}`}
              >
                <p>{response.question}</p>
              </div>
              <div
                className={`rounded-lg p-3 px-4 self-start max-w-md relative group shadow-sm ${messageBubbleBot}`}
              >
                <p>{response.answer}</p>
                <button
                  className="absolute -top-2 -right-2 bg-red-500 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => handleDelete(response.id)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <div
        className={`p-4 ${
          darkMode ? "bg-gray-800" : "bg-white bg-opacity-80 backdrop-blur-md"
        }`}
      >
        {error && (
          <p className="text-red-500 text-center mb-2 p-2 bg-red-50 rounded-md">{error}</p>
        )}
        <div className="flex space-x-2 items-center">
          <button
            className={`p-2 rounded-full ${
              isListening
                ? "bg-red-500 text-white"
                : `${buttonClass} text-white`
            } ${!isSpeechSupported ? "opacity-50 cursor-not-allowed" : ""}`}
            onClick={toggleListening}
            disabled={!isSpeechSupported}
            title={
              !isSpeechSupported
                ? "Speech recognition not supported"
                : isListening
                ? "Stop listening"
                : "Start voice input"
            }
          >
            {isListening ? <MicOff size={20} /> : <Mic size={20} />}
          </button>

          <div className="relative flex-1">
            <input
              className={`w-full p-3 pl-4 pr-10 rounded-full focus:outline-none focus:ring-2 focus:ring-indigo-400 ${inputClass}`}
              type="text"
              placeholder={
                isListening ? "Listening..." : "Type your message..."
              }
              value={value}
              onChange={handleInputChange}
              onKeyPress={(e) => e.key === "Enter" && handleAsk()}
            />
            {value && (
              <button
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                onClick={handleClear}
              >
                <RotateCcw size={16} />
              </button>
            )}
          </div>

          <button
            className={`p-3 rounded-full ${buttonClass} text-white disabled:opacity-50 disabled:cursor-not-allowed`}
            onClick={handleAsk}
            disabled={isLoading || value.trim() === ""}
          >
            {isLoading ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
            ) : (
              <Send size={20} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default MainContainer;