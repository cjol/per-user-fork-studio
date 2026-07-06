import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

type Note = { id: number; text: string; done: boolean };

function App() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    fetch("/api/notes").then((r) => r.json()).then(setNotes);
  }, []);

  const add = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    const res = await fetch("/api/notes", {
      method: "POST",
      body: JSON.stringify({ text })
    });
    setNotes(await res.json());
  };

  const toggle = async (id: number) => {
    const res = await fetch(`/api/notes?id=${id}`, { method: "PATCH" });
    setNotes(await res.json());
  };

  const remove = async (id: number) => {
    const res = await fetch(`/api/notes?id=${id}`, { method: "DELETE" });
    setNotes(await res.json());
  };

  const remaining = notes.filter((n) => !n.done).length;

  return (
    <main className="wrap">
      <header className="hdr">
        <h1>Notes</h1>
        <p>
          {notes.length === 0
            ? "Nothing yet — add your first note."
            : `${remaining} of ${notes.length} still open.`}
        </p>
      </header>
      <div className="row">
        <input
          value={draft}
          placeholder="Add a note"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button onClick={add}>Add</button>
      </div>
      <ul>
        {notes.map((n) => (
          <li key={n.id} className={n.done ? "done" : ""}>
            <input type="checkbox" checked={n.done} onChange={() => toggle(n.id)} />
            <span>{n.text}</span>
            <button className="del" onClick={() => remove(n.id)}>
              ×
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
