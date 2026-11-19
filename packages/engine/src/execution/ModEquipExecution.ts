import {
  BOMB_SLOTS,
  BOMB_VARIANTS,
  BombSlot,
  slotKey,
} from "@openfront/engine-api/game/ModCatalog";
import { zInt, zPlayerRef } from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Player } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";

/**
 * 폭탄 슬롯(원자/수소/다탄두)에 연구한 폭탄 변형을 끼운다.
 * variant 0 = 기본 폭탄으로 되돌리기, n>0 = BOMB_VARIANTS[n-1].
 * 연구하지 않았거나 슬롯이 다르면 무시한다. 같은 틱에 끝난다.
 */
export class ModEquipExecution implements Execution {
  private active = true;

  constructor(
    private player: Player,
    private slot: string,
    private variant: number,
  ) {}

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game, ticks: number): void {
    this.active = false;
    if (!(BOMB_SLOTS as readonly string[]).includes(this.slot)) return;
    const slot = this.slot as BombSlot;
    if (this.variant === 0) {
      this.player.setModLevel(slotKey(slot), 0);
      return;
    }
    const v = BOMB_VARIANTS[this.variant - 1];
    if (v === undefined || v.slot !== slot) return;
    if (this.player.modLevel(v.key) === 0) return; // 아직 연구 안 함
    this.player.setModLevel(slotKey(slot), this.variant);
  }

  tick(ticks: number): void {}

  isActive(): boolean {
    return this.active;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return ModEquipExecutionSnapshot.write({
      active: this.active,
      player: w.player(this.player),
      slot: this.slot,
      variant: this.variant,
    });
  }

  restoreSnapshot(s: ModEquipState, r: SnapshotReader): void {
    this.active = s.active;
    this.player = r.player(s.player);
    this.slot = s.slot;
    this.variant = s.variant;
  }
}

const ModEquipStateSchema = z.object({
  active: z.boolean(),
  player: zPlayerRef(),
  slot: z.string(),
  variant: zInt(),
});
type ModEquipState = z.infer<typeof ModEquipStateSchema>;

export const ModEquipExecutionSnapshot = execSnapshotType({
  name: "ModEquip",
  version: 1,
  schema: ModEquipStateSchema,
  cls: () => ModEquipExecution,
});
