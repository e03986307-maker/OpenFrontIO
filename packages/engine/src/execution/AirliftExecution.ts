import { TileRef } from "@openfront/engine-api/game/GameMap";
import { UnitType } from "@openfront/engine-api/game/GameTypes";
import {
  zInt,
  zNum,
  zPlayerRef,
  zTile,
} from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Player } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { airCapacity } from "@openfront/engine-api/game/ModCatalog";
import { AA_TURRET_RANGE, aaTurretRange } from "./AATurretExecution";
import { AttackExecution } from "./AttackExecution";

/** 병사 수송기 "에어본" 1회 출격 비용: 3M */
export const AIRBORNE_COST = 3_000_000n;
/** 수송기 속도: 틱당 타일 수 (맨해튼 거리 기준) */
const AIRBORNE_TILES_PER_TICK = 2;

/**
 * 에어본: 스카이포트에서 병사만 싣고 날아가 다른 땅에 착륙해 공격한다.
 * 조건: 완공된 스카이포트 1개 이상 + 3M. 병사는 출발 시 차감된다.
 * (지도에 보이는 비행기 그림은 아직 없음 - 이후 단계에서 추가)
 */
export class AirliftExecution implements Execution {
  private active = true;
  private mg: Game;
  private arrivalTick = 0;
  private troops: number;

  constructor(
    private attacker: Player,
    private dst: TileRef,
    troops: number,
  ) {
    this.troops = troops;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    if (!mg.isValidRef(this.dst) || !mg.isLand(this.dst)) {
      return this.fail("invalid destination");
    }
    const target = mg.owner(this.dst);
    if (target === this.attacker) return this.fail("own territory");
    if (target.isPlayer() && !this.attacker.canAttackPlayer(target)) {
      return this.fail("cannot attack that player");
    }

    const airfields = this.attacker
      .units(UnitType.Airfield)
      .filter((u) => u.isActive() && !u.isUnderConstruction());
    if (airfields.length === 0) return this.fail("no airfield");
    if (this.attacker.gold() < AIRBORNE_COST) return this.fail("no gold");

    this.troops = Math.min(
      this.troops,
      this.attacker.troops(),
      airCapacity(this.attacker.modLevel("air_cap")),
    );
    if (!(this.troops > 0)) return this.fail("no troops");

    // 가장 가까운 스카이포트에서 출발
    let best = Infinity;
    for (const a of airfields) {
      best = Math.min(best, mg.manhattanDist(a.tile(), this.dst));
    }
    this.arrivalTick =
      ticks + Math.max(1, Math.ceil(best / AIRBORNE_TILES_PER_TICK));

    this.attacker.removeGold(AIRBORNE_COST);
    this.attacker.removeTroops(this.troops);
  }

  private fail(reason: string): void {
    console.warn(`Airborne launch failed (${reason})`);
    this.active = false;
  }

  tick(ticks: number): void {
    if (!this.active || ticks < this.arrivalTick) return;
    this.active = false;

    // 대공 터렛: 착륙 지점 영공에 쿨타임이 끝난 적 터렛이 있으면 격추 (병사 전멸)
    const turret = this.mg
      .nearbyUnits(this.dst, AA_TURRET_RANGE + 15 * 9, [UnitType.AATurret])
      .filter(
        ({ unit, distSquared }) =>
          distSquared <= aaTurretRange(unit.level()) ** 2,
      )
      .map(({ unit }) => unit)
      .find(
        (u) =>
          u.isActive() &&
          !u.isUnderConstruction() &&
          !u.isInCooldown() &&
          u.owner() !== this.attacker &&
          !this.attacker.isFriendly(u.owner()),
      );
    if (turret !== undefined) {
      turret.launch();
      console.warn(
        `Airborne shot down by AA turret of ${turret.owner().name()}`,
      );
      return;
    }

    const target = this.mg.owner(this.dst);
    if (target === this.attacker) {
      this.attacker.addTroops(this.troops);
      return;
    }
    if (target.isPlayer() && this.attacker.isFriendly(target)) {
      this.attacker.addTroops(this.troops);
      return;
    }
    this.attacker.conquer(this.dst);
    this.mg.addExecution(
      new AttackExecution(
        this.troops,
        this.attacker,
        target.isPlayer() ? target.id() : this.mg.terraNullius().id(),
        this.dst,
        false,
      ),
    );
  }

  owner(): Player {
    return this.attacker;
  }

  isActive(): boolean {
    return this.active;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return AirliftExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== undefined,
      attacker: w.player(this.attacker),+      dst: this.dst,
      troops: this.troops,
      arrivalTick: this.arrivalTick,
    });
  }

  restoreSnapshot(s: AirliftState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.mg = r.game;
    this.attacker = r.player(s.attacker);
    this.dst = s.dst;
    this.troops = s.troops;
    this.arrivalTick = s.arrivalTick;
  }
}

const AirliftStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  attacker: zPlayerRef(),
  dst: zTile(),
  troops: zNum(),
  arrivalTick: zInt(),
});
type AirliftState = z.infer<typeof AirliftStateSchema>;

export const AirliftExecutionSnapshot = execSnapshotType({
  name: "Airlift",
  version: 1,
  schema: AirliftStateSchema,
  cls: () => AirliftExecution,
});
