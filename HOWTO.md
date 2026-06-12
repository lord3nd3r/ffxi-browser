# How To Play — Vana'diel Reverie

**Live demo: [ffxi-browser.vercel.app](https://ffxi-browser.vercel.app)**

A single-player, FFXI-flavored RPG that runs entirely in your browser. You control one
adventurer with two AI companions, explore West Sarutaria Plains, fight monsters, run
quests, and gear up at the town vendors. Progress saves automatically to your browser's
localStorage.

---

## 1. Getting started

1. Open [ffxi-browser.vercel.app](https://ffxi-browser.vercel.app) in Chrome, Firefox,
   Edge, or Safari (needs WebGL2).
2. Pick a job for your character — your two party members are filled in automatically
   with complementary jobs.
3. You start at the home point in town. Walk out the gate to reach the plains.

---

## 2. Controls

| Input | Action |
|---|---|
| **Left-click** ground | Move to that location |
| **Hold left + right mouse**, or **WASD** | Run / strafe |
| **Right-drag** | Orbit the camera, **mouse wheel** zooms |
| **Tab**, or **left/right-click** a unit | Target enemies, NPCs, or party members |
| **1–0** | Use hotbar slot (weapon skills, spells, abilities, items) |
| **Right-click** a target | Context menu (attack, talk, shop, trade…) |
| **F** | Toggle first-person camera |
| **Enter** | Open chat input |
| **?** | Open the help overlay |

Combat is mostly automatic once you have a target in range: your character auto-attacks,
and you trigger weapon skills/spells/abilities from the hotbar when they're ready.

---

## 3. Jobs

Pick the job that matches how you want to play — your AI companions cover whatever roles
you don't.

| Job | Role | Highlights |
|---|---|---|
| **WAR** Warrior | Front-line tank | High HP, steady sword damage, `Provoke` to hold aggro, `Berserk`/`Defender` stances |
| **MNK** Monk | Brawler | Huge HP pool, fast fists, `Boost` for burst damage, `Chakra` for self-healing |
| **WHM** White Mage | Healer | `Cure`/`Cure II` to heal the party, `Protect` for party defense, `Dia`/`Banish` for light damage |
| **BLM** Black Mage | Nuker | `Stone`, `Blizzard`, `Fire` elemental nukes, `Sleep` to lock down enemies — fragile, stay at range |
| **THF** Thief | Skirmisher | High evasion and crit, `Steal` for bonus gil, `Sneak Attack` for guaranteed crits, `Flee` to escape |

Each job has its own weapon skill (triggers at 100% TP from auto-attacks), job
abilities with cooldowns, and (for WHM/BLM) spells with MP costs and cast times. Level up
to unlock higher-tier actions — max level is 15.

---

## 4. Combat basics

- **Target** an enemy (Tab or click) — your character and companions will auto-attack
  once in range.
- **Aggro**: aggressive monsters (Mandragora, Crag Spider, Goblin Mugger, Orcish Grunt,
  the field boss) notice and chase you within their sight range. Passive monsters
  (sheep, wasps, worms, bats) only fight back if attacked.
- **TP** builds from auto-attacks; spend it on your job's weapon skill for a big damage
  hit.
- **MP** (WHM/BLM) regenerates slowly — manage cast times and recasts.
- **Sleep** (BLM) is great for skipping a fight or controlling adds — any damage wakes
  the target early.
- Use **potions/ethers** from the hotbar to top up HP/MP mid-fight.
- If you're defeated, use **Return to Home Point** on the death screen to respawn in
  town.

---

## 5. Monsters of the plains

| Monster | Level | Behavior | Notable drops |
|---|---|---|---|
| Mad Sheep | 1–3 | Passive | Hare Meat |
| Stinger Wasp | 2–4 | Passive | Honey |
| Mandragora | 3–6 | **Aggressive** | Mandra Sprout, Wild Herb |
| Forest Bat | 4–7 | Passive | Bat Wing |
| Stone Eater (worm) | 5–8 | Passive | Worm Silica, Copper Ore |
| Goblin Mugger | 6–9 | **Aggressive** | Goblin Mask, Potion |
| Crag Spider | 7–10 | **Aggressive** | Spider Web, Wild Herb |
| Orcish Grunt | 9–12 | **Aggressive** | Orc Tooth, Hi-Potion |
| **Gorthak the Render** (field boss) | 14 | **Aggressive**, 900 HP | Render Horn, Hi-Potion, 400–600 gil |

The boss lives deep in the southwestern ruins and is meant to be fought with your full
party of three — don't pull it solo until you're well-leveled.

---

## 6. Quests

Talk to NPCs (right-click → Talk, or walk up and press Enter) to pick up and turn in
quests.

| Quest | Giver | Goal | Reward |
|---|---|---|---|
| **Plains of Plenty** | Gate Guard Eustace | Kill 4 Mad Sheep | 250 gil, 80 EXP |
| **Timber!** | Carpenter Galdric | Collect 3 Maple Logs | 200 gil, 70 EXP, Maple Club |
| **A Sealed Past** | Father Odo | Deliver a sealed scroll to Archaeologist Renn | 300 gil, 120 EXP |
| **The Render of the Ruins** | Archaeologist Renn (after *A Sealed Past*) | Defeat Gorthak the Render | 1000 gil, 600 EXP, Hi-Potion |

NPC locations:

- **Gate Guard Eustace** — by the town gate
- **Mirelle, Weaponsmith** — sells weapons and armor
- **Pikko-Wikko** — sells potions, ethers, and other items
- **Father Odo** — near the chapel
- **Carpenter Galdric** — near the lumber yard
- **Archaeologist Renn** — camped near the southwestern ruins (dangerous approach)

---

## 7. Gathering & crafting

Gather raw materials from the field (logging points, ore deposits, herb patches, and
monster drops), then craft at the appropriate station in town.

| Recipe | Result | Materials | Skill |
|---|---|---|---|
| Potion ×2 | Potion | 2× Wild Herb | Alchemy |
| Hi-Potion | Hi-Potion | 2× Wild Herb, 1× Honey | Alchemy |
| Rabbit Pie | Rabbit Pie | 2× Hare Meat, 1× Wild Herb | Cooking |
| Maple Club | Maple Club (WHM weapon) | 3× Maple Log | Woodworking |
| Willow Wand | Willow Wand (BLM weapon) | 2× Maple Log, 1× Worm Silica | Woodworking |
| Bronze Sword | Bronze Sword (WAR weapon) | 3× Copper Ore | Smithing |

---

## 8. Shopping

Visit **Mirelle, Weaponsmith** for weapons and armor upgrades as you level, and
**Pikko-Wikko** for consumables (Potions, Hi-Potions, Ethers). Gil comes from monster
drops, quest rewards, and (for Thieves) the `Steal` ability.

---

## 9. Tips

- Keep your party's HP topped up — AI companions heal themselves with items but rely on
  your WHM's Cures if you're playing one.
- Sleep + pull tactics let a small party handle aggressive groups one at a time.
- The day/night cycle is cosmetic but some monsters feel more atmospheric to fight at
  dusk — no mechanical difference, just vibes.
- Your save is per-browser/device (localStorage) — it won't follow you to a different
  browser or computer.
