import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import logo from '../Images/logo.png';

function MainContainer() {
  const [error, setError] = useState("");
  const [value, setValue] = useState("");
  const [responses, setResponses] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);

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

  const handleAsk = async () => {
    if (value.trim() === "") {
      setError("Please enter a question.");
      return;
    }

    setIsLoading(true);
    try {
      const response = await axios.post('https://chatmosaic.onrender.com/api/chat', { question: value });
     
      const newResponse = {
        id: Date.now(),
        question: value,
        answer: response.data.answer,
      };
      setResponses([...responses, newResponse]);
      setValue("");
    } catch (error) {
      setError("Failed to get response. Please try again.");
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClear = () => {
    setValue("");
    setError("");
  };

  const handleDelete = async (id) => {
    try {
      await axios.delete(`https://chatmosaic.onrender.com/api/chat/${id}`);
      setResponses(responses.filter(response => response.id !== id));
    } catch (error) {
      setError("Failed to delete response. Please try again.");
      console.error(error);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-blue-50">
      <header className="bg-blue-100 p-4 flex items-center">
        <div className="flex items-center space-x-2">
          <div className="w-10 h-8 flex items-center justify-center">
            <span>
              <img src={logo} alt="Logo" />
            </span>
          </div>
          <h1 className="text-blue-800 text-xl font-bold">ChatMosaic</h1>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {responses.map((response) => (
          <div key={response.id} className="flex flex-col space-y-2">
            <div className="bg-blue-200 rounded-lg p-3 self-end max-w-md">
              <p className="text-blue-800">{response.question}</p>
            </div>
            <div className="bg-white rounded-lg p-3 self-start max-w-md relative group shadow">
              <p className="text-blue-900">{response.answer}</p>
              <button
                className="absolute top-2 right-2 bg-red-400 text-white px-2 py-1 rounded-md text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => handleDelete(response.id)}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="bg-blue-100 p-4">
        {error && (
          <p className="text-red-500 text-center mb-2">{error}</p>
        )}
        <div className="flex space-x-2">
          <input
            className="flex-1 bg-white text-blue-900 p-2 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-400"
            type="text"
            placeholder="Type your message..."
            value={value}
            onChange={handleInputChange}
            onKeyPress={(e) => e.key === 'Enter' && handleAsk()}
          />
          <button
            className="bg-blue-500 text-white px-4 py-2 rounded-md hover:bg-blue-600 transition-colors"
            onClick={handleAsk}
            disabled={isLoading}
          >
            {isLoading ? 'Sending...' : 'Send'}
          </button>
          <button
            className="bg-red-400 text-white px-4 py-2 rounded-md hover:bg-red-500 transition-colors"
            onClick={handleClear}
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}

export default MainContainer;



