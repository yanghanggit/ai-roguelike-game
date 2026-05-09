import { useState, useEffect, useCallback } from "react";
import type { GameState, StartGameResponse, ActionResponse, Direction } from "@roguelike/shared";

const GLYPH_CLASS: Record<string, string> = {
  "@": "tile-player",
  "#": "tile-wall",
  ".": "tile-floor",
  E: "tile-monster",
};

function GameMap({ state }: { state: GameState }) {
  const cols = state.map[0]?.length ?? 0;

  const cells = state.map.flatMap((row, y) =>
    row.map((tile, x) => {
      const isPlayer = state.player.position.x === x && state.player.position.y === y;
      const monster = state.monsters.find((m) => m.position.x === x && m.position.y === y);
      const glyph = isPlayer ? "@" : monster ? monster.glyph : tile.glyph;
      const cls = GLYPH_CLASS[glyph] ?? "tile-floor";
      return (
        <div key={`${x}-${y}`} className={`tile ${cls}`}>
          {glyph}
        </div>
      );
    }),
  );

  return (
    <div className="game-map" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {cells}
    </div>
  );
}

function StatusBar({ state }: { state: GameState }) {
  return (
    <div className="status-bar">
      <span>
        HP: {state.player.hp}/{state.player.maxHp}
      </span>
      <span>Level: {state.player.level}</span>
      <span>Turn: {state.turn}</span>
    </div>
  );
}

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

export default function App() {
  const [state, setState] = useState<GameState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const sendAction = useCallback(
    async (direction: Direction) => {
      if (!state) return;
      try {
        const res = await fetch("/game/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: state.sessionId,
            action: { type: "move", direction },
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

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (!state) return;
      const map: Record<string, Direction> = {
        ArrowUp: "north",
        ArrowDown: "south",
        ArrowLeft: "west",
        ArrowRight: "east",
        w: "north",
        s: "south",
        a: "west",
        d: "east",
      };
      const dir = map[e.key];
      if (dir) {
        e.preventDefault();
        sendAction(dir);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [state, sendAction]);

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
      <StatusBar state={state} />
      <GameMap state={state} />
      <MessageLog log={state.log} />
      <div className="controls-hint">Move: Arrow keys or WASD</div>
    </div>
  );
}
