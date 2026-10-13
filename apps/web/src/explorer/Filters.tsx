interface Props {
  level: string;
  service: string;
  onLevelChange: (value: string) => void;
  onServiceChange: (value: string) => void;
}

export function Filters({ level, service, onLevelChange, onServiceChange }: Props) {
  return (
    <>
      <label>
        Level
        <select value={level} onChange={(e) => onLevelChange(e.target.value)}>
          <option value="">All levels</option>
          <option value="debug">debug</option>
          <option value="info">info</option>
          <option value="warn">warn</option>
          <option value="error">error</option>
        </select>
      </label>
      <label>
        Service
        <input
          value={service}
          maxLength={100}
          placeholder="any"
          onChange={(e) => onServiceChange(e.target.value)}
        />
      </label>
    </>
  );
}
