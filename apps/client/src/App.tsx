import { useState, useCallback } from "react";
import type { GameState, StartGameResponse, ActionResponse } from "@roguelike/shared";

// ─── Top bar ─────────────────────────────────────────────────────────────────

function TopBar({ state, onSettings }: { state: GameState; onSettings: () => void }) {
  const { hp, maxHp, attack, defense } = state.player;
  return (
    <div className="top-bar">
      <span>
        HP: {hp}/{maxHp} · ATK: {attack} · DEF: {defense}
      </span>
      <button className="settings-btn" onClick={onSettings}>
        设置
      </button>
    </div>
  );
}

// ─── Message log ─────────────────────────────────────────────────────────────

function MessageLog({ log }: { log: string[] }) {
  return (
    <div className="message-log">
      {log.map((msg, i) => (
        <div key={i} className="log-entry">
          {msg}
        </div>
      ))}
    </div>
  );
}

// ─── Game map ─────────────────────────────────────────────────────────────────

function GameMap({
  state,
  onReveal,
}: {
  state: GameState;
  onReveal: (x: number, y: number) => void;
}) {
  return (
    <div
      className="game-map"
      style={{ gridTemplateColumns: `repeat(${state.mapSize}, 1fr)` }}
    >
      {state.map.flatMap((row, y) =>
        row.map((tile, x) => {
          if (!tile.revealed) {
            return (
              <div
                key={`${x}-${y}`}
                className="tile tile-hidden"
                onClick={() => onReveal(x, y)}
              />
            );
          }
          return (
            <div key={`${x}-${y}`} className={`tile tile-revealed tile-${tile.type}`}>
              {tile.glyph}
            </div>
          );
        }),
      )}
    </div>
  );
}

// ─── Settings modal ──────────────────────────────────────────────────────────

function SettingsModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>
      </div>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [state, setState] = useState<GameState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const startGame = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/game/start", { method: "POST" });
      if (!res.ok) throw new Error("Failed to start game");
      const data: StartGameResponse = await res.json();
      setState(data.state);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const sendReveal = useCallback(
    async (x: number, y: number) => {
      if (!state) return;
      try {
        const res = await fetch("/game/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: state.sessionId,
            action: { type: "reveal", x, y },
          }),
        });
        if (!res.ok) throw new Error("Action failed");
        const data: ActionResponse = await res.json();
        setState(data.state);
      } catch (e) {
        setError(String(e));
      }
    },
    [state],
  );

  if (!state) {
    return (
      <div className="start-screen">
        <h1>AI Roguelike</h1>
        {error && <p className="error">{error}</p>}
        <button onClick={startGame} disabled={loading}>
          {loading ? "Loading..." : "Start Game"}
        </button>
      </div>
    );
  }

  return (
    <div className="game-container">
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      <TopBar state={state} onSettings={() => setShowSettings(true)} />
      <MessageLog log={state.log} />
      <GameMap state={state} onReveal={sendReveal} />
    </div>
  );
}
