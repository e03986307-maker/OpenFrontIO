import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { AirfieldExecution } from "@openfront/engine/execution/AirfieldExecution";
import {
  AIRBORNE_COST,
  AirliftExecution,
} from "@openfront/engine/execution/AirliftExecution";
import { AATurretExecution } from "@openfront/engine/execution/AATurretExecution";
import { BunkerExecution } from "@openfront/engine/execution/BunkerExecution";
import { NukeExecution } from "@openfront/engine/execution/NukeExecution";
import { AttackExecution } from "@openfront/engine/execution/AttackExecution";
import { CivilAirportExecution } from "@openfront/engine/execution/CivilAirportExecution";
import { NationModBehavior } from "@openfront/engine/execution/nation/NationModBehavior";
import { ModEquipExecution } from "@openfront/engine/execution/ModEquipExecution";
import { ModUpgradeExecution } from "@openfront/engine/execution/ModUpgradeExecution";
import { TankExecution } from "@openfront/engine/execution/TankExecution";
import { Game, Player, Unit } from "@openfront/engine/game/Game";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

let game: Game;
let p1: Player;
let p2: Player;

describe("Bunker / Skyport / Airborne", () => {
  beforeEach(async () => {
    game = await setup("half_land_half_ocean", { instantBuild: true }, [
      new PlayerInfo("a", PlayerType.Human, null, "p1"),
      new PlayerInfo("b", PlayerType.Human, null, "p2"),
    ]);
    p1 = game.player("p1");
    p2 = game.player("p2");
    for (let x = 0; x < 3; x++) for (let y = 0; y < 6; y++) p1.conquer(game.ref(x, y));
    for (let x = 4; x < 7; x++) for (let y = 0; y < 6; y++) p2.conquer(game.ref(x, y));
    executeTicks(game, 5);
  });

  test("costs are 20M bunker / 10M skyport, fixed", () => {
    expect(game.config().unitInfo(UnitType.Bunker).cost(game, p1)).toBe(20_000_000n);
    const c1 = game.config().unitInfo(UnitType.Airfield).cost(game, p1);
    p1.buildUnit(UnitType.Airfield, game.ref(1, 1), {});
    expect(c1).toBe(10_000_000n);
    expect(game.config().unitInfo(UnitType.Airfield).cost(game, p1)).toBe(10_000_000n);
  });

  test("skyport makes 1 fighter per 60s, max 2", () => {
    const af = p1.buildUnit(UnitType.Airfield, game.ref(1, 1), {});
    const ex = new AirfieldExecution(af);
    game.addExecution(ex);
    executeTicks(game, 599);
    expect(ex.fighterCount()).toBe(0);
    executeTicks(game, 3);
    expect(ex.fighterCount()).toBe(1);
    executeTicks(game, 700);
    expect(ex.fighterCount()).toBe(2);
    executeTicks(game, 700);
    expect(ex.fighterCount()).toBe(2);
  });

  test("airborne needs a skyport and 3M, then attacks", () => {
    p1.addGold(50_000_000n);
    p1.addTroops(100_000);
    const dst = game.ref(5, 2);

    const before = p1.gold();
    game.addExecution(new AirliftExecution(p1, dst, 1000));
    executeTicks(game, 2);
    expect(p1.gold()).toBe(before); // 스카이포트 없음 -> 실패

    const af = p1.buildUnit(UnitType.Airfield, game.ref(1, 1), {});
    game.addExecution(new AirfieldExecution(af));
    executeTicks(game, 2);
    const g = p1.gold();
    const t = p1.troops();
    game.addExecution(new AirliftExecution(p1, dst, 1000));
    executeTicks(game, 1);
    expect(p1.gold()).toBe(g - AIRBORNE_COST);
    expect(p1.troops()).toBeLessThan(t);
    executeTicks(game, 30);
    expect(p1.numTilesOwned()).toBeGreaterThan(18);
  });

  test("AA turret: 7M fixed, shoots down airborne, 13s cooldown", () => {
    expect(game.config().unitInfo(UnitType.AATurret).cost(game, p2)).toBe(7_000_000n);
    p1.addGold(50_000_000n);
    p1.addTroops(100_000);
    const af = p1.buildUnit(UnitType.Airfield, game.ref(1, 1), {});
    game.addExecution(new AirfieldExecution(af));
    const turret = p2.buildUnit(UnitType.AATurret, game.ref(5, 3), {});
    game.addExecution(new AATurretExecution(turret));
    executeTicks(game, 2);

    const dst = game.ref(5, 2);
    game.addExecution(new AirliftExecution(p1, dst, 1000));
    executeTicks(game, 30);
    expect(game.owner(dst)).toBe(p2); // 격추됨
    expect(turret.isInCooldown()).toBe(true);

    executeTicks(game, 140); // 13초 지남
    expect(turret.isInCooldown()).toBe(false);
    game.addExecution(new AirliftExecution(p1, dst, 1000));
    executeTicks(game, 1);
    // 두 번째는 쿨타임이 끝난 터렛이 다시 격추
    executeTicks(game, 30);
    expect(game.owner(dst)).toBe(p2);
    expect(turret.isInCooldown()).toBe(true);

    // 쿨타임 중에 보내면 통과
    game.addExecution(new AirliftExecution(p1, dst, 1000));
    executeTicks(game, 30);
    expect(game.owner(dst)).toBe(p1);
  });
});

describe("Bunker nuke protection", () => {
  test("bunker cuts troop loss from a nuke by ~90%", async () => {
    const g = await setup("plains", { instantBuild: true, infiniteGold: true }, [
      new PlayerInfo("a", PlayerType.Human, null, "a"),
      new PlayerInfo("b", PlayerType.Human, null, "b"),
      new PlayerInfo("c", PlayerType.Human, null, "c"),
    ]);
    const a = g.player("a");
    const b = g.player("b");
    const c = g.player("c");
    for (let x = 0; x < 10; x++)
      for (let y = 0; y < 10; y++) a.conquer(g.ref(x, y));
    for (let x = 50; x < 60; x++)
      for (let y = 50; y < 60; y++) b.conquer(g.ref(x, y));
    for (let x = 30; x < 36; x++)
      for (let y = 30; y < 36; y++) c.conquer(g.ref(x, y));
    c.buildUnit(UnitType.MissileSilo, g.ref(32, 32), {});
    c.buildUnit(UnitType.MissileSilo, g.ref(34, 34), {});
    executeTicks(g, 3);
    const bunker = a.buildUnit(UnitType.Bunker, g.ref(2, 2), {});
    g.addExecution(new BunkerExecution(bunker));
    executeTicks(g, 3);

    executeTicks(g, 400); // 스폰 보호 시간 지나가기
    const lossRatio = (victim: Player, x: number, y: number) => {
      const before = victim.troops();
      g.addExecution(new NukeExecution(UnitType.AtomBomb, c, g.ref(x, y), null));
      executeTicks(g, 600);
      return (before - victim.troops()) / before;
    };
    const withBunker = lossRatio(a, 5, 5);
    const without = lossRatio(b, 55, 55);
    expect(without).toBeGreaterThan(0.05);
    expect(withBunker).toBeLessThan(without * 0.3);
  });
});

describe("Bunker Buster", () => {
  test("40M fixed, destroys bunkers in radius only, no land damage", async () => {
    const g = await setup("plains", { instantBuild: true }, [
      new PlayerInfo("a", PlayerType.Human, null, "a"),
      new PlayerInfo("c", PlayerType.Human, null, "c"),
    ]);
    const a = g.player("a");
    const c = g.player("c");
    for (let x = 0; x < 30; x++)
      for (let y = 0; y < 10; y++) a.conquer(g.ref(x, y));
    for (let x = 40; x < 46; x++)
      for (let y = 40; y < 46; y++) c.conquer(g.ref(x, y));
    c.buildUnit(UnitType.MissileSilo, g.ref(42, 42), {});
    c.addGold(100_000_000n);
    c.setModLevel("bomb_bunker_buster", 1); // 벙커 부스터는 연구 필요
    executeTicks(g, 3);
    expect(g.config().unitInfo(UnitType.BunkerBuster).cost(g, c)).toBe(40_000_000n);
    const near = a.buildUnit(UnitType.Bunker, g.ref(5, 5), {});
    const far = a.buildUnit(UnitType.Bunker, g.ref(25, 5), {});
    executeTicks(g, 400);
    const tilesBefore = a.numTilesOwned();
    g.addExecution(new NukeExecution(UnitType.BunkerBuster, c, g.ref(5, 5), null));
    executeTicks(g, 600);
    expect(near.isActive()).toBe(false);
    expect(far.isActive()).toBe(true);
    expect(a.numTilesOwned()).toBe(tilesBefore);
  });
});

describe("Tank", () => {
  async function makeWar(withTank: boolean) {
    const g = await setup("plains", { instantBuild: true }, [
      new PlayerInfo("a", PlayerType.Human, null, "a"),
      new PlayerInfo("b", PlayerType.Human, null, "b"),
    ]);
    const a = g.player("a");
    const b = g.player("b");
    for (let x = 0; x < 30; x++)
      for (let y = 0; y < 10; y++) a.conquer(g.ref(x, y));
    for (let x = 30; x < 60; x++)
      for (let y = 0; y < 10; y++) b.conquer(g.ref(x, y));
    a.addGold(100_000_000n);
    executeTicks(g, 400); // 스폰 보호 시간
    let tank: Unit | undefined;
    if (withTank) {
      g.addExecution(new TankExecution(a, g.ref(2, 5)));
      executeTicks(g, 2);
      tank = a.units(UnitType.Tank)[0];
    }
    return { g, a, b, tank };
  }

  test("15M fixed, only on own land", async () => {
    const { g, a, b } = await makeWar(true);
    expect(g.config().unitInfo(UnitType.Tank).cost(g, a)).toBe(15_000_000n);
    expect(a.canBuild(UnitType.Tank, g.ref(5, 5))).not.toBe(false);
    expect(a.canBuild(UnitType.Tank, g.ref(40, 5))).toBe(false); // 적 땅
    expect(b.units(UnitType.Tank).length).toBe(0);
  });

  test("tank advances to the front during a war and helps the attack", async () => {
    const withT = await makeWar(true);
    const noT = await makeWar(false);
    const startX = withT.g.x(withT.tank!.tile());

    for (const w of [withT, noT]) {
      w.a.addTroops(500_000);
      w.g.addExecution(new AttackExecution(100_000, w.a, w.b.id()));
      executeTicks(w.g, 40);
    }
    expect(withT.g.x(withT.tank!.tile())).toBeGreaterThan(startX + 5);
    // 같은 조건에서 탱크가 있으면 더 많이 점령한다
    expect(withT.a.numTilesOwned()).toBeGreaterThan(noT.a.numTilesOwned());
  });
});

describe("Troop upgrades (M window backend)", () => {
  test("cost rises per level, last level is 37.5M, max 10, needs gold", async () => {
    const g = await setup("plains", { instantBuild: true }, [
      new PlayerInfo("a", PlayerType.Human, null, "a"),
    ]);
    const a = g.player("a");
    a.addGold(1_000_000_000n);
    const costs: bigint[] = [];
    for (let i = 0; i < 12; i++) {
      const before = a.gold();
      g.addExecution(new ModUpgradeExecution(a, "troop_atk"));
      executeTicks(g, 1);
      costs.push(before - a.gold());
    }
    expect(a.modLevel("troop_atk")).toBe(10); // 최대 10단계
    expect(costs[0]).toBe(375_000n);
    expect(costs[9]).toBe(37_500_000n); // 마지막(10단계) 가격
    expect(costs[10]).toBe(0n); // 11번째는 구매 안 됨
    for (let i = 1; i < 10; i++) expect(costs[i]).toBeGreaterThan(costs[i - 1]);

    const poor = await setup("plains", {}, [
      new PlayerInfo("p", PlayerType.Human, null, "p"),
    ]);
    const p = poor.player("p");
    poor.addExecution(new ModUpgradeExecution(p, "troop_hp"));
    executeTicks(poor, 1);
    expect(p.modLevel("troop_hp")).toBe(0);
  });

  async function war(atk: number, def: number, hpA = 0, hpB = 0) {
    const g = await setup("plains", { instantBuild: true }, [
      new PlayerInfo("a", PlayerType.Human, null, "a"),
      new PlayerInfo("b", PlayerType.Human, null, "b"),
    ]);
    const a = g.player("a");
    const b = g.player("b");
    for (let x = 0; x < 30; x++)
      for (let y = 0; y < 10; y++) a.conquer(g.ref(x, y));
    for (let x = 30; x < 60; x++)
      for (let y = 0; y < 10; y++) b.conquer(g.ref(x, y));
    executeTicks(g, 400);
    a.setModLevel("troop_atk", atk);
    a.setModLevel("troop_hp", hpA);
    b.setModLevel("troop_def", def);
    b.setModLevel("troop_hp", hpB);
    a.addTroops(500_000);
    b.addTroops(500_000);
    const bBefore = b.troops();
    g.addExecution(new AttackExecution(100_000, a, b.id()));
    executeTicks(g, 15);
    const attack = a.outgoingAttacks()[0];
    return {
      attackLeft: attack ? attack.troops() : 0,
      defenderLoss: bBefore - b.troops(),
    };
  }

  test("atk raises enemy losses, def raises attacker losses, hp lowers own losses", async () => {
    const base = await war(0, 0);
    // 공격력: 적(방어자)이 더 많이 잃는다
    expect((await war(10, 0)).defenderLoss).toBeGreaterThan(base.defenderLoss);
    // 방어력: 공격자가 더 많이 잃는다
    expect((await war(0, 10)).attackLeft).toBeLessThan(base.attackLeft);
    // 체력: 공격자 체력 업그레이드 -> 공격자 손실 감소 / 방어자 체력 -> 방어자 손실 감소
    expect((await war(0, 0, 10, 0)).attackLeft).toBeGreaterThan(base.attackLeft);
    expect((await war(0, 0, 0, 10)).defenderLoss).toBeLessThan(base.defenderLoss);
  });

  test("levels survive in the update sent to clients", async () => {
    const g = await setup("plains", {}, [
      new PlayerInfo("a", PlayerType.Human, null, "a"),
    ]);
    const a = g.player("a");
    a.toUpdate();
    a.setModLevel("troop_def", 3);
    const diff = a.toUpdate();
    expect(diff?.modLevels?.[2]).toBe(3);
  });
});

describe("Research effects", () => {
  async function nukeGame() {
    const g = await setup("plains", { instantBuild: true }, [
      new PlayerInfo("a", PlayerType.Human, null, "a"),
      new PlayerInfo("c", PlayerType.Human, null, "c"),
    ]);
    const a = g.player("a");
    const c = g.player("c");
    for (let x = 0; x < 20; x++)
      for (let y = 0; y < 20; y++) a.conquer(g.ref(x, y));
    for (let x = 40; x < 46; x++)
      for (let y = 40; y < 46; y++) c.conquer(g.ref(x, y));
    c.buildUnit(UnitType.MissileSilo, g.ref(42, 42), {});
    c.addGold(1_000_000_000n);
    executeTicks(g, 400);
    return { g, a, c };
  }

  test("weapons: strongest researched weapon sets attack multiplier", async () => {
    const { bestWeaponMultiplier } = await import(
      "@openfront/engine-api/game/ModCatalog"
    );
    expect(bestWeaponMultiplier(() => 0)).toBe(1);
    const has = new Set(["weapon_assault_rifle", "weapon_howitzer"]);
    expect(bestWeaponMultiplier((k) => (has.has(k) ? 1 : 0))).toBe(1.95);
  });

  test("weapon research changes battle losses", async () => {
    async function loss(weapon: string | null) {
      const g = await setup("plains", { instantBuild: true }, [
        new PlayerInfo("a", PlayerType.Human, null, "a"),
        new PlayerInfo("b", PlayerType.Human, null, "b"),
      ]);
      const a = g.player("a");
      const b = g.player("b");
      for (let x = 0; x < 30; x++)
        for (let y = 0; y < 10; y++) a.conquer(g.ref(x, y));
      for (let x = 30; x < 60; x++)
        for (let y = 0; y < 10; y++) b.conquer(g.ref(x, y));
      executeTicks(g, 400);
      if (weapon) a.setModLevel(weapon, 1);
      a.addTroops(500_000);
      b.addTroops(500_000);
      const before = b.troops();
      g.addExecution(new AttackExecution(100_000, a, b.id()));
      executeTicks(g, 15);
      return before - b.troops();
    }
    const none = await loss(null);
    const rifle = await loss("weapon_assault_rifle");
    const railgun = await loss("weapon_railgun");
    expect(rifle).toBeGreaterThan(none);
    expect(railgun).toBeGreaterThan(rifle);
  });

  test("airborne capacity grows with research", async () => {
    const { airCapacity } = await import("@openfront/engine-api/game/ModCatalog");
    expect(airCapacity(0)).toBeLessThan(airCapacity(3));
    async function sent(level: number) {
      const g = await setup("half_land_half_ocean", { instantBuild: true }, [
        new PlayerInfo("a", PlayerType.Human, null, "a"),
        new PlayerInfo("b", PlayerType.Human, null, "b"),
      ]);
      const a = g.player("a");
      const b = g.player("b");
      for (let x = 0; x < 3; x++)
        for (let y = 0; y < 6; y++) a.conquer(g.ref(x, y));
      for (let x = 4; x < 7; x++)
        for (let y = 0; y < 6; y++) b.conquer(g.ref(x, y));
      executeTicks(g, 5);
      a.addGold(50_000_000n);
      a.addTroops(500_000);
      a.setModLevel("air_cap", level);
      a.buildUnit(UnitType.Airfield, g.ref(1, 1), {});
      executeTicks(g, 2);
      const before = a.troops();
      g.addExecution(new AirliftExecution(a, g.ref(5, 2), 400_000));
      executeTicks(g, 1);
      return before - a.troops();
    }
    const base = await sent(0);
    const upgraded = await sent(3);
    expect(base).toBeLessThanOrEqual(15_000 + 1);
    expect(upgraded).toBeGreaterThan(base);
  });

  test("bombs: must research to equip; neutron spares buildings; tsar costs more and hits wider", async () => {
    const { g, a, c } = await nukeGame();
    const cost = (p: Player) => g.config().unitInfo(UnitType.HydrogenBomb).cost(g, p);
    const baseCost = cost(c);

    // 연구 안 한 폭탄은 장착 불가
    g.addExecution(new ModEquipExecution(c, "hbomb", 1 + 5)); // tsar
    executeTicks(g, 1);
    expect(c.modLevel("slot_hbomb")).toBe(0);
    // 다른 슬롯 변형을 끼우려 하면 무시
    c.setModLevel("bomb_neutron", 1);
    g.addExecution(new ModEquipExecution(c, "hbomb", 1 + 3)); // neutron은 abomb 슬롯
    executeTicks(g, 1);
    expect(c.modLevel("slot_hbomb")).toBe(0);

    // 차르봄바 연구 + 장착 -> 가격 x3
    c.setModLevel("bomb_tsar", 1);
    g.addExecution(new ModEquipExecution(c, "hbomb", 1 + 5));
    executeTicks(g, 1);
    expect(c.modLevel("slot_hbomb")).toBe(6);
    expect(cost(c)).toBe(baseCost * 3n);

    // 중성자탄: 병력은 죽이지만 건물은 남긴다
    c.setModLevel("slot_hbomb", 0);
    g.addExecution(new ModEquipExecution(c, "abomb", 1 + 3)); // neutron
    executeTicks(g, 1);
    expect(c.modLevel("slot_abomb")).toBe(4);
    const city = a.buildUnit(UnitType.City, g.ref(5, 5), {});
    c.buildUnit(UnitType.MissileSilo, g.ref(43, 43), {});
    executeTicks(g, 2);
    g.addExecution(new NukeExecution(UnitType.AtomBomb, c, g.ref(5, 5), null));
    executeTicks(g, 600);
    expect(city.isActive()).toBe(true); // 중성자탄은 건물을 부수지 않음

    // 기본 폭탄으로 되돌리면 건물이 부서진다
    g.addExecution(new ModEquipExecution(c, "abomb", 0));
    executeTicks(g, 1);
    c.buildUnit(UnitType.MissileSilo, g.ref(44, 44), {});
    executeTicks(g, 2);
    g.addExecution(new NukeExecution(UnitType.AtomBomb, c, g.ref(5, 5), null));
    executeTicks(g, 600);
    expect(city.isActive()).toBe(false);
  });

  test("bunker buster requires research", async () => {
    const { g, c } = await nukeGame();
    expect(c.canBuild(UnitType.BunkerBuster, g.ref(5, 5))).toBe(false);
    c.setModLevel("bomb_bunker_buster", 1);
    expect(c.canBuild(UnitType.BunkerBuster, g.ref(5, 5))).not.toBe(false);
  });
});

describe("Civil airport & upgrades", () => {
  async function two() {
    const g = await setup("plains", { instantBuild: true }, [
      new PlayerInfo("a", PlayerType.Human, null, "a"),
      new PlayerInfo("b", PlayerType.Human, null, "b"),
    ]);
    const a = g.player("a");
    const b = g.player("b");
    for (let x = 0; x < 20; x++)
      for (let y = 0; y < 20; y++) a.conquer(g.ref(x, y));
    for (let x = 40; x < 60; x++)
      for (let y = 0; y < 20; y++) b.conquer(g.ref(x, y));
    executeTicks(g, 5);
    return { g, a, b };
  }

  test("5M fixed; earns every 10s; partners and level raise income", async () => {
    const { g, a, b } = await two();
    expect(g.config().unitInfo(UnitType.CivilAirport).cost(g, a)).toBe(5_000_000n);
    a.addGold(100_000_000n);
    const port = a.buildUnit(UnitType.CivilAirport, g.ref(5, 5), {});
    const ex = new CivilAirportExecution(port);
    g.addExecution(ex);
    executeTicks(g, 2);
    expect(ex.income()).toBe(100_000n);
    const before = a.gold();
    executeTicks(g, 100);
    expect(a.gold() - before).toBe(100_000n);

    // 상대 나라 공항이 생기면 수입이 늘어난다
    const bPort = b.buildUnit(UnitType.CivilAirport, g.ref(45, 5), {});
    g.addExecution(new CivilAirportExecution(bPort));
    executeTicks(g, 2);
    expect(ex.income()).toBe(140_000n);

    // 업그레이드(레벨 2)하면 두 배
    expect(a.canUpgradeUnit(port)).toBe(true);
    a.upgradeUnit(port);
    expect(port.level()).toBe(2);
    expect(ex.income()).toBe(280_000n);
  });

  test("skyport upgrade holds more fighters; AA turret upgrade reaches farther", async () => {
    const { g, a } = await two();
    const af = a.buildUnit(UnitType.Airfield, g.ref(5, 5), {});
    const ex = new AirfieldExecution(af);
    g.addExecution(ex);
    a.addGold(1_000_000_000n);
    a.upgradeUnit(af);
    expect(af.level()).toBe(2);
    executeTicks(g, 2000);
    expect(ex.fighterCount()).toBe(4); // 레벨 2 = 4대 보관

    const { aaTurretRange, aaTurretCooldown } = await import(
      "@openfront/engine/execution/AATurretExecution"
    );
    expect(aaTurretRange(2)).toBeGreaterThan(aaTurretRange(1));
    expect(aaTurretCooldown(2)).toBeLessThan(aaTurretCooldown(1));
    const tur = a.buildUnit(UnitType.AATurret, g.ref(8, 8), {});
    expect(a.canUpgradeUnit(tur)).toBe(true);
  });
});

describe("Nation AI uses mod features", () => {
  test("AI buys upgrades, researches weapons/bombs, equips slots, builds new structures", async () => {
    const g = await setup("plains", { instantBuild: true }, [
      new PlayerInfo("n", PlayerType.Nation, null, "n"),
    ]);
    const n = g.player("n");
    for (let x = 0; x < 40; x++)
      for (let y = 0; y < 40; y++) n.conquer(g.ref(x, y));
    n.buildUnit(UnitType.City, g.ref(20, 20), {});
    executeTicks(g, 5);
    const ai = new NationModBehavior(g, n);
    for (let i = 0; i < 400; i++) {
      n.addGold(5_000_000n);
      ai.think();
      executeTicks(g, 3);
    }
    const levels = ["troop_atk", "troop_hp", "troop_def"].map((k) => n.modLevel(k));
    expect(levels.every((l) => l > 0)).toBe(true);
    expect(n.modLevel("weapon_railgun")).toBe(1);
    expect(n.modLevel("tank_tech")).toBeGreaterThan(0);
    // 폭탄 연구와 슬롯 장착
    expect(n.modLevel("slot_abomb")).toBeGreaterThan(0);
    expect(n.modLevel("slot_hbomb")).toBeGreaterThan(0);
    // 새 건물
    expect(n.units(UnitType.CivilAirport).length).toBeGreaterThan(0);
    expect(n.units(UnitType.Bunker).length).toBe(1);
    expect(n.units(UnitType.Airfield).length).toBe(1);
    expect(n.units(UnitType.AATurret).length).toBe(1);
  });
});
