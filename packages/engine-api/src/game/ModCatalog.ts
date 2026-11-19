/**
 * 모드 업그레이드/연구 카탈로그.
 *
 * 플레이어는 항목마다 "단계(level)"를 하나씩 가진다. 단계 배열의 순서가 곧
 * 항목 번호이므로 **기존 항목의 순서를 바꾸지 말고 새 항목은 맨 뒤에 추가**할 것.
 * (스냅샷/네트워크에는 단계 숫자 배열만 저장된다.)
 */
export type ModGroup = "troop" | "weapon" | "supply" | "bomb" | "slot";

export interface ModItem {
  key: string;
  group: ModGroup;
  /** 최대 단계 (연구처럼 한 번만 사는 항목은 1) */
  maxLevel: number;
  /** 다음 단계(= level+1)를 사는 데 필요한 골드 */
  costOfNext(level: number): bigint;
}

/** 병사 강화: 10단계, 단계마다 +10%. 가격은 단계의 제곱에 비례해 올라 10단계가 37.5M. */
const TROOP_MAX_LEVEL = 10;
const TROOP_COST_UNIT = 375_000n;
export function troopUpgradeCost(nextLevel: number): bigint {
  return TROOP_COST_UNIT * BigInt(nextLevel * nextLevel);
}
/** n단계의 효과 배율 (1단계 = 1.1배 ... 10단계 = 2.0배) */
export function troopUpgradeMultiplier(level: number): number {
  return 1 + 0.1 * level;
}

function troopItem(key: string): ModItem {
  return {
    key,
    group: "troop",
    maxLevel: TROOP_MAX_LEVEL,
    costOfNext: (level) => troopUpgradeCost(level + 1),
  };
}

// ───────── 무기: 현대식 무기 8종 (한 번 연구하면 영구, 가장 센 무기가 적용) ─────────
export interface WeaponSpec {
  key: string;
  cost: bigint;
  /** 병사 공격력 배율 (여러 개를 연구해도 가장 큰 하나만 적용) */
  attackMultiplier: number;
}
export const WEAPONS: readonly WeaponSpec[] = [
  { key: "weapon_assault_rifle", cost: 1_500_000n, attackMultiplier: 1.1 },
  { key: "weapon_machine_gun", cost: 3_000_000n, attackMultiplier: 1.2 },
  { key: "weapon_sniper_rifle", cost: 5_000_000n, attackMultiplier: 1.35 },
  { key: "weapon_mortar", cost: 8_000_000n, attackMultiplier: 1.5 },
  { key: "weapon_rocket_launcher", cost: 12_000_000n, attackMultiplier: 1.7 },
  { key: "weapon_howitzer", cost: 18_000_000n, attackMultiplier: 1.95 },
  { key: "weapon_atgm", cost: 26_000_000n, attackMultiplier: 2.25 },
  { key: "weapon_railgun", cost: 36_000_000n, attackMultiplier: 2.6 },
];

// ───────── 폭탄: 기존 3개 슬롯(원자/수소/다탄두)에 끼우는 변형 ─────────
export type BombSlot = "abomb" | "hbomb" | "mirv";
export interface BombVariant {
  key: string;
  slot: BombSlot;
  cost: bigint;
  /** 폭발 반경 배율 (안쪽/바깥쪽) */
  innerMul: number;
  outerMul: number;
  /** 병력 피해 배율 */
  troopMul: number;
  /** 건물(유닛) 파괴 여부 */
  destroysStructures: boolean;
  /** 폭탄 구매 가격 배율 (벙커 부스터 제외) */
  priceMul: number;
  /** 값이 있으면 배율 대신 이 가격으로 고정 (연구 할인은 적용) */
  fixedPrice?: bigint;
  /** 터진 자리를 오염 지대로 만들어 한동안 재점령을 막는다 (생화학탄) */
  contaminates?: boolean;
}
export const BOMB_VARIANTS: readonly BombVariant[] = [
  // 원자폭탄 슬롯 (기본: 반경 12/30)
  {
    key: "bomb_cluster",
    slot: "abomb",
    cost: 4_000_000n,
    innerMul: 0.8,
    outerMul: 2.0,
    troopMul: 1.0,
    destroysStructures: true,
    priceMul: 1.2,
  },
  {
    key: "bomb_thermobaric",
    slot: "abomb",
    cost: 6_000_000n,
    innerMul: 1.8,
    outerMul: 1.3,
    troopMul: 2.5,
    destroysStructures: true,
    priceMul: 1.3,
  },
  {
    key: "bomb_tactical",
    slot: "abomb",
    cost: 3_000_000n,
    innerMul: 1.0,
    outerMul: 1.0,
    troopMul: 1.2,
    destroysStructures: true,
    priceMul: 0.4,
  },
  {
    key: "bomb_neutron",
    slot: "abomb",
    cost: 9_000_000n,
    innerMul: 1.2,
    outerMul: 1.7,
    troopMul: 5.0,
    destroysStructures: false,
    priceMul: 1.5,
  },
  {
    key: "bomb_emp",
    slot: "abomb",
    cost: 7_000_000n,
    innerMul: 1.5,
    outerMul: 2.4,
    troopMul: 0.3,
    destroysStructures: true,
    priceMul: 0.9,
  },
  // 수소폭탄 슬롯 (기본: 반경 80/100)
  {
    key: "bomb_tsar",
    slot: "hbomb",
    cost: 60_000_000n,
    innerMul: 2.2,
    outerMul: 2.2,
    troopMul: 3.0,
    destroysStructures: true,
    priceMul: 3,
  },
  {
    key: "bomb_dirty",
    slot: "hbomb",
    cost: 20_000_000n,
    innerMul: 1.0,
    outerMul: 2.2,
    troopMul: 1.0,
    destroysStructures: true,
    priceMul: 0.8,
  },
  {
    key: "bomb_fuel_air",
    slot: "hbomb",
    cost: 25_000_000n,
    innerMul: 1.5,
    outerMul: 1.8,
    troopMul: 2.5,
    destroysStructures: true,
    priceMul: 1.2,
  },
  {
    key: "bomb_boosted",
    slot: "hbomb",
    cost: 30_000_000n,
    innerMul: 1.7,
    outerMul: 1.7,
    troopMul: 1.6,
    destroysStructures: true,
    priceMul: 1.5,
  },
  // 생화학탄: 중간 반경, 병력이 거의 전멸, 오염 지대로 한동안 재점령이 매우 어려움. 건물은 안 부숨.
  {
    key: "bomb_bio",
    slot: "hbomb",
    cost: 15_000_000n,
    innerMul: 0.4,
    outerMul: 0.6,
    troopMul: 12,
    destroysStructures: false,
    priceMul: 1,
    fixedPrice: 20_000_000n,
    contaminates: true,
  },
  // 다탄두 슬롯 (탄두 하나의 반경, 기본 12/18)
  {
    key: "bomb_mirv_precise",
    slot: "mirv",
    cost: 15_000_000n,
    innerMul: 2.2,
    outerMul: 1.4,
    troopMul: 1.5,
    destroysStructures: true,
    priceMul: 1.1,
  },
  {
    key: "bomb_mirv_wide",
    slot: "mirv",
    cost: 15_000_000n,
    innerMul: 1.2,
    outerMul: 2.3,
    troopMul: 1.2,
    destroysStructures: true,
    priceMul: 1.1,
  },
];
/** 생화학 오염 지대: 지속 시간(틱, 5분)과 재점령 비용 배율 */
export const BIO_ZONE_TICKS = 5 * 60 * 10;
export const BIO_ATTACKER_LOSS_MUL = 6; // 오염 지대를 점령할 때 공격자 병력 손실 x6
export const BIO_SPEED_MUL = 3; // 오염 지대 점령 속도 1/3
/** 12번째 폭탄: 벙커 부스터 (독립 폭탄, 연구해야 쓸 수 있음) */
export const BUNKER_BUSTER_RESEARCH = {
  key: "bomb_bunker_buster",
  cost: 5_000_000n,
};

export const BOMB_SLOTS: readonly BombSlot[] = ["abomb", "hbomb", "mirv"];
export const slotKey = (slot: BombSlot) => `slot_${slot}`;

function researchItem(key: string, group: ModGroup, cost: bigint): ModItem {
  return { key, group, maxLevel: 1, costOfNext: () => cost };
}

function tieredItem(
  key: string,
  group: ModGroup,
  unit: bigint,
  max: number,
): ModItem {
  return {
    key,
    group,
    maxLevel: max,
    costOfNext: (level) => unit * BigInt((level + 1) * (level + 1)),
  };
}

/** 핵 위력 연구: 단계마다 모든 핵폭탄(원자/수소/다탄두)의 폭발 반경과 병력 피해 +12% (최대 6단계) */
export function nukeYieldMultiplier(level: number): number {
  return 1 + 0.12 * level;
}
/** 핵 가격 할인 연구: 단계마다 모든 핵폭탄 구매 가격 -8% (최대 5단계, 최대 -40%) */
export function nukePriceFactor(level: number): number {
  return Math.max(0.6, 1 - 0.08 * level);
}

/** 탱크 연구 단계(0~5)의 지원 효과: 근처 전투에서 병력 손실 배율 / 점령 시간 배율 */
export function tankLossFactor(techLevel: number): number {
  return Math.max(0.3, 0.6 - 0.05 * techLevel);
}
export function tankSpeedFactor(techLevel: number): number {
  return Math.max(0.4, 0.7 - 0.05 * techLevel);
}
/** 수송기 한 번에 실을 수 있는 병사 수 (연구할수록 증가) */
export function airCapacity(level: number): number {
  return 15_000 * (1 + level);
}

export const MOD_ITEMS: readonly ModItem[] = [
  troopItem("troop_hp"), // 0: 병사 체력 (자기 병력 손실 감소)
  troopItem("troop_atk"), // 1: 병사 공격력 (적 병력 손실 증가, 점령 속도 증가)
  troopItem("troop_def"), // 2: 병사 방어력 (공격자의 손실 증가, 점령 속도 감소)
  ...WEAPONS.map((w) => researchItem(w.key, "weapon", w.cost)), // 3~10
  tieredItem("tank_tech", "supply", 6_000_000n, 5), // 11: 탱크 연구 (단계마다 더 좋은 탱크)
  tieredItem("air_cap", "supply", 4_000_000n, 5), // 12: 수송기 적재량
  ...BOMB_VARIANTS.map((b) => researchItem(b.key, "bomb", b.cost)), // 13~23
  researchItem(BUNKER_BUSTER_RESEARCH.key, "bomb", BUNKER_BUSTER_RESEARCH.cost), // 24
  // 슬롯 장착 상태: 값 = 장착한 변형의 BOMB_VARIANTS 번호 + 1 (0 = 기본 폭탄)
  { key: "slot_abomb", group: "slot", maxLevel: 0, costOfNext: () => 0n }, // 25
  { key: "slot_hbomb", group: "slot", maxLevel: 0, costOfNext: () => 0n }, // 26
  { key: "slot_mirv", group: "slot", maxLevel: 0, costOfNext: () => 0n }, // 27
  tieredItem("nuke_yield", "bomb", 3_000_000n, 6), // 28: 핵 위력 (반경·병력 피해 +12%/단계)
  tieredItem("nuke_cheap", "bomb", 4_000_000n, 5), // 29: 핵 가격 할인 (-8%/단계)
];

/** 연구한 무기 중 가장 센 무기의 공격력 배율 (없으면 1) */
export function bestWeaponMultiplier(levelOf: (key: string) => number): number {
  let best = 1;
  for (const w of WEAPONS) {
    if (levelOf(w.key) > 0 && w.attackMultiplier > best)
      best = w.attackMultiplier;
  }
  return best;
}

/** 해당 슬롯에 장착된 폭탄 변형 (기본 폭탄이면 null) */
export function equippedVariant(
  slot: BombSlot,
  levelOf: (key: string) => number,
): BombVariant | null {
  const n = levelOf(slotKey(slot));
  if (n <= 0) return null;
  const v = BOMB_VARIANTS[n - 1];
  return v !== undefined && v.slot === slot && levelOf(v.key) > 0 ? v : null;
}

export const MOD_KEYS: readonly string[] = MOD_ITEMS.map((i) => i.key);

export function modIndex(key: string): number {
  return MOD_KEYS.indexOf(key);
}

export function modItem(key: string): ModItem | undefined {
  return MOD_ITEMS.find((i) => i.key === key);
}

/**
 * 클라이언트 미리보기용: 기본 폭발 반경에 장착한 변형과 핵 위력 연구를 반영한다.
 * (서버 쪽 NukeExecution.magnitude()와 같은 계산)
 */
export function scaleNukeMagnitude(
  base: { inner: number; outer: number },
  unitType: string,
  levelOf: (key: string) => number,
): { inner: number; outer: number } {
  const slot: BombSlot | null =
    unitType === "Atom Bomb"
      ? "abomb"
      : unitType === "Hydrogen Bomb"
        ? "hbomb"
        : unitType === "MIRV Warhead" || unitType === "MIRV"
          ? "mirv"
          : null;
  if (slot === null) return base;
  const v = equippedVariant(slot, levelOf);
  const y = nukeYieldMultiplier(levelOf("nuke_yield"));
  return {
    inner: base.inner * (v?.innerMul ?? 1) * y,
    outer: base.outer * (v?.outerMul ?? 1) * y,
  };
}
