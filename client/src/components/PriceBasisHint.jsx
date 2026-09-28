import { useSettings } from '../context/SettingsContext';

// Under a price field: how the price is read (migration 079 — Property
// Details → Service charge & tax). Nothing when the rates are 0%.
export default function PriceBasisHint({ style }) {
  const { branding } = useSettings();
  const sc = parseFloat(branding?.service_charge_rate) || 0, tax = parseFloat(branding?.tax_rate) || 0;
  if (!branding || (sc === 0 && tax === 0)) return null;
  return (
    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, ...style }}>
      {branding.prices_include_tax
        ? `Including service ${sc}% & tax ${tax}% — what the guest pays`
        : `Before service ${sc}% & tax ${tax}% — they are added on top`}
    </div>
  );
}
