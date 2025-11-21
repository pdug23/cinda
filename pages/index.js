// pages/index.js
import { useState } from 'react';
import ChatMessage from '../components/ChatMessage';
import AffiliateLinks from '../components/AffiliateLinks';

export default function Home() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = { role: 'user', content: input };
    const chatHistory = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage.content,
          chatHistory,
        }),
      });

      const data = await res.json();

      const assistantMessage = {
        role: 'assistant',
        content: data.reply,
        shoes: data.shoes || [],
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err) {
      console.error(err);
      const errorMessage = {
        role: 'assistant',
        content: 'Something went wrong talking to Cinda 😢',
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Header */}
      <header className="border-b bg-white">
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-semibold tracking-tight">Cinda</span>
            <span className="text-xs text-slate-500">Your running shoe nerd</span>
          </div>
          <span className="text-xs text-slate-400">Powered by OpenAI</span>
        </div>
      </header>

      {/* Main layout */}
      <main className="mx-auto max-w-5xl px-4 py-6">
        <section className="flex flex-col rounded-2xl border bg-white shadow-sm max-h-[80vh]">
          {/* Chat area */}
          <div className="flex-1 overflow-y-auto px-3 py-3">
            {messages.map((m, i) => (
              <ChatMessage key={i} role={m.role} content={m.content}>
                {m.role === 'assistant' && m.shoes && m.shoes.length > 0 && (
                  <AffiliateLinks shoes={m.shoes} />
                )}
              </ChatMessage>
            ))}
            {isLoading && (
              <div className="text-xs text-slate-400 px-2 py-1">Cinda is thinking…</div>
            )}
          </div>

          {/* Input */}
          <form onSubmit={handleSubmit} className="border-t px-3 py-2 flex gap-2">
            <input
              type="text"
              className="flex-1 rounded-full border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Tell Cinda what you’re training for…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <button
              type="submit"
              disabled={isLoading}
              className="rounded-full bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Send
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
