import { useState } from 'react';
import styles from '../styles/Home.module.css';

export default function Home() {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([]);
  const [matchedShoes, setMatchedShoes] = useState([]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Add the user message to the local chat history
    const newMessages = [...messages, { role: 'user', content: input }];
    setMessages(newMessages);
    setInput('');

    // Send the message and full history to the backend
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        message: input,
        chatHistory: newMessages
      }),
    });

    const data = await res.json();

    // Add Cinda's reply to the local chat history
    setMessages([
      ...newMessages,
      { role: 'assistant', content: data.reply }
    ]);

    // Update matched shoes if present
    setMatchedShoes(data.matchedShoes || []);
  };

  return (
    <main className={styles.container}>
      <img
        src="/cinda-logo.png"
        alt="Cinda logo"
        className={styles.logo}
      />

      <div className={styles.chatWindow}>
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`${styles.bubble} ${
              msg.role === 'user' ? styles.userBubble : styles.cindaBubble
            }`}
          >
            {msg.content}
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit} className={styles.form}>
        <input
          className={styles.input}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask me about running shoes..."
        />
        <button className={styles.button} type="submit">
          Ask
        </button>
      </form>

      {matchedShoes.length > 0 && (
        <div style={{ marginTop: '2rem' }}>
          <h2 style={{ fontSize: '1.2rem', marginBottom: '1rem' }}>Recommended Shoes</h2>
          {matchedShoes.map((shoe, idx) => (
            <div key={idx} style={{
              background: '#fff',
              color: '#000',
              borderRadius: '12px',
              padding: '1rem',
              marginBottom: '1rem',
              boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            }}>
              <strong>{shoe.brand} {shoe.name}</strong>
              <p><strong>Type:</strong> {shoe.types.join(', ')}</p>
              <p><strong>Support:</strong> {shoe.support}</p>
              <p><strong>Drop:</strong> {shoe.drop}mm | <strong>Weight:</strong> {shoe.weight}g</p>
              <p><strong>Stack:</strong> Heel {shoe.heelHeight}mm / Forefoot {shoe.forefootHeight}mm</p>
              <p style={{ fontStyle: 'italic' }}>{shoe.notes}</p>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
