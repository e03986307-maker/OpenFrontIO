import { BIO_ZONE_TICKS } from "@openfront/engine-api/game/ModCatalog";
import { zInt, zRef } from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Unit } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";

/**
 * 생화학 오염 지대: 생화학탄이 터진 자리에 5분 동안 남는다.
 * 유닛의 troops 값이 오염 반경(타일)이다. 이 안의 땅을 점령할 때는
 * 공격자의 병력 손실이 크게 늘고 점령 속도가 느려진다 (AttackExecution 참고).
 */
export class BioZoneExecution implements Execution {
  private active = true;
  private age = 0;

  constructor(private zone: Unit) {}

  init(mg: Game, ticks: number): void {}

  tick(ticks: number): void {
    if (!this.zone.isActive()) {
      this.active = false;
      return;
    }
    this.age++;
    if (this.age >= BIO_ZONE_TICKS) {
      this.zone.delete(false);
      this.active = false;
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return BioZoneExecutionSnapshot.write({
      active: this.active,
      zone: w.unit(this.zone),
      age: this.age,
    });
  }

  restoreSnapshot(s: BioZoneState, r: SnapshotReader): void {
    this.active = s.active;
    this.zone = r.unit(s.zone);
    this.age = s.age;
  }
}

const BioZoneStateSchema = z.object({
  active: z.boolean(),
  zone: zRef(),
  age: zInt(),
});
type BioZoneState = z.infer<typeof BioZoneStateSchema>;

export const BioZoneExecutionSnapshot = execSnapshotType({
  name: "BioZone",
  version: 1,
  schema: BioZoneStateSchema,
  cls: () => BioZoneExecution,
});
