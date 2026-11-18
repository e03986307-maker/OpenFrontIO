import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { zInt, zRef } from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Unit } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";

/** 무역 주기: 10초 (1초 = 10틱) */
export const AIRPORT_TRADE_TICKS = 100;
/** 공항 레벨 1당 기본 무역 수입 (10초마다) */
export const AIRPORT_BASE_INCOME = 100_000n;
/** 다른 나라의 민간 공항(교역 상대) 하나당 추가 수입 (상대 공항 레벨 기준) */
export const AIRPORT_PARTNER_INCOME = 40_000n;
/** 교역 상대로 세는 최대 공항 수 */
export const AIRPORT_MAX_PARTNERS = 5;

/**
 * 민간 공항: 비행기로 무역해서 10초마다 돈을 번다.
 * 수입 = 레벨 × (기본 100K + 상대 나라 공항 하나당 40K, 최대 5개).
 * 업그레이드하면 레벨만큼 수입이 늘어난다. 전쟁 중인 나라의 공항은 상대로 치지 않는다.
 */
export class CivilAirportExecution implements Execution {
  private active = true;
  private mg: Game;
  private tradeTimer = 0;

  constructor(private airport: Unit) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  /** 다음 무역에서 들어올 수입 */
  income(): bigint {
    const owner = this.airport.owner();
    let partners = 0;
    for (const other of this.mg.players()) {
      if (other === owner || !other.isAlive()) continue;
      if (owner.hasEmbargoAgainst(other) || other.hasEmbargoAgainst(owner)) {
        continue;
      }
      const hasAirport = other
        .units(UnitType.CivilAirport)
        .some((u) => u.isActive() && !u.isUnderConstruction());
      if (hasAirport) partners++;
    }
    partners = Math.min(partners, AIRPORT_MAX_PARTNERS);
    return (
      BigInt(this.airport.level()) *
      (AIRPORT_BASE_INCOME + BigInt(partners) * AIRPORT_PARTNER_INCOME)
    );
  }

  tick(ticks: number): void {
    if (!this.airport.isActive()) {
      this.active = false;
      return;
    }
    if (this.airport.isUnderConstruction()) return;
    this.tradeTimer++;
    if (this.tradeTimer < AIRPORT_TRADE_TICKS) return;
    this.tradeTimer = 0;
    this.airport.owner().addGold(this.income(), this.airport.tile());
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return CivilAirportExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== undefined,
      airport: w.unit(this.airport),
      tradeTimer: this.tradeTimer,
    });
  }

  restoreSnapshot(s: CivilAirportState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.mg = r.game;
    this.airport = r.unit(s.airport);
    this.tradeTimer = s.tradeTimer;
  }
}

const CivilAirportStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  airport: zRef(),
  tradeTimer: zInt(),
});
type CivilAirportState = z.infer<typeof CivilAirportStateSchema>;

export const CivilAirportExecutionSnapshot = execSnapshotType({
  name: "CivilAirport",
  version: 1,
  schema: CivilAirportStateSchema,
  cls: () => CivilAirportExecution,
});
