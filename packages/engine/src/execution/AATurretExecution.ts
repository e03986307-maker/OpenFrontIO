import { zRef } from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Unit } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";

/** 대공 터렛 재사용 대기시간: 13초 (1초 = 10틱) */
export const AA_TURRET_COOLDOWN_TICKS = 13 * 10;
/** 대공 터렛이 영공을 지키는 반경 (타일) */
export const AA_TURRET_RANGE = 60;

/** 터렛 레벨별 반경 / 쿨타임 */
export function aaTurretRange(level: number): number {
  return AA_TURRET_RANGE + 15 * (level - 1);
}
export function aaTurretCooldown(level: number): number {
  return Math.max(50, AA_TURRET_COOLDOWN_TICKS - 20 * (level - 1));
}

/**
 * 대공 터렛: 영공으로 들어오는 적 수송기(에어본)를 격추한다.
 * 한 번 쏘면 13초 동안 다시 쏠 수 없다 (쿨타임은 AirliftExecution이 launch()로 시작).
 */
export class AATurretExecution implements Execution {
  private active = true;
  private mg: Game;

  constructor(private turret: Unit) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (!this.turret.isActive()) {
      this.active = false;
      return;
    }
    // 쿨타임이 끝난 발사 기록 제거
    while (this.turret.missileTimerQueue().length > 0) {
      const front = this.turret.missileTimerQueue()[0];
      if (this.mg.ticks() - front < aaTurretCooldown(this.turret.level())) {
        break;
      }
      this.turret.reloadMissile();
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return AATurretExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== undefined,
      turret: w.unit(this.turret),
    });
  }

  restoreSnapshot(s: AATurretState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.mg = r.game;
    this.turret = r.unit(s.turret);
  }
}

const AATurretStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  turret: zRef(),
});
type AATurretState = z.infer<typeof AATurretStateSchema>;

export const AATurretExecutionSnapshot = execSnapshotType({
  name: "AATurret",
  version: 1,
  schema: AATurretStateSchema,
  cls: () => AATurretExecution,
});
