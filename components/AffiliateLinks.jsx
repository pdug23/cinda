// components/AffiliateLinks.jsx
import { shoes as shoeData } from '../data/shoes';
import { getAffiliateLinksForShoe } from '../config/affiliate';

export default function AffiliateLinks({ shoes }) {
  if (!shoes || shoes.length === 0) return null;

  return (
    <div className="mt-2 space-y-2">
      {shoes.map((s) => {
        const shoe = shoeData.find(
          (item) => item.brand === s.brand && item.model === s.model
        );
        if (!shoe) return null;

        const links = getAffiliateLinksForShoe(shoe);
        if (!links.length) return null;

        return (
          <div
            key={`${shoe.brand}-${shoe.model}`}
            className="mt-2 rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-xs text-slate-700"
          >
            <div className="font-medium mb-1">
              {shoe.brand} {shoe.model}
            </div>
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
