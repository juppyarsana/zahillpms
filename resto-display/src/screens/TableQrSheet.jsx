import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';
import api from '../api';

// Renders every table's QR into a print-friendly grid so the property prints
// one sheet and cuts it up. @media print (index.css) hides the .no-print
// chrome below.
export default function TableQrSheet() {
  const navigate = useNavigate();
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: tables } = await api.get('/resto/tables');
      const withQr = await Promise.all(tables.map(async t => {
        const { data } = await api.get(`/resto/tables/${t.id}/qr`);
        const dataUrl = await QRCode.toDataURL(data.url, { width: 260, margin: 1 });
        return { name: t.name, dataUrl };
      }));
      setCards(withQr);
      setLoading(false);
    })();
  }, []);

  return (
    <div style={{ background: '#fff', color: '#000', minHeight: '100dvh', padding: 24 }}>
      <div className="no-print" style={{ marginBottom: 20, display: 'flex', gap: 12 }}>
        <button onClick={() => navigate(-1)} style={{
          background: 'none', border: '1px solid #ccc', borderRadius: 8, padding: '8px 14px',
          fontSize: 13, cursor: 'pointer', color: '#000',
        }}>
          ← Back
        </button>
        <button onClick={() => window.print()} style={{
          background: '#c9a227', border: 'none', borderRadius: 8, padding: '8px 14px',
          fontSize: 13, fontWeight: 700, cursor: 'pointer', color: '#000',
        }}>
          Print
        </button>
      </div>

      {loading && <p>Generating QR codes…</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 24 }}>
        {cards.map(c => (
          <div key={c.name} style={{ textAlign: 'center', pageBreakInside: 'avoid' }}>
            <img src={c.dataUrl} alt={c.name} style={{ width: 220, height: 220 }} />
            <div style={{ fontSize: 16, fontWeight: 700, marginTop: 8 }}>{c.name}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
