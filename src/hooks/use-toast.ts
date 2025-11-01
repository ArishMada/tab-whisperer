import { useCallback, useState } from "react";

export function useToast() {
  const [messages, setMessages] = useState<
    { id: number; title?: string; description?: string }[]
  >([]);

  const toast = useCallback((msg: { title?: string; description?: string }) => {
    setMessages((prev) => [...prev, { id: Date.now(), ...msg }]);
  }, []);

  const dismiss = useCallback((id: number) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
  }, []);

  return { messages, toast, dismiss };
}
