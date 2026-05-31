import { useEffect, useMemo, useRef, useState } from "react";
import {
  MeshNameInput,
  createClockSync,
  type MeshConfig,
  type YRoom,
} from "@baditaflorin/mesh-common";

type Props = { room: YRoom | null; config: MeshConfig };

type Round = {
  /** Mesh-time ms the host opened the buzzer. 0 = not open. */
  armedAt: number;
  id: string;
};

type Buzz = {
  peerId: string;
  name: string;
  msSinceArmed: number;
};

const NAME_KEY = (prefix: string) => `${prefix}:displayName`;

export function Feature({ room, config }: Props) {
  const [name, setName] = useState(
    () => localStorage.getItem(NAME_KEY(config.storagePrefix)) ?? "",
  );
  const [, rerender] = useState(0);

  useEffect(() => {
    if (name) localStorage.setItem(NAME_KEY(config.storagePrefix), name);
  }, [name, config.storagePrefix]);

  const clock = useMemo(() => (room ? createClockSync(room.provider) : null), [room]);
  useEffect(() => () => clock?.destroy(), [clock]);

  // The mesh-time (this peer's frame) at which THIS peer first observed the
  // current round become armed. We measure reaction time as
  // `meshNow() - localArmObservedAt`, reading both samples from the SAME peer's
  // mesh clock so any absolute clock skew cancels out. Storing the raw
  // armer-frame `armedAt` and subtracting it from a *different* peer's mesh
  // clock (the old code) is wrong: with a skewed peer the two mesh-clock frames
  // disagree and the elapsed delta is garbage (it floored to 0 → wrong winner).
  const armObservedRef = useRef<{ id: string; at: number }>({ id: "", at: 0 });

  useEffect(() => {
    if (!room || !clock) return;
    const round = room.doc.getMap<Round>("round");
    const buzzes = room.doc.getArray<Buzz>("buzzes");
    const noteArm = () => {
      const cur = round.get("current");
      if (cur && cur.armedAt > 0 && cur.id && armObservedRef.current.id !== cur.id) {
        // First time this peer sees this round open — stamp its own mesh clock.
        armObservedRef.current = { id: cur.id, at: clock.meshNow() };
      }
    };
    const onChange = () => {
      noteArm();
      rerender((n) => n + 1);
    };
    noteArm();
    round.observe(onChange);
    buzzes.observe(onChange);
    return () => {
      round.unobserve(onChange);
      buzzes.unobserve(onChange);
    };
  }, [room, clock]);

  if (!room || !clock) {
    return (
      <div className="buzz-screen">
        <h1>buzzer</h1>
        <p className="buzz-status">Connecting…</p>
      </div>
    );
  }

  const round = room.doc.getMap<Round>("round").get("current") ?? { armedAt: 0, id: "" };
  const buzzes = room.doc.getArray<Buzz>("buzzes").toArray();
  const myKey = name.trim() || `peer-${room.peerId.slice(0, 4)}`;
  const myBuzz = buzzes.find((b) => b.peerId === room.peerId);
  const armed = round.armedAt > 0;

  const arm = () => {
    const id = crypto.randomUUID();
    const armedAt = clock.meshNow();
    // Stamp our own arm-observation immediately so the armer measures its own
    // reaction from the same instant every other peer does.
    armObservedRef.current = { id, at: armedAt };
    room.doc.transact(() => {
      room.doc.getArray<Buzz>("buzzes").delete(0, room.doc.getArray<Buzz>("buzzes").length);
      room.doc.getMap<Round>("round").set("current", { armedAt, id });
    });
  };

  const buzz = () => {
    if (!armed || myBuzz) return;
    // Reaction time is measured ENTIRELY in this peer's own mesh-clock frame:
    // (now) − (when this peer observed the round arm). Both reads come from the
    // same `clock.meshNow()`, so the peer's absolute offset to mesh-median
    // cancels and a skewed local clock cannot corrupt the ordering. Falls back
    // to the shared armer-frame `armedAt` only if we somehow never recorded the
    // local observation (e.g. buzzed in the same tick the round arrived).
    const observed = armObservedRef.current.id === round.id ? armObservedRef.current.at : null;
    const base = observed ?? round.armedAt;
    const t = clock.meshNow() - base;
    room.doc
      .getArray<Buzz>("buzzes")
      .push([{ peerId: room.peerId, name: myKey, msSinceArmed: Math.max(0, Math.round(t)) }]);
  };

  const reset = () => {
    room.doc.transact(() => {
      room.doc.getArray<Buzz>("buzzes").delete(0, room.doc.getArray<Buzz>("buzzes").length);
      room.doc.getMap<Round>("round").set("current", { armedAt: 0, id: "" });
    });
  };

  const sorted = [...buzzes].sort((a, b) => a.msSinceArmed - b.msSinceArmed);
  const winner = sorted[0];

  return (
    <div className="buzz-screen" data-armed={armed ? "1" : "0"}>
      <header className="buzz-header">
        <h1>buzzer</h1>
        <MeshNameInput
          className="buzz-name"
          placeholder="your name"
          value={name}
          onChange={setName}
          maxLength={24}
        />
        <p className="buzz-status">
          {room.peerCount + 1} player{room.peerCount === 0 ? "" : "s"} · ms-precision
        </p>
      </header>

      {!armed && (
        <button type="button" className="buzz-arm" onClick={arm}>
          ARM (open round)
        </button>
      )}

      {armed && !myBuzz && (
        <button type="button" className="buzz-buzz" onClick={buzz}>
          BUZZ!
        </button>
      )}

      {armed && myBuzz && (
        <div className="buzz-mine">
          <p>you buzzed at</p>
          <p className="buzz-mine-ms">{myBuzz.msSinceArmed} ms</p>
        </div>
      )}

      {sorted.length > 0 && (
        <>
          <ol className="buzz-list">
            {sorted.map((b, i) => (
              <li key={b.peerId} className={i === 0 ? "is-winner" : ""}>
                <span>
                  {i + 1}. {b.name}
                </span>
                <span className="buzz-ms">+{b.msSinceArmed} ms</span>
              </li>
            ))}
          </ol>
          {winner && (
            <p className="buzz-winner">
              winner: <strong>{winner.name}</strong>
            </p>
          )}
        </>
      )}

      {(armed || sorted.length > 0) && (
        <button type="button" className="buzz-reset" onClick={reset}>
          next round
        </button>
      )}
    </div>
  );
}
