import { TileRef } from "@openfront/engine-api/game/GameMap";
import { UnitType } from "@openfront/engine-api/game/GameTypes";
import {
  zInt,
  zNum,
  zPlayerRef,
  zRef,
  zTile,
} from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Player, Unit } from "../game/Game";
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
/** 수송기 속도: 틱당 타일 수 */
const AIRBORNE_TILES_PER_TICK = 1.5;
/** 대공 터렛 검사 주기 (틱) */
const AA_CHECK_INTERVAL = 2;

/**
 * 에어본: 스카이포트에서 병사만 싣고 날아가 다른 땅에 착륙해 공격한다.
 * 조건: 완공된 스카이포트 1개 이상 + 3M. 병사는 출발 시 차감된다.
 * 날아가는 동안 지도에 비행기(Airborne 유닛)가 보이고, 항로(출발~목표 직선)가
 * 트레일로 표시된다. 적 대공 터렛 범위에 들어오면 날아가는 도중에도 격추된다.
 */
export class AirliftExecution implements Execution {
  private active = true;
  private mg: Game;
  private plane: Unit | null = null;
  private startTick = 0;
  private startTile: TileRef = 0;
  private flightTicks = 0;
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

    this.troops = Math.min(+      this.troops,
      this.attacker.troops(),
      airCapacity(this.attacker.modLevel("air_cap")),
    );
    if (!(this.troops > 0)) return this.fail("no troops");

    // 가장 가까운 스카이포트에서 출발
    let best = Infinity;
    let from = airfields[0].tile();
    for (const a of airfields) {
      const d = mg.euclideanDistSquared(a.tile(), this.dst);
      if (d < best) {
        best = d;
        from = a.tile();
      }
    }
    this.startTile = from;
    this.startTick = ticks;
    this.flightTicks = Math.max(
      1,
      Math.ceil(Math.sqrt(best) / AIRBORNE_TILES_PER_TICK),
    );

    this.attacker.removeGold(AIRBORNE_COST);
    // (병사는 비행기를 만들 때 buildUnit이 자동으로 차감한다)

    // 지도에 보이는 비행기: 목표 타일을 알려 두면 클라이언트가 항로를 그린다.
    this.plane = this.attacker.buildUnit(UnitType.Airborne, from, {
      troops: this.troops,
    });
    this.plane.setTargetTile(this.dst);
  }

  private fail(reason: string): void {
    console.warn(`Airborne launch failed (${reason})`);
    this.active = false;
  }

  /** 지금 비행기가 있어야 할 타일 (출발~목표 직선 보간) */
  private positionAt(t: number): TileRef {
    const map = this.mg;
    const sx = map.x(this.startTile);
    const sy = map.y(this.startTile);
    const dx = map.x(this.dst) - sx;
    const dy = map.y(this.dst) - sy;
    const f = Math.min(1, t / this.flightTicks);
    return map.ref(Math.round(sx + dx * f), Math.round(sy + dy * f));
  }

  /** 비행기 위치 근처의 쿨타임 끝난 적 대공 터렛 */
  private readyTurretNear(tile: TileRef): Unit | undefined {
    return this.mg
      .nearbyUnits(tile, AA_TURRET_RANGE + 15 * 9, [UnitType.AATurret])
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
  }

  tick(ticks: number): void {
    if (!this.active || this.plane === null) return;
    if (!this.plane.isActive()) {
      // 다른 이유로 비행기가 사라짐 (병사 전멸)
      this.active = false;
      return;
    }
    const t = ticks - this.startTick;

    if (t >= this.flightTicks) {
      this.land();
      return;
    }

    const pos = this.positionAt(t);
    this.plane.move(pos);

    // 날아가는 도중 대공 터렛에 격추
    if (t % AA_CHECK_INTERVAL === 0) {
      const turret = this.readyTurretNear(pos);
      if (turret !== undefined) {
        turret.launch();
        console.warn(
          `Airborne shot down by AA turret of ${turret.owner().name()}`,
        );
        this.plane.delete(false);
        this.active = false;
      }
    }
  }

  /** 목표에 도착해 착륙하고 공격을 시작한다. */
  private land(): void {
    this.active = false;
    this.plane?.delete(false);

    // 착륙 지점 영공에도 한 번 더 검사
    const turret = this.readyTurretNear(this.dst);
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
      attacker: w.player(this.attacker),
      dst: this.dst,
      troops: this.troops,
      plane: this.plane === null ? null : w.unit(this.plane),
      startTick: this.startTick,
      startTile: this.startTile,
      flightTicks: this.flightTicks,
    });
  }

  restoreSnapshot(s: AirliftState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.mg = r.game;
    this.attacker = r.player(s.attacker);
    this.dst = s.dst;
    this.troops = s.troops;
    this.plane = s.plane === null ? null : r.unit(s.plane);
    this.startTick = s.startTick;
    this.startTile = s.startTile;
    this.flightTicks = s.flightTicks;
  }
}

const AirliftStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  attacker: zPlayerRef(),
  dst: zTile(),
  troops: zNum(),
  plane: zRef().nullable(),
  startTick: zInt(),
  startTile: zTile(),
  flightTicks: zInt(),
});
type AirliftState = z.infer<typeof AirliftStateSchema>;

export const AirliftExecutionSnapshot = execSnapshotType({
  name: "Airlift",
  version: 1,
  schema: AirliftStateSchema,
  cls: () => AirliftExecution,
});
