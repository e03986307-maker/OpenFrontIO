import { modItem } from "@openfront/engine-api/game/ModCatalog";
import { zPlayerRef } from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Player } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";

/**
 * 모드 업그레이드/연구 한 단계를 산다. 골드가 모자라거나 최대 단계면 무시.
 * 같은 틱에 한 번에 끝난다.
 */
export class ModUpgradeExecution implements Execution {
  private active = true;

  constructor(
    private player: Player,
    private key: string,
  ) {}

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game, ticks: number): void {
    this.active = false;
    const item = modItem(this.key);
    if (item === undefined) {
      console.warn(`unknown mod upgrade ${this.key}`);
      return;
    }
    const level = this.player.modLevel(this.key);
    if (level >= item.maxLevel) return;
    const cost = item.costOfNext(level);
    if (this.player.gold() < cost) return;
    this.player.removeGold(cost);
    this.player.setModLevel(this.key, level + 1);
  }

  tick(ticks: number): void {}

  isActive(): boolean {
    return this.active;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return ModUpgradeExecutionSnapshot.write({
      active: this.active,
      player: w.player(this.player),
      key: this.key,
    });
  }

  restoreSnapshot(s: ModUpgradeState, r: SnapshotReader): void {
    this.active = s.active;
    this.player = r.player(s.player);
    this.key = s.key;
  }
}

const ModUpgradeStateSchema = z.object({
  active: z.boolean(),
  player: zPlayerRef(),
  key: z.string(),
});
type ModUpgradeState = z.infer<typeof ModUpgradeStateSchema>;

export const ModUpgradeExecutionSnapshot = execSnapshotType({
  name: "ModUpgrade",
  version: 1,
  schema: ModUpgradeStateSchema,
  cls: () => ModUpgradeExecution,
});
