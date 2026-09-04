import { PINNED_COUNTRIES, REST_COUNTRIES, ALL_COUNTRIES } from '../lib/countries';

// Dropdown for the guest "Nationality" field. Stores the country name string.
// If `value` holds a legacy free-text value not in the list, it's shown as an
// extra option at the top so nothing is silently lost or reset on save.
export default function CountrySelect({
  value = '',
  onChange,
  className = 'form-select',
  placeholder = 'Select country…',
  id,
  required = false,
}) {
  const legacy = value && !ALL_COUNTRIES.includes(value) ? value : null;

  return (
    <select
      id={id}
      className={className}
      value={value || ''}
      required={required}
      onChange={e => onChange(e.target.value)}
    >
      <option value="">{placeholder}</option>
      {legacy && <option value={legacy}>{legacy} (existing)</option>}
      <optgroup label="Common">
        {PINNED_COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
      </optgroup>
      <optgroup label="All countries">
        {REST_COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
      </optgroup>
    </select>
  );
}
