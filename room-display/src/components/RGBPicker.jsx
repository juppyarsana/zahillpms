import { useState } from 'react';

const PRESETS = [
  { name: 'Warm White',  r: 255, g: 200, b: 120, hex: '#FFC878' },
  { name: 'Cool White',  r: 230, g: 240, b: 255, hex: '#E6F0FF' },
  { name: 'Romantic',    r: 255, g: 30,  b: 60,  hex: '#FF1E3C' },
  { name: 'Ocean',       r: 0,   g: 150, b: 255, hex: '#0096FF' },
  { name: 'Nature',      r: 30,  g: 200, b: 80,  hex: '#1EC850' },
  { name: 'Lavender',    r: 180, g: 80,  b: 255, hex: '#B450FF' },
  { name: 'Candlelight', r: 255, g: 110, b: 20,  hex: '#FF6E14' },
  { name: 'Off',         r: 0,   g: 0,   b: 0,   hex: null      },
];

export default function RGBPicker({ onSet, currentRgb }) {
  const [active, setActive] = useState(null);

  const handlePreset = (preset) => {
    setActive(preset.name);
    onSet(preset.r, preset.g, preset.b);
  };

  return (
    <div className="glass-card rounded-3xl p-6 flex flex-col gap-4">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(201,162,39,0.1)' }}>
          <span className="material-symbols-outlined text-xl" style={{ color: '#c9a227' }}>palette</span>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-white">Ambient Light</h3>
          <p className="text-[10px] text-slate-500">RGB LED strip color</p>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {PRESETS.map(preset => (
          <button
            key={preset.name}
            onClick={() => handlePreset(preset)}
            className="flex flex-col items-center gap-2 py-3 rounded-2xl transition-all active:scale-95"
            style={active === preset.name
              ? { background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)' }
              : { background: 'transparent' }
            }
          >
            <div
              className="w-8 h-8 rounded-full border"
              style={{
                background: preset.hex ?? '#111',
                borderColor: preset.hex ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.15)',
              }}
            />
            <span className="text-[9px] text-slate-400 font-medium leading-tight text-center">{preset.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
