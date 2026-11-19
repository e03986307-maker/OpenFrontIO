import { TileRef } from "@openfront/engine-api/game/GameMap";
import { UnitType } from "@openfront/engine-api/game/GameTypes";
import {
  zInt,
  zPlayerRef,
  zRef,
} from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Player, Unit } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";

/** 탱크가 아군 공격을 도와주는 반경 (타일) */
export const TANK_SUPPORT_RANGE = 25;
/** 탱크 이동 주기: 3틱마다 1타일 */
const TANK_MOVE_INTERVAL = 3;
/** 한 번에 살펴볼 최대 전선 타일 수 (성능 보호) */
const MAX_FRONT_SCAN = 300;

/**
 * 탱크: 자기 땅 안에 배치한다. 전쟁(지상 공격)이 시작되면 가장 가까운 전선
 * 쪽으로 스스로 이동하고, 탱크 근처에서 싸우는 공격은 병력 손실이 줄고
 * 더 빨리 점령한다 (AttackExecution 참고).
 */
export class TankExecution implements Execution {
  private active = true;
  private mg: Game;
  private tank: Unit | null = null;
  private nbuf: TileRef[] = [];

  constructor(
    private owner: Player,
    private tile: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    const spawn = this.owner.canBuild(UnitType.Tank, this.tile);
    if (spawn === false) {
      console.warn("cannot build Tank");
      this.active = false;
      return;
    }
    this.tank = this.owner.buildUnit(UnitType.Tank, spawn, {});
  }

  tick(ticks: number): void {
    if (this.tank === null || !this.tank.isActive()) {
      this.active = false;
      return;
    }
    if (this.tank.owner() !== this.owner) {
      this.owner = this.tank.owner();
    }
    if (ticks % TANK_MOVE_INTERVAL !== 0) return;

    const goal = this.frontTarget();
    if (goal === null) return;

    const map = this.mg.map();
    const here = this.tank.tile();
    let best = here;
    let bestDist = this.mg.euclideanDistSquared(here, goal);
    const n = map.neighbors8(here, (this.nbuf = []));
    for (let i = 0; i < n; i++) {
      const t = this.nbuf[i];
      if (!map.isLand(t) || map.isImpassable(t)) continue;
      const d = this.mg.euclideanDistSquared(t, goal);
      if (d < bestDist) {
        bestDist = d;
        best = t;
      }
    }
    if (best !== here) this.tank.move(best);
  }

  /** 가장 가까운 전선 타일 (진행 중인 지상 공격이 없으면 null) */
  private frontTarget(): TileRef | null {
    const here = this.tank!.tile();
    let best: TileRef | null = null;
    let bestDist = Infinity;
    for (const attack of this.owner.outgoingAttacks()) {
      if (!attack.isActive() || attack.retreating()) continue;
      let scanned = 0;
      for (const t of attack.borderTiles()) {
        const d = this.mg.euclideanDistSquared(here, t);
        if (d < bestDist) {
          bestDist = d;
          best = t;
        }
        if (++scanned >= MAX_FRONT_SCAN) break;
      }
    }
    return best;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return TankExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== undefined,
      owner: w.player(this.owner),
      tile: this.tile,
      tank: this.tank === null ? null : w.unit(this.tank),
    });
  }

  restoreSnapshot(s: TankState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.mg = r.game;
    this.owner = r.player(s.owner);
    this.tile = s.tile;
    this.tank = s.tank === null ? null : r.unit(s.tank);
  }
}

const TankStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  owner: zPlayerRef(),
  tile: zInt(),
  tank: zRef().nullable(),
});
type TankState = z.infer<typeof TankStateSchema>;

export const TankExecutionSnapshot = execSnapshotType({
  name: "Tank",
  version: 1,
  schema: TankStateSchema,
  cls: () => TankExecution,
});
