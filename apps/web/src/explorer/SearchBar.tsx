interface Props {
  value: string;
  onChange: (value: string) => void;
}

export function SearchBar({ value, onChange }: Props) {
  return (
    <label className="grow">
      Search
      <input
        type="search"
        value={value}
        maxLength={500}
        placeholder='timeout -retry "disk full" level:error service:api'
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
