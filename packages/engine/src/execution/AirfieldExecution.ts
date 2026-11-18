import { zRef } from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Unit } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";

/** 스카이포트 1개가 보유할 수 있는 전투기 수 */
export const FIGHTERS_PER_AIRFIELD = 2;
/** 전투기 1대 생산 주기: 60초 (1초 = 10틱) */
export const FIGHTER_BUILD_TICKS = 60 * 10;

/**
 * 스카이포트: 완공 후 60초마다 전투기 1대를 만들고, 최대 2대까지 보관한다.
 * 전투기는 이후 단계(수송기/대공 터렛)에서 사용한다.
 */
export class AirfieldExecution implements Execution {
  private active = true;
  private mg: Game;
  private fighters = 0;
  private ticksSinceBuilt = 0;

  constructor(private airfield: Unit) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  fighterCount(): number {
    return this.fighters;
  }

  /** 전투기를 사용(소모). 성공하면 true */
  takeFighter(): boolean {
    if (this.fighters <= 0) return false;
    this.fighters--;
    return true;
  }

  tick(ticks: number): void {
    if (!this.airfield.isActive()) {
      this.active = false;
      return;
    }
    if (this.airfield.isUnderConstruction()) return;
    const level = this.airfield.level();
    if (this.fighters >= FIGHTERS_PER_AIRFIELD * level) {
      this.ticksSinceBuilt = 0;
      return;
    }
    this.ticksSinceBuilt++;
    // 레벨이 높을수록 더 빨리 만든다 (레벨 n이면 60초 / n)
    if (this.ticksSinceBuilt >= FIGHTER_BUILD_TICKS / level) {
      this.ticksSinceBuilt = 0;
      this.fighters++;
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return AirfieldExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== undefined,
      airfield: w.unit(this.airfield),
      fighters: this.fighters,
      ticksSinceBuilt: this.ticksSinceBuilt,
    });
  }

  restoreSnapshot(s: AirfieldState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.mg = r.game;
    this.airfield = r.unit(s.airfield);
    this.fighters = s.fighters;
    this.ticksSinceBuilt = s.ticksSinceBuilt;
  }
}

const AirfieldStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  airfield: zRef(),
  fighters: z.number(),
  ticksSinceBuilt: z.number(),
});
type AirfieldState = z.infer<typeof AirfieldStateSchema>;

export const AirfieldExecutionSnapshot = execSnapshotType({
  name: "Airfield",
  version: 1,
  schema: AirfieldStateSchema,
  cls: () => AirfieldExecution,
});
