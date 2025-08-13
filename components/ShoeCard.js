// components/ShoeCard.js
export default function ShoeCard({ shoe }) {
  return (
    <div style={{
      border: '1px solid #ccc',
      borderRadius: '12px',
      padding: '1rem',
      margin: '0.5rem',
      backgroundColor: '#fff',
      color: '#000',
      maxWidth: '280px',
      boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
    }}>
      <h3 style={{ marginBottom: '0.5rem' }}>{shoe.name}</h3>
      <p><strong>Brand:</strong> {shoe.brand}</p>
      <p><strong>Type:</strong> {shoe.type.join(', ')}</p>
      <p><strong>Weight:</strong> {shoe.weight}g</p>
      <p><strong>Stack:</strong> {shoe.heelHeight}mm / {shoe.forefootHeight}mm</p>
      <p><strong>Drop:</strong> {shoe.drop}mm</p>
    </div>
  );
}
