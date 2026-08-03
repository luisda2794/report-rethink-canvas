import { useEffect, useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { getAllHubs } from "@/lib/epodStore";

/**
 * Combobox editable de Hub: no es una lista fija — lee dinámicamente de
 * IndexedDB qué hubs ya tienen datos cargados y los ofrece como sugerencias,
 * pero el usuario puede escribir cualquier nombre (nuevo o existente).
 */
export function HubCombobox({
  value,
  onChange,
  placeholder = "Escribe o elige un hub…",
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [hubs, setHubs] = useState<string[]>([]);
  const listId = useId();

  useEffect(() => {
    let cancelled = false;
    getAllHubs()
      .then((list) => {
        if (!cancelled) setHubs(list.map((h) => h.hub));
      })
      .catch(() => { /* ignore */ });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <Input
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={className}
      />
      <datalist id={listId}>
        {hubs.map((h) => (
          <option key={h} value={h} />
        ))}
      </datalist>
    </>
  );
}
