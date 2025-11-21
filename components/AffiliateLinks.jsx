// components/AffiliateLinks.jsx
import { getAffiliateLinksForShoe } from '../config/affiliate';

function resolveShoeName(entry) {
  if (!entry) return '';
  if (typeof entry === 'string') return entry;
  if (entry.name) return entry.name;
  if (entry.brand || entry.model) {
    return `${entry.brand || ''} ${entry.model || ''}`.trim();
  }
  return '';
}

export default function AffiliateLinks({ shoes }) {
  if (!shoes || shoes.length === 0) return null;

  return (
    <div className="mt-2 space-y-2">
      {shoes.map((shoeEntry, idx) => {
        const shoeName = resolveShoeName(shoeEntry);
        if (!shoeName) return null;

        const links = getAffiliateLinksForShoe(shoeName);
        if (!links.length) return null;

        return (
          <div
            key={`${shoeName}-${idx}`}
            className="mt-2 rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-xs text-slate-700"
          >
            <div className="mb-1 font-medium">{shoeName}</div>
            <div className="flex flex-wrap gap-2">
              {links.map((link) => (
                <a
                  key={link.key}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center rounded-full border border-slate-300 px-2 py-1 text-[11px] hover:bg-slate-100"
                >
                  {link.label}
                </a>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
