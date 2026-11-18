import {
  airCapacity,
  BOMB_SLOTS,
  BOMB_VARIANTS,
  BombSlot,
  BUNKER_BUSTER_RESEARCH,
  bestWeaponMultiplier,
  MOD_ITEMS,
  ModGroup,
  ModItem,
  slotKey,
  tankLossFactor,
  troopUpgradeMultiplier,
  WEAPONS,
} from "@openfront/engine-api/game/ModCatalog";
import { EventBus } from "@openfront/shared/EventBus";
import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { Controller } from "../../Controller";
import { ToggleModPanelEvent } from "../../InputHandler";
import {
  SendModEquipIntentEvent,
  SendModUpgradeIntentEvent,
} from "../../Transport";
import { translateText } from "../../Utils";
import { GameView } from "../../view";

/** 골드를 M/K 단위로 줄여 쓴다 (예: 37500000 -> 37.5M) */
export function formatM(gold: bigint): string {
  const n = Number(gold);
  if (n >= 1_000_000) {
    return `${Number((n / 1_000_000).toFixed(3))}M`;
  }
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return `${n}`;
}

type Tab = Exclude<ModGroup, "slot">;
const TABS: Tab[] = ["troop", "weapon", "supply", "bomb"];

/**
 * M 키로 여는 업그레이드/연구 창.
 * 탭: 병사 강화 / 무기 / 군수(탱크·수송기) / 폭탄(슬롯 장착)
 */
@customElement("mod-panel")
export class ModPanel extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;

  @state() private visible = false;
  @state() private tab: Tab = "troop";

  createRenderRoot() {
    return this;
  }

  init() {
    this.eventBus.on(ToggleModPanelEvent, () => {
      this.visible = !this.visible;
    });
  }

  getTickIntervalMs() {
    return 250;
  }

  tick() {
    if (this.visible) this.requestUpdate();
  }

  private buy(key: string) {
    this.eventBus.emit(new SendModUpgradeIntentEvent(key));
  }

  private equip(slot: BombSlot, variant: number) {
    this.eventBus.emit(new SendModEquipIntentEvent(slot, variant));
  }

  private level(key: string): number {
    return this.game?.myPlayer()?.modLevel(key) ?? 0;
  }

  private gold(): bigint {
    return this.game?.myPlayer()?.gold() ?? 0n;
  }

  private buyButton(item: ModItem) {
    const level = this.level(item.key);
    const maxed = level >= item.maxLevel;
    const cost = maxed ? 0n : item.costOfNext(level);
    const canAfford = !maxed && this.gold() >= cost;
    const label = maxed
      ? translateText(
          item.maxLevel === 1 ? "mod_panel.owned" : "mod_panel.maxed",
        )
      : `${translateText(item.group === "troop" ? "mod_panel.upgrade" : "mod_panel.research")} · ${formatM(cost)}`;
    return html`<button
      class="py-1 px-2 rounded-sm text-white text-sm border transition ${
        canAfford
          ? "border-gray-200 hover:bg-gray-500"
          : "border-gray-600 opacity-50"
      }"
      ?disabled=${!canAfford}
      @click=${() => this.buy(item.key)}
    >
      ${label}
    </button>`;
  }

  private card(title: string, right: string, body: unknown, action: unknown) {
    return html`<div class="p-3 rounded-lg bg-gray-700/70 flex flex-col gap-2">
      <div class="flex justify-between items-center text-white">
        <span class="font-bold">${title}</span>
        <span class="text-sm text-gray-300">${right}</span>
      </div>
      ${body} ${action}
    </div>`;
  }

  private pips(level: number, max: number) {
    return html`<div class="flex gap-1">
      ${Array.from({ length: max }, (_, i) => i < level).map(
        (on) =>
          html`<div
            class="h-2 flex-1 rounded-sm ${
              on ? "bg-malibu-blue" : "bg-gray-500"
            }"
          ></div>`,
      )}
    </div>`;
  }

  private desc(key: string) {
    return html`<div class="text-xs text-gray-300">
      ${translateText(`mod_panel.item.${key}.desc`)}
    </div>`;
  }

  /** 우리 병사 전투력 요약 */
  private strength() {
    const pct = (m: number) => `×${m.toFixed(2)}`;
    const atk =
      troopUpgradeMultiplier(this.level("troop_atk")) *
      bestWeaponMultiplier((k) => this.level(k));
    const hp = troopUpgradeMultiplier(this.level("troop_hp"));
    const def = troopUpgradeMultiplier(this.level("troop_def"));
    return html`<div
      class="grid grid-cols-3 gap-2 text-center text-white text-sm p-2 rounded-lg bg-gray-900/60"
    >
      <div>
        <div class="text-xs text-gray-400">
          ${translateText("mod_panel.stat_atk")}
        </div>
        ${pct(atk)}
      </div>
      <div>
        <div class="text-xs text-gray-400">
          ${translateText("mod_panel.stat_hp")}
        </div>
        ${pct(hp)}
      </div>
      <div>
        <div class="text-xs text-gray-400">
          ${translateText("mod_panel.stat_def")}
        </div>
        ${pct(def)}
      </div>
    </div>`;
  }

  private renderTroop() {
    return html`${this.strength()}
    ${MOD_ITEMS.filter((i) => i.group === "troop").map((item) => {
      const lv = this.level(item.key);
      return this.card(
        translateText(`mod_panel.item.${item.key}.name`),
        `Lv ${lv}/${item.maxLevel} · +${Math.round((troopUpgradeMultiplier(lv) - 1) * 100)}%`,
        html`${this.desc(item.key)}${this.pips(lv, item.maxLevel)}`,
        this.buyButton(item),
      );
    })}`;
  }

  private renderWeapons() {
    return html`${this.strength()}
    ${WEAPONS.map((w) => {
      const item = MOD_ITEMS.find((i) => i.key === w.key)!;
      return this.card(
        translateText(`mod_panel.item.${w.key}.name`),
        `${translateText("mod_panel.stat_atk")} ×${w.attackMultiplier.toFixed(2)}`,
        this.desc(w.key),
        this.buyButton(item),
      );
    })}`;
  }

  private renderSupply() {
    const tank = this.level("tank_tech");
    const air = this.level("air_cap");
    const tankItem = MOD_ITEMS.find((i) => i.key === "tank_tech")!;
    const airItem = MOD_ITEMS.find((i) => i.key === "air_cap")!;
    return html`${this.card(
      translateText("mod_panel.item.tank_tech.name"),
      `Lv ${tank}/${tankItem.maxLevel} · ${Math.round((1 - tankLossFactor(tank)) * 100)}%`,
      html`${this.desc("tank_tech")}${this.pips(tank, tankItem.maxLevel)}`,
      this.buyButton(tankItem),
    )}
    ${this.card(
      translateText("mod_panel.item.air_cap.name"),
      `Lv ${air}/${airItem.maxLevel} · ${airCapacity(air).toLocaleString()}`,
      html`${this.desc("air_cap")}${this.pips(air, airItem.maxLevel)}`,
      this.buyButton(airItem),
    )}`;
  }

  private renderBombs() {
    const buster = MOD_ITEMS.find((i) => i.key === BUNKER_BUSTER_RESEARCH.key)!;
    return html`<div class="text-xs text-gray-300">
        ${translateText("mod_panel.bomb_hint")}
      </div>
      ${BOMB_SLOTS.map((slot) => {
        const equippedN = this.level(slotKey(slot));
        return html`<div class="text-white font-bold mt-1">
            ${translateText(`mod_panel.slot.${slot}`)}
          </div>
          ${this.card(
            translateText("mod_panel.bomb_default"),
            equippedN === 0 ? translateText("mod_panel.equipped") : "",
            html``,
            equippedN === 0
              ? html``
              : html`<button
                  class="py-1 px-2 rounded-sm text-white text-sm border border-gray-200 hover:bg-gray-500"
                  @click=${() => this.equip(slot, 0)}
                >
                  ${translateText("mod_panel.equip")}
                </button>`,
          )}
          ${BOMB_VARIANTS.map((v, idx) => ({ v, idx }))
            .filter(({ v }) => v.slot === slot)
            .map(({ v, idx }) => {
              const item = MOD_ITEMS.find((i) => i.key === v.key)!;
              const owned = this.level(v.key) > 0;
              const on = equippedN === idx + 1;
              const stats = `${translateText("mod_panel.radius")} ×${v.outerMul} · ${translateText("mod_panel.troop_dmg")} ×${v.troopMul} · ${translateText("mod_panel.price")} ×${v.priceMul}${v.destroysStructures ? "" : ` · ${translateText("mod_panel.spares_buildings")}`}`;
              return this.card(
                translateText(`mod_panel.item.${v.key}.name`),
                on ? translateText("mod_panel.equipped") : "",
                html`${this.desc(v.key)}
                  <div class="text-xs text-yellow-200">${stats}</div>`,
                !owned
                  ? this.buyButton(item)
                  : on
                    ? html``
                    : html`<button
                        class="py-1 px-2 rounded-sm text-white text-sm border border-gray-200 hover:bg-gray-500"
                        @click=${() => this.equip(slot, idx + 1)}
                      >
                        ${translateText("mod_panel.equip")}
                      </button>`,
              );
            })}`;
      })}
      <div class="text-white font-bold mt-1">
        ${translateText("mod_panel.slot.special")}
      </div>
      ${this.card(
        translateText(`mod_panel.item.${buster.key}.name`),
        "40M",
        this.desc(buster.key),
        this.buyButton(buster),
      )}`;
  }

  render() {
    if (!this.visible || !this.game?.myPlayer()) return html``;
    const body =
      this.tab === "troop"
        ? this.renderTroop()
        : this.tab === "weapon"
          ? this.renderWeapons()
          : this.tab === "supply"
            ? this.renderSupply()
            : this.renderBombs();
    return html`
      <div
        class="fixed inset-0 z-1100 flex items-center justify-center pointer-events-none"
        @contextmenu=${(e: Event) => e.preventDefault()}
      >
        <div
          class="pointer-events-auto w-[min(94vw,28rem)] max-h-[82vh] overflow-y-auto p-3 rounded-lg bg-gray-800/95 backdrop-blur-sm shadow-lg flex flex-col gap-3"
        >
          <div class="flex justify-between items-center text-white">
            <span class="text-lg font-bold"
              >${translateText("mod_panel.title")}</span
            >
            <span class="text-sm text-yellow-300">${formatM(this.gold())}</span>
            <button
              class="px-2 text-xl"
              @click=${() => (this.visible = false)}
              aria-label="close"
            >
              ×
            </button>
          </div>
          <div class="flex gap-1">
            ${TABS.map(
              (g) =>
                html`<button
                  class="flex-1 py-1 text-xs text-white rounded-sm border ${
                    this.tab === g
                      ? "bg-malibu-blue border-malibu-blue"
                      : "border-gray-500"
                  }"
                  @click=${() => (this.tab = g)}
                >
                  ${translateText(`mod_panel.tab_${g}`)}
                </button>`,
            )}
          </div>
          ${body}
        </div>
      </div>
    `;
  }
}
