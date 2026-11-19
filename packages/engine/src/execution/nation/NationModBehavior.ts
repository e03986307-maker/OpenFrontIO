import { TileRef } from "@openfront/engine-api/game/GameMap";
import { UnitType } from "@openfront/engine-api/game/GameTypes";
import {
  airCapacity,
  BOMB_VARIANTS,
  BombSlot,
  MOD_ITEMS,
  slotKey,
} from "@openfront/engine-api/game/ModCatalog";
import { Game, Player } from "../../game/Game";
import { AA_TURRET_RANGE, aaTurretRange } from "../AATurretExecution";
import { AIRBORNE_COST, AirliftExecution } from "../AirliftExecution";
import { ConstructionExecution } from "../ConstructionExecution";
import { ModEquipExecution } from "../ModEquipExecution";
import { ModUpgradeExecution } from "../ModUpgradeExecution";

/** 국가 AI가 항상 남겨 두는 골드 (핵·건물 비용용) */
const RESERVE = 3_000_000n;

/** 연구/업그레이드 우선순위 (싼 것부터 자연스럽게 사도록 가격순으로 고른다) */
const RESEARCH_KEYS = MOD_ITEMS.filter(
  (i) =>
    i.group === "troop" ||
    i.group === "weapon" ||
    i.key === "tank_tech" ||
    i.key === "air_cap" ||
    i.key === "nuke_yield" ||
    i.key === "nuke_cheap",
).map((i) => i.key);

/** AI가 좋아하는 폭탄 변형 (슬롯별 우선순위, 앞이 먼저) */
const BOMB_PREFERENCE: Record<BombSlot, string[]> = {
  abomb: ["bomb_thermobaric", "bomb_cluster", "bomb_tactical"],
  hbomb: ["bomb_bio", "bomb_boosted", "bomb_fuel_air", "bomb_tsar"],
  mirv: ["bomb_mirv_wide", "bomb_mirv_precise"],
};

/**
 * 모드 기능을 국가 AI가 쓰게 하는 행동:
 * 업그레이드/무기/탱크 연구, 폭탄 연구와 슬롯 장착, 민간 공항·벙커·대공 터렛·탱크 건설.
 * 상태를 따로 저장하지 않는다 (매번 게임 상태만 보고 정한다).
 */
export class NationModBehavior {
  constructor(
    private mg: Game,
    private player: Player,
  ) {}

  /** 몇 초에 한 번 호출 */
  think(): void {
    if (!this.player.isAlive()) return;
    this.research();
    this.manageBombSlots();
    this.build();
    this.airlift();
  }

  private spendable(): bigint {
    const g = this.player.gold();
    return g > RESERVE ? g - RESERVE : 0n;
  }

  /** 지금 살 수 있는 항목 중 가장 싼 것 하나를 산다. */
  private research(): void {
    let bestKey: string | null = null;
    let bestCost = this.spendable();
    for (const key of RESEARCH_KEYS) {
      const item = MOD_ITEMS.find((i) => i.key === key)!;
      const level = this.player.modLevel(key);
      if (level >= item.maxLevel) continue;
      const cost = item.costOfNext(level);
      if (cost <= bestCost) {
        bestCost = cost;
        bestKey = key;
      }
    }
    // 병사 강화/무기는 싸게 계속 사고, 비싼 폭탄 연구는 돈이 충분히 남을 때만
    if (bestKey === null) {
      for (const v of BOMB_VARIANTS) {
        if (this.player.modLevel(v.key) > 0) continue;
        if (!BOMB_PREFERENCE[v.slot].includes(v.key)) continue;
        if (v.cost * 2n <= this.spendable()) {
          this.mg.addExecution(new ModUpgradeExecution(this.player, v.key));
          return;
        }
      }
      return;
    }
    this.mg.addExecution(new ModUpgradeExecution(this.player, bestKey));
  }

  /** 연구한 폭탄 중 가장 선호하는 것을 슬롯에 끼운다. */
  private manageBombSlots(): void {
    for (const slot of Object.keys(BOMB_PREFERENCE) as BombSlot[]) {
      const current = this.player.modLevel(slotKey(slot));
      for (const key of BOMB_PREFERENCE[slot]) {
        if (this.player.modLevel(key) === 0) continue;
        // 차르봄바는 비싸서 부자일 때만
        if (key === "bomb_tsar" && this.spendable() < 40_000_000n) continue;
        const idx = BOMB_VARIANTS.findIndex((v) => v.key === key);
        if (current !== idx + 1) {
          this.mg.addExecution(
            new ModEquipExecution(this.player, slot, idx + 1),
          );
        }
        break;
      }
    }
  }

  /**
   * 스카이포트가 있으면 가장 약한 적의 땅으로 에어본을 보낸다.
   * (이미 날고 있는 비행기가 있거나, 목표 근처에 쓸 수 있는 적 대공 터렛이 있으면 보내지 않는다.)
   */
  private airlift(): void {
    const me = this.player;
    // 약 2분에 한 번만 (think()가 여러 번 불려도 같은 구간에서 중복 출격하지 않게 비행 중이면 건너뜀)
    if (this.mg.ticks() % 1200 > 150) return;
    if (me.units(UnitType.Airborne).length > 0) return;
    const hasAirfield = me
      .units(UnitType.Airfield)
      .some((u) => u.isActive() && !u.isUnderConstruction());
    if (!hasAirfield) return;
    if (me.gold() < AIRBORNE_COST + RESERVE) return;
    if (me.troops() < 30_000) return;

    let victim: Player | null = null;
    for (const p of this.mg.players()) {
      if (p === me || !p.isAlive() || p.numTilesOwned() === 0) continue;
      if (!me.canAttackPlayer(p) || me.isFriendly(p)) continue;
      if (victim === null || p.troops() < victim.troops()) victim = p;
    }
    if (victim === null) return;

    for (const tile of victim.borderTiles()) {
      if (!this.mg.isLand(tile)) continue;
      const guarded = this.mg
        .nearbyUnits(tile, AA_TURRET_RANGE + 15 * 9, [UnitType.AATurret])
        .some(
          ({ unit, distSquared }) =>
            unit.owner() !== me &&
            unit.isActive() &&
            !unit.isUnderConstruction() &&
            distSquared <= aaTurretRange(unit.level()) ** 2,
        );
      if (guarded) continue;
      const troops = Math.min(
        Math.floor(me.troops() * 0.3),
        airCapacity(me.modLevel("air_cap")),
      );
      this.mg.addExecution(new AirliftExecution(me, tile, troops));
      return;
    }
  }

  private count(type: UnitType): number {
    return this.player.units(type).length;
  }

  private build(): void {
    const gold = this.spendable();
    const cost = (t: UnitType) =>
      this.mg.unitInfo(t).cost(this.mg, this.player);

    // 1) 민간 공항 (돈 버는 건물): 최대 3개
    if (
      this.count(UnitType.CivilAirport) < 3 &&
      gold >= cost(UnitType.CivilAirport) * 2n
    ) {
      if (this.place(UnitType.CivilAirport)) return;
    }
    // 2) 스카이포트와 대공 터렛, 벙커: 각 1개
    if (
      this.count(UnitType.Airfield) < 1 &&
      gold >= cost(UnitType.Airfield) * 3n
    ) {
      if (this.place(UnitType.Airfield)) return;
    }
    if (
      this.count(UnitType.AATurret) < 1 &&
      gold >= cost(UnitType.AATurret) * 3n
    ) {
      if (this.place(UnitType.AATurret)) return;
    }
    if (this.count(UnitType.Bunker) < 1 && gold >= cost(UnitType.Bunker) * 2n) {
      if (this.place(UnitType.Bunker)) return;
    }
    // 3) 전쟁 중이면 탱크 (최대 2대)
    if (
      this.count(UnitType.Tank) < 2 &&
      this.player.outgoingAttacks().length > 0 &&
      gold >= cost(UnitType.Tank) * 2n
    ) {
      this.place(UnitType.Tank);
    }
  }

  /** 내 땅 안에서 지을 수 있는 곳을 찾아 짓는다. */
  private place(type: UnitType): boolean {
    const anchor = this.anchorTile();
    if (anchor === null) return false;
    const map = this.mg;
    const ax = map.x(anchor);
    const ay = map.y(anchor);
    for (let r = 2; r <= 14; r += 2) {
      for (let dy = -r; dy <= r; dy += 2) {
        for (let dx = -r; dx <= r; dx += 2) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = ax + dx;
          const y = ay + dy;
          if (!map.isValidCoord(x, y)) continue;
          const tile = map.ref(x, y);
          if (map.owner(tile) !== this.player) continue;
          if (this.player.canBuild(type, tile) === false) continue;
          this.mg.addExecution(
            new ConstructionExecution(this.player, type, tile),
          );
          return true;
        }
      }
    }
    return false;
  }

  private anchorTile(): TileRef | null {
    const city = this.player.units(UnitType.City)[0];
    if (city !== undefined) return city.tile();
    return this.player.spawnTile() ?? null;
  }
}
