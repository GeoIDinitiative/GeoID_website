/**
 * The body, and what 8,848 metres does to it.
 *
 * The centre of this is one number: the partial pressure of oxygen in the air
 * you are breathing. At sea level it is about 19.9 kPa; on the summit of
 * Everest it is 5.7. That single fact is why the mountain is hard, why
 * expeditions take two months, why there is a "death zone" at all, and why
 * bottled oxygen changes everything — so it is computed properly here, from
 * the barometric formula, rather than being a bar that goes down with height.
 *
 * Everything downstream of it — speed, judgement, the vignette closing in —
 * is a game's approximation. The pressure is not.
 */

import { PHYS, MOVE } from "./config.js?v=d1bc06b-911a7123";

/**
 * Atmospheric pressure in kPa.
 *
 * The ISA formula under-reads Everest: it gives 31.4 kPa where the summit
 * measures about 33.7. The gap is real physics rather than error — the
 * tropopause is higher over the subtropics, so there is more air stacked
 * above 8,848 m at 28°N than the standard atmosphere assumes. West's
 * measurements are what the correction is fitted to, because 2 kPa at that
 * end of the curve is the difference between able to stand and not.
 */
export function pressureKPa(altitude) {
  const isa = PHYS.seaLevelKPa * Math.pow(1 - 2.25577e-5 * altitude, 5.25588);
  const tropicalGain = 1 + 0.075 * Math.max(0, (altitude - 4000) / 4848);
  return isa * tropicalGain;
}

/** Inspired oxygen partial pressure, kPa. 6.27 kPa is saturated water vapour
 *  at body temperature, which the lung adds no matter how dry the air is —
 *  and at these pressures it is more than a tenth of everything available. */
export function inspiredO2(altitude, fiO2 = 0.2095) {
  return fiO2 * (pressureKPa(altitude) - 6.27);
}

/** Fraction of oxygen in the air actually being breathed, given a regulator
 *  flow in litres per minute. A mask at 4 L/min roughly doubles it. */
export function fiO2ForFlow(flow) { return 0.2095 + flow * 0.0550; }

/**
 * Arterial saturation, %. A logistic fit anchored at three places anybody can
 * check: ~98% at sea level, ~88% acclimatised at Base Camp, and ~64% on the
 * summit breathing air. Acclimatisation is worth up to fourteen points, which
 * is about what four weeks of rotations buys.
 */
export function spo2(altitude, fiO2, acclimatisation) {
  const p = inspiredO2(altitude, fiO2);
  const base = 100 / (1 + Math.exp(-(p - 4.2) / 2.6));
  return Math.max(20, Math.min(100, base - (1 - acclimatisation) * 14));
}

export const ITEMS = {
  o2:      { name: "Oxygen cylinder", short: "O₂", stack: 4, weight: 3.9,
             desc: "Four litres at 250 bar — about 720 litres of gas. At three litres a minute that is four hours. The empty one weighs nearly as much as the full one and you carry it down." },
  flare:   { name: "Signal flare", short: "Flare", stack: 3, weight: 0.3,
             desc: "Red parachute flare, visible for twenty kilometres in clear air and about four hundred metres in a whiteout. Fires it and someone comes — eventually, and only if they can fly." },
  food:    { name: "Rations", short: "Food", stack: 8, weight: 0.4,
             desc: "High-fat, high-sugar, and above 7,000 m almost impossible to swallow. Eat anyway. Appetite disappears long before the need does." },
  brew:    { name: "Thermos", short: "Brew", stack: 4, weight: 0.9,
             desc: "Warm sweet tea. Altitude dehydrates you through breathing alone — four litres a day, and dehydration is half of what people call altitude sickness." },
  rope:    { name: "Rope", short: "Rope", stack: 1, weight: 3.2,
             desc: "Fifty metres of 8.5 mm. On a glacier it is what turns a crevasse fall into an inconvenience, and it only works if you are tied into it before you fall." },
  screw:   { name: "Ice screws", short: "Screws", stack: 6, weight: 0.14,
             desc: "For an anchor: a belay, a rappel, or holding a partner who has gone through a snow bridge." },
  ladder:  { name: "Ladder section", short: "Ladder", stack: 2, weight: 6.5,
             desc: "Aluminium, lashed end to end and laid across a crevasse. Everything above Base Camp crosses these, and you cross them in crampons, which is exactly as awkward as it sounds." },
  dex:     { name: "Dexamethasone", short: "Dex", stack: 2, weight: 0.05,
             desc: "It does not cure altitude sickness. It buys a few hours of being able to walk, which if you use them to go downhill is the whole point." },
  nifed:   { name: "Nifedipine", short: "Nifed", stack: 2, weight: 0.05,
             desc: "Drops pulmonary artery pressure. For the drowning kind of altitude sickness — the one where you can hear the fluid." },
  goggles: { name: "Goggles", short: "Goggles", stack: 1, weight: 0.2,
             desc: "Snow blindness is sunburn on the cornea. You do not feel it happening and you cannot see the next morning." },
  stove:   { name: "Stove & fuel", short: "Stove", stack: 1, weight: 1.6,
             desc: "There is no water above Base Camp that is not snow, and melting it takes an hour a litre." },
};

export class Survival {
  constructor() {
    this.energy = 100;
    this.warmth = 100;
    this.health = 100;
    this.acclimatisation = 0.62;     // arrived after the usual rotations
    this.highestSlept = 5364;
    this.o2Flow = 0;
    this.bottleLitres = 0;
    this.frostbite = 0;              // 0..100, does not heal
    this.snowBlind = 0;
    this.deathZoneSeconds = 0;
    this.wearingGoggles = true;
    this.roped = false;
    this.dexUntil = -1;
    this.dead = false;
    this.causeOfDeath = null;

    /** Standing, not honour. What the mountain thinks of you: it goes up for
     *  turning round when you should, for carrying someone's load, for
     *  stopping. It goes down for walking past. */
    this.standing = 0;

    this.inventory = {
      o2: 2, flare: 2, food: 5, brew: 2, rope: 1, screw: 4,
      ladder: 1, dex: 1, nifed: 1, goggles: 1, stove: 1,
    };
    this.log = [];
  }

  get fiO2() { return this.o2Flow > 0 && this.bottleLitres > 0 ? fiO2ForFlow(this.o2Flow) : 0.2095; }
  get carriedWeight() {
    let w = 8.5;   // clothing, boots, harness, axe — worn, not carried, but it still costs
    for (const [k, n] of Object.entries(this.inventory)) w += (ITEMS[k]?.weight || 0) * n;
    return w;
  }

  spo2At(altitude) { return spo2(altitude, this.fiO2, this.acclimatisation); }

  /**
   * @param dt   SIMULATED seconds. Everything below is written as a rate per
   *             simulated hour and converted once, here, so that changing how
   *             fast the clock runs changes when things happen and not how
   *             much of them happens.
   * @param ctx  {altitude, speed, slopeDeg, tempC, windMs, weather, resting, sheltered, sunUp}
   */
  update(dt, ctx) {
    if (this.dead) return;
    const h = dt / 3600;
    const alt = ctx.altitude;
    const sat = this.spo2At(alt);
    this.spo2 = sat;

    /* ── Oxygen supply ── */
    if (this.o2Flow > 0 && this.bottleLitres > 0) {
      this.bottleLitres = Math.max(0, this.bottleLitres - this.o2Flow * dt / 60);
      if (this.bottleLitres === 0) this.note("The regulator hisses and stops. That bottle is done.");
    }

    /* ── Energy ──
       Burn scales with what you are doing, then with how little oxygen there
       is to do it on, then with the cold, then with the load. Above 8,000 m
       simply standing up is most of a day's work at sea level. */
    /* Burn follows the legs. The old expression paid the full walking rate
       the moment speed crossed the resting threshold and the same rate at a
       stroll or a run, so moving did not FEEL like it cost anything — the
       reading barely differed from standing still. Now the walking burn
       scales with actual pace (a run burns over half again as much) and the
       climbing surcharge rides on top of it, so distance covered is energy
       spent, visibly. */
    const pace = Math.min(1.6, ctx.speed / MOVE.walk);
    const effort = ctx.resting ? PHYS.burnRest
      : Math.max(PHYS.burnRest,
          PHYS.burnWalk * pace
          + (PHYS.burnClimb - PHYS.burnWalk) * Math.min(1, Math.max(0, ctx.slopeDeg - 12) / 38) * Math.min(1, pace + 0.2));
    const hypoxic = 1 + Math.max(0, (88 - sat) / 88) * 2.6;
    const cold = 1 + Math.max(0, (-10 - ctx.tempC) / 45) * 0.5;
    const load = 0.75 + this.carriedWeight / 40;
    this.energy = Math.max(0, this.energy - effort * hypoxic * cold * load * h);

    /* ── Warmth ──
       Wind chill against generated heat. Working keeps you warm right up
       until you stop, which is why people die sitting down. */
    const chill = ctx.weather.windChill(ctx.tempC, ctx.windMs);
    const exposure = Math.min(1.4, Math.max(0, (-12 - chill) / 55));
    const generated = ctx.resting ? PHYS.warmthFromRest
      : PHYS.warmthFromWork * Math.min(1, ctx.speed / MOVE.walk + 0.3);
    const shelter = ctx.sheltered ? 0.15 : 1;
    const dWarmth = (generated * (this.energy > 12 ? 1 : 0.35)
                     - exposure * PHYS.warmthLossFull * shelter) * h;
    this.warmth = Math.max(0, Math.min(100, this.warmth + dWarmth));

    /* ── Frostbite ──
       Does not heal. Fingers and toes go first, and the reason it matters in
       a game about a mountain is that it is the most common way of coming
       home changed. */
    if (this.warmth < 26 && chill < -28) {
      this.frostbite = Math.min(100, this.frostbite + (26 - this.warmth) * 0.55 * h);
    }

    /* ── Snow blindness ──
       Only in daylight, only above the snowline, only without goggles — and
       it arrives about eight hours after the exposure that caused it. */
    if (!this.wearingGoggles && ctx.sunUp && ctx.weather.cloud < 0.5) {
      this.snowBlind = Math.min(100, this.snowBlind + h * 22);
    } else {
      this.snowBlind = Math.max(0, this.snowBlind - h * 5);
    }

    /* ── The death zone ──
       Above 8,000 m nothing acclimatises: you are running down a clock, and
       the clock does not stop for resting. */
    if (alt > 8000) {
      this.deathZoneSeconds += dt * (this.o2Flow > 0 && this.bottleLitres > 0 ? 0.45 : 1);
      this.acclimatisation = Math.max(0.15, this.acclimatisation - h * 0.030);
    } else if (alt < this.highestSlept + 400) {
      // Climb high, sleep low: acclimatisation is built below where you have been.
      this.acclimatisation = Math.min(1, this.acclimatisation + h * 0.012);
    }

    /* ── Health ──
       Health is not hit points. It is what the other four do to you when you
       let them run out. */
    let harm = 0;                                    // percentage points per hour
    if (this.energy <= 0) harm += 14;
    if (this.warmth <= 0) harm += 34;
    if (sat < PHYS.spo2Critical) harm += (PHYS.spo2Critical - sat) * 2.4;
    else if (sat < PHYS.spo2Impaired && !this.onDex()) harm += 1.6;
    if (this.deathZoneSeconds > PHYS.deathZoneHours * 3600) harm += 12;
    if (harm > 0) this.health = Math.max(0, this.health - harm * h);
    else if (ctx.sheltered && ctx.resting) this.health = Math.min(100, this.health + h * 9);

    if (this.health <= 0 && !this.dead) {
      this.dead = true;
      this.causeOfDeath = this.warmth <= 0 ? "hypothermia"
        : sat < PHYS.spo2Critical ? "hypoxia"
        : this.energy <= 0 ? "exhaustion" : "altitude sickness";
    }
  }

  onDex() { return this.dexUntil > 0 && performance.now() < this.dexUntil; }

  /** How much of your normal pace you have. Everything that is wrong with
   *  you shows up here, which is the honest place for it to show up. */
  capability(altitude) {
    const sat = this.spo2At(altitude);
    const o2 = Math.min(1, Math.max(0.18, (sat - 45) / 45));
    const en = Math.min(1, Math.max(0.22, this.energy / 45));
    const wa = Math.min(1, Math.max(0.35, this.warmth / 50));
    const hp = Math.min(1, Math.max(0.30, this.health / 60));
    const fb = 1 - this.frostbite / 260;
    /* Floor the PRODUCT. Every factor has its own floor, but four floors
       multiplied is 0.004 — at the summit that is 1 cm per second, which a
       player experiences as the controls being dead. 0.20 keeps the summit
       brutally slow (a fifth of walking pace before Tobler and the slope
       taxes) while never taking the sticks away. */
    return Math.max(0.20, o2 * en * wa * hp * fb) * (this.onDex() ? 1.15 : 1);
  }

  /** 0 (fine) .. 1 (about to sit down and not get up). Drives the vignette,
   *  the breathing, and how much the horizon swims. */
  distress(altitude) {
    const sat = this.spo2At(altitude);
    return Math.min(1, Math.max(
      (PHYS.spo2Impaired - sat) / 25,
      (30 - this.energy) / 30,
      (30 - this.warmth) / 30,
      (40 - this.health) / 40,
      0,
    ));
  }

  use(item) {
    if (!this.inventory[item]) return null;
    switch (item) {
      case "food":
        this.inventory.food--;
        this.energy = Math.min(100, this.energy + 26);
        return "Forced it down. It helps more than it feels like it does.";
      case "brew":
        this.inventory.brew--;
        this.energy = Math.min(100, this.energy + 10);
        this.warmth = Math.min(100, this.warmth + 22);
        return "Warm, sweet, and the best thing that has happened all day.";
      case "o2":
        this.inventory.o2--;
        this.bottleLitres = PHYS.bottleLitres;
        if (this.o2Flow === 0) this.o2Flow = 2;
        return "New bottle on. The mask fogs, then clears, and the world comes back a little.";
      case "dex":
        this.inventory.dex--;
        this.dexUntil = performance.now() + 40 * 60 * 1000;
        return "Dexamethasone. You have perhaps two hours of feeling capable. Spend them going down.";
      case "nifed":
        this.inventory.nifed--;
        this.health = Math.min(100, this.health + 18);
        return "Nifedipine. The crackling in your chest eases.";
      case "goggles":
        this.wearingGoggles = !this.wearingGoggles;
        return this.wearingGoggles ? "Goggles down." : "Goggles up — you can see the ground properly, and the sun is on the snow.";
      case "stove":
        this.warmth = Math.min(100, this.warmth + 12);
        return "An hour of melting snow for a litre of water.";
      default:
        return null;
    }
  }

  setFlow(flow) {
    this.o2Flow = flow;
    if (flow > 0 && this.bottleLitres <= 0) {
      if (this.inventory.o2 > 0) return this.use("o2");
      this.o2Flow = 0;
      return "No bottle on the regulator.";
    }
    return flow === 0 ? "Off the gas." : `Regulator at ${flow} litres a minute.`;
  }

  note(text) {
    this.log.push({ t: Date.now(), text });
    if (this.log.length > 60) this.log.shift();
  }

  /** Reaching a camp: rest, eat, get warm, and sleep the altitude in. */
  restAtCamp(altitude, hours) {
    this.energy = Math.min(100, this.energy + hours * 11);
    this.warmth = Math.min(100, this.warmth + hours * 16);
    this.health = Math.min(100, this.health + hours * 2.2);
    if (altitude < 8000) {
      this.highestSlept = Math.max(this.highestSlept, altitude);
      this.acclimatisation = Math.min(1, this.acclimatisation + hours * 0.0075);
      this.deathZoneSeconds = Math.max(0, this.deathZoneSeconds - hours * 3600 * 0.5);
    }
  }
}
