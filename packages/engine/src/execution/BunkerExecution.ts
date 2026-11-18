import { z } from "zod";
import { zRef } from "@openfront/engine-lib/snapshot/SnapshotType";
import { Execution, Game, Unit } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";

/**
 * Bunker: passive structure. While an active, completed bunker exists the
 * owner takes reduced troop losses from bombing (see bunkerBombingReduction).
 */
export class BunkerExecution implements Execution {
  private active = true;
  private mg: Game;

  constructor(private bunker: Unit) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (!this.bunker.isActive()) {
      this.active = false;
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return BunkerExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== undefined,
      bunker: w.unit(this.bunker),
    });
  }

  restoreSnapshot(s: BunkerState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.mg = r.game;
    this.bunker = r.unit(s.bunker);
  }
}

const BunkerStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  bunker: zRef(),
});
type BunkerState = z.infer<typeof BunkerStateSchema>;

export const BunkerExecutionSnapshot = execSnapshotType({
  name: "Bunker",
  version: 1,
  schema: BunkerStateSchema,
  cls: () => BunkerExecution,
});
