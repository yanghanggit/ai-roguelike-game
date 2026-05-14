import { useState, useCallback, useEffect, useRef } from "react";
import type { GameState, LogEntry, StartGameResponse, ActionResponse } from "@roguelike/shared";

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

function MessageLog({
  log,
  currentTurn,
  phase,
}: {
  log: LogEntry[];
  currentTurn: number;
  phase: string;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const messages = log.filter((e) => e.turn === currentTurn).map((e) => e.message);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log, phase]);

  return (
    <div className="message-log">
      {messages.map((msg, i) => (
        <div key={i} className="log-entry">
          {msg}
        </div>
      ))}
      {phase === "dungeon" && <div className="log-entry phase-indicator">地下城行动中…</div>}
      <div ref={bottomRef} />
    </div>
  );
}

// ─── Game map ─────────────────────────────────────────────────────────────────

function GameStage({
  state,
  onReveal,
}: {
  state: GameState;
  onReveal: (x: number, y: number) => void;
}) {
  const locked = state.phase === "dungeon";
  return (
    <div
      className={`game-stage${locked ? " stage-locked" : ""}`}
      style={{ gridTemplateColumns: `repeat(${state.stageSize}, 1fr)` }}
    >
      {state.stage.tiles.flatMap((row, y) =>
        row.map((tile, x) => {
          if (!tile.revealed) {
            return (
              <div
                key={`${x}-${y}`}
                className="tile tile-hidden"
                onClick={locked ? undefined : () => onReveal(x, y)}
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
        <button className="modal-close" onClick={onClose}>
          ✕
        </button>
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
        const res = await fetch("/game/player-action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: state.sessionId,
            action: { type: "reveal", x, y },
          }),
        });
        if (!res.ok) throw new Error("Action failed");
        const data = (await res.json()) as ActionResponse;
        // 新格子が揭かれて dungeon phase になった場合、すぐに dungeon-advance を呼ぶ
        if (data.state.phase === "dungeon") {
          await fetch("/game/dungeon-advance", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId: state.sessionId }),
          });
        }
      } catch (e) {
        setError(String(e));
      }
    },
    [state],
  );

  // SSE：当 sessionId 变化时（新游戏）订阅服务端推送，实时接收 AI 推理后的状态更新
  useEffect(() => {
    if (!state?.sessionId) return;
    console.log(`[SSE client] connecting for session ${state.sessionId.slice(0, 8)}`);
    const es = new EventSource(`/game/events/${state.sessionId}`);
    es.onopen = () => {
      console.log(`[SSE client] connection opened`);
    };
    es.onmessage = (event) => {
      const newState = JSON.parse(event.data as string) as GameState;
      console.log(`[SSE client] received phase="${newState.phase}" turn=${newState.turn}`);
      setState(newState);
    };
    es.onerror = (e) => {
      console.error(`[SSE client] error`, e);
    };
    return () => {
      console.log(`[SSE client] closing`);
      es.close();
    };
  }, [state?.sessionId]);

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
      <MessageLog log={state.log} currentTurn={state.turn} phase={state.phase} />
      <GameStage state={state} onReveal={sendReveal} />
    </div>
  );
}
