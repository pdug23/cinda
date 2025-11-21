// components/ChatMessage.jsx
export default function ChatMessage({ role, content, children }) {
  const isUser = role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      <div
        className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm leading-relaxed shadow-sm ${
          isUser
            ? 'bg-blue-600 text-white rounded-br-sm'
            : 'bg-slate-100 text-slate-900 rounded-bl-sm'
        }`}
      >
        <p className="whitespace-pre-wrap">{content}</p>
        {children}
      </div>
    </div>
  );
}
