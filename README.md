<div align="center">

<img src="https://img.shields.io/badge/version-1.4.0-brightgreen?style=for-the-badge&labelColor=0d1015&color=8eff5a" alt="Version">
<img src="https://img.shields.io/badge/platform-Tampermonkey-orange?style=for-the-badge&labelColor=0d1015" alt="Platform">
<img src="https://img.shields.io/badge/formula-Vladar%202.0-blue?style=for-the-badge&labelColor=0d1015" alt="Formula">
<img src="https://img.shields.io/badge/license-GPL--3.0-red?style=for-the-badge&labelColor=0d1015" alt="License">

<br><br>

# Torn Gym Gains Calculator+

**A userscript for [Torn City](https://www.torn.com) that pulls your account data from the API and gives you precise gym training projections, multi-day plans, goal estimations, ratio balancing, and full gym comparisons, all built on Vladar's gain formula.**

<br>

[Installation](#installation) · [Tabs](#tabs) · [Balance Tab](#balance-tab-in-depth) · [FAQ](#faq) · [Changelog](#changelog)

</div>

---

## What it does

The game shows you nothing about how gains scale. This script fills that gap. It simulates your actual training session down to the individual train, accounts for every perk and bonus, and tells you exactly what you are going to gain before you spend a single point of energy.

Everything runs locally in your browser. No data leaves your machine except to the official Torn API using your own key.

---

## Installation

**Requirements:** Tampermonkey (Chrome/Firefox/Edge) or Violentmonkey.

1. Install [Tampermonkey](https://www.tampermonkey.net/) if you have not already.
2. Click the install link on the [Greasy Fork page](https://greasyfork.org/scripts/575551).
3. Confirm the install.
4. Navigate to `torn.com/gym.php`.
5. Click the **GYM CALC** button that appears in the bottom-left corner.
6. Go to the **Setup** tab, paste your Torn API key, and click **Load everything from API**.

That's it. Every field fills automatically from your account.

> **API key note:** Limited access is enough. The script only reads gyms, bars, battle stats, and perks. It never writes anything.

---

## Tabs

<details>
<summary><strong>Calculator</strong> - Single session projection</summary>

<br>

The baseline tab. Set your stat, happy, energy, and gym and get a full breakdown of what one session produces.

| Field | What it means |
|---|---|
| Stat total | Your current value for the selected stat |
| Happy | Starting happiness for the session |
| Energy | Total energy budget to spend |
| Gym | Which gym you are training at |

**Jump presets** let you model item-boosted sessions without manually entering the resulting happy and energy values. Choco Jump, Happy Jump, 99k Jump, and a fully custom option are all available.

**Bonuses & Perks** auto-fills from your API data but can be edited manually. Includes property, education (general + stat-specific), faction steadfast, faction candy boost, job, and book bonuses.

Results show total gain, final stat, happy consumed, energy used, and an estimated session cost in consumables.

</details>

<details>
<summary><strong>Multi-Day</strong> - Project gains over time</summary>

<br>

Takes your Calculator settings and simulates them forward across a schedule you define.

- **Total days** - how many calendar days to project
- **Train every X days** - if you do not train every day
- **Sessions per train day** - how many full sessions per training day

Outputs total gain, final stat, average per session, total energy, and a cost breakdown for the full period.

</details>

<details>
<summary><strong>Goal</strong> - Work backwards from a target</summary>

<br>

Three modes:

| Mode | What you enter | What you get |
|---|---|---|
| Stat target | The absolute stat value you want | Days, sessions, and energy needed |
| % increase | How much you want to grow relative to now | Same |
| Project days | A fixed number of days | Where you end up |

Long projections run fast. The simulation skips per-train history allocation and only computes what is needed.

</details>

<details>
<summary><strong>Balance</strong> - Train toward a stat distribution</summary>

<br>

See the [Balance Tab In Depth](#balance-tab-in-depth) section below.

</details>

<details>
<summary><strong>Gyms</strong> - Compare every gym at once</summary>

<br>

Runs your current Calculator stat, happy, energy, and bonus configuration against every gym that trains your selected stat. Sorted by per-session gain.

Columns: gym name, dots, energy cost per train, gain per single train, gain for a full session, and gain per energy unit.

Your currently selected gym is marked with a star.

</details>

<details>
<summary><strong>Setup</strong> - API key, theme, and cache info</summary>

<br>

Paste your API key here and hit **Load everything from API**. The script fetches your gyms, battle stats, max happy, max energy, active gym, and all perk strings in two API calls.

Also contains the theme picker (six color schemes), a cache summary showing when data was last loaded, a panel position reset button, and a full reset option.

</details>

---

## Balance Tab In Depth

This tab answers the question: *given how my stats are distributed right now, what do I need to train and in what order to reach a specific ratio?*

### Custom Ratio mode

Enter four percentages that sum to 100. The script looks at your current stat distribution, figures out which stats are under their target share, and builds a training plan that brings you there using one train at a time from your Calculator gym.

Use the **Normalize** button if your numbers are close to 100 but not exact.

### Special Gyms mode

Pick one or two special gyms you want to qualify for. The script calculates the target stat distribution that satisfies both requirements simultaneously and builds the plan toward it.

Incompatible combinations are automatically greyed out in the picker. You cannot select two gyms whose requirements directly contradict each other.

**Valid dual-gym combinations and their target ratios:**

| Combo | STR | DEF | SPD | DEX |
|---|---|---|---|---|
| Balboas + Isoyamas | 22.2% | 31.0% | 22.2% | 24.6% |
| Balboas + Elites | 22.2% | 24.6% | 22.2% | 31.0% |
| Balboas + Gym 3000 | 35.0% | 28.0% | 9.0% | 28.0% |
| Balboas + Total Rebound | 9.0% | 28.0% | 35.0% | 28.0% |
| Frontline + Gym 3000 | 31.0% | 22.2% | 24.6% | 22.2% |
| Frontline + Total Rebound | 24.6% | 22.2% | 31.0% | 22.2% |
| Frontline + Isoyamas | 27.8% | 35.0% | 27.8% | 9.4% |
| Frontline + Elites | 27.8% | 9.4% | 27.8% | 35.0% |

### Precision toggle

- **Precise** - stops when all four stats are within 0.5% of target
- **Fast** - stops when all stats are within 1.0% of target (shorter plan, less accurate)

In gym mode, neither setting ever stops before the actual gym requirements are met, regardless of the ratio deviation.

### The plan output

The summary shows total trains needed, estimated days based on your daily energy budget, and total energy cost. Below that is a stat breakdown table and a full day-by-day plan for the first 90 days.

Each day card shows exactly how many trains to do and on which stat, with the energy cost and estimated gain for each block of consecutive trains.

**How the energy model works:** the energy value in the Calculator tab is your total daily budget. The gym selected in the Calculator determines the cost per train. Trains per day is `floor(daily budget / gym energy per train)`. The last day of the plan only uses as many trains as actually remain.

---

## The Formula

The script uses Vladar's gain formula as documented by the Torn community.

```
gain = ((S_capped * happy_mult + 8 * H^1.05 + adj + B) / 200000) * G * E * perk_mult
```

Where:
- `S_capped` - your stat, with a soft cap applied above 50M
- `happy_mult` - derived from `1 + 0.07 * log(1 + H / 250)`
- `H` - your current happiness
- `adj` - a stat-specific high-happy adjustment constant
- `B` - a stat-specific base constant
- `G` - gym dots divided by 10
- `E` - energy per train
- `perk_mult` - multiplicative product of all active bonus percentages

Happy degrades each train by approximately `0.1 * energy_per_train * 5` points. Sessions are simulated train by train to capture this decay accurately.

---

## FAQ

<details>
<summary>The script is not appearing on gym.php</summary>

Make sure Tampermonkey is enabled and the script is active. Check the Tampermonkey dashboard and confirm the script shows as "Enabled". Some browser extensions or content security policies on other pages can interfere, but gym.php specifically should work without issues.

</details>

<details>
<summary>My stats or gym are not loading</summary>

Go to the Setup tab and click Load. The script does not load API data automatically on install, you have to trigger it manually. After that it caches the data and reuses it until you reload again.

</details>

<details>
<summary>The Balance tab is telling me I already meet the target</summary>

Your current stat distribution is already within the precision threshold of the target ratio. If you are in gym mode and it still says this but you cannot enter the gym in-game, the issue is that the game checks actual raw stat values, not just ratios. Training gaps might be smaller than one train, or another requirement (like having unlocked the prerequisite gym) has not been met.

</details>

<details>
<summary>Why does the Balance tab use the Calculator gym for everything?</summary>

Because the goal is to give you a concrete, actionable plan based on what you are actually training with, not a theoretical best-case using a different gym per stat. Set whichever gym makes sense in the Calculator and the Balance tab will plan around it.

</details>

<details>
<summary>Can I trust the gain estimates?</summary>

They are accurate to the formula. Real in-game gains have a random component per train (a stat-specific variance term). The script uses the deterministic average, so individual trains will vary slightly but session totals will be close. Over a long multi-day plan the variance averages out.

</details>

<details>
<summary>My bonuses look wrong</summary>

Check the Bonuses & Perks section in the Calculator tab. The script parses perk strings from the API using regex matching, which covers the standard formats Torn uses. If you have an unusual perk description format that the parser misses, you can override any field manually. Hit "Reset to detected" to restore API values at any time.

</details>

---

## Special Gym Requirements

For reference, the stat requirements for each special gym (prerequisite gym unlocks not listed, only the stat conditions):

| Gym | Energy | Requirement |
|---|---|---|
| Balboas Gym | 25E | DEF + DEX >= 125% of STR + SPD |
| Frontline Fitness | 25E | STR + SPD >= 125% of DEF + DEX |
| Gym 3000 | 50E | STR >= 125% of second highest stat |
| Mr. Isoyamas | 50E | DEF >= 125% of second highest stat |
| Total Rebound | 50E | SPD >= 125% of second highest stat |
| Elites | 50E | DEX >= 125% of second highest stat |

---

## Changelog

<details>
<summary><strong>v1.4.0</strong> - Balance Tab</summary>

<br>

**Added: Balance tab** (between Goal and Gyms)

A new tab dedicated to planning training toward a target stat distribution, either a custom ratio you define or the stat requirements of one or two special gyms.

- Custom ratio mode: enter four percentages summing to 100, get a day-by-day training plan
- Special gym mode: pick one or two gyms, the script derives the correct target ratio from their requirements and plans toward it
- Incompatible gym pairs are automatically blocked in the picker (based purely on whether their stat requirements can be simultaneously satisfied)
- All eight valid dual-gym combinations are supported with algebraically derived target ratios
- Fast / Precise precision toggle: 1.0% or 0.5% convergence threshold
- In gym mode, the plan never stops before the actual gym stat requirements are met regardless of precision setting
- Day-by-day plan cards showing trains per stat, energy cost, and estimated gain per block
- Daily energy budget model: the Calculator energy field is your total daily budget, the Calculator gym cost-per-train determines how many trains fit per day
- Last day of the plan uses only the remaining trains needed, never forces a full day's budget
- Three ratio bars (current, after plan, target) for visual comparison
- Training breakdown table with final values, final percentages, and deviation from target per stat
- Status bar on load now shows total battle stats instead of the selected single stat

**Fixed: Balance tab gym pair compatibility** - the correct set of incompatible pairs is now enforced. Pairs are blocked if and only if their stat requirements mathematically cannot be simultaneously satisfied, which turns out to be: Balboas vs Frontline, and any two solo gyms.

</details>

<details>
<summary><strong>v1.3.1</strong></summary>

<br>

- **Added:** GitHub button in the Setup tab linking to this page.

</details>

<details>
<summary><strong>v1.3.0</strong></summary>

<br>

- **Added:** Color themes. A theme picker in the Setup tab lets you switch the whole panel between six schemes: Matrix, Deep Ocean, Ember, Amethyst, Goldrush, and Slate. Each theme shows a live swatch preview before you commit.

</details>

<details>
<summary><strong>v1.2.2</strong></summary>

<br>

- **Fixed:** Long projections in Goal and Multi-day no longer freeze the panel.
- **Fixed:** Stale calculations from a previous tab no longer overwrite the current view. If you switch tabs mid-projection, the old result is discarded.
- **Fixed:** Settings tab no longer overflows on narrow widths. Long perk strings now wrap cleanly.
- **Fixed:** Panel body could be squeezed to zero height on very short viewports. Layout is now properly flex-constrained.
- **Fixed:** Body scroll position no longer carries over between tabs. Each tab opens at the top.
- **Fixed:** Drag handle now correctly ignores clicks on inputs, selects, and labels, not just buttons.
- **Reworked:** Multi-day, Goal, and Gym Compare are significantly faster. The simulation skips per-train history arrays when only totals are needed.
- **Reworked:** Settings persist on a 200ms debounce instead of writing on every keystroke.
- **Improved:** Active stat pills have a colored glow matching the stat, with a press animation on click.
- **Improved:** Buttons and icon buttons get a subtle hover background.
- **Improved:** Result grids collapse to a single column on narrow viewports (600px and below).
- **Improved:** Warning messages use a consistent style across every tab.
- **Improved:** Chart re-render animation shortened from 1000ms to 250ms.
- **Improved:** Scrollbar thumb gets a brighter highlight on hover.

</details>

<details>
<summary><strong>v1.2.1</strong></summary>

<br>

- **Fixed:** Stat bonuses from properties, jobs, and books now correctly apply only to their specific stats.
- **Fixed:** The tool no longer freezes when starting a session with 0 energy.
- **Fixed:** Auto-gym-pick now correctly skips zero-dot gyms.
- **Fixed:** Chart tooltips now format large numbers correctly and consistently.
- **Reworked:** Xanax estimates in Multi-day and Goal are now realistic. They account for natural energy regen and daily refill first, so xanax only appears when actually needed.
- **Reworked:** Calculator tab session cost now uses the same regen + refill + xanax model.
- **Added:** Gain per energy readouts in the Gyms and Calculator tabs.
- **Added:** Star marker next to your current gym in the Gyms tab.
- **Added:** Warning if happiness drops to 0 during a session.
- **Added:** Reset bonuses to API-detected values button.
- **Added:** Per-day and total cost breakdowns in Multi-day and Goal (e.g. "3 xanax + 1 refill + 600E natural" per day, scaled across the full schedule).
- **Added:** Jump preset cost display. Picking Choco, Happy, or Custom shows the actual items needed rather than an energy estimate.
- **Added:** Warning if daily energy exceeds the regen + 1 refill + 3 xanax cap, with the shortfall shown.
- **Improved:** Cleaner layouts across multiple tabs and better bonus breakdowns in the Settings tab.

</details>

<details>
<summary><strong>v1.0.2</strong></summary>

<br>

- **Changed:** Removed the 50M cap on gym gains. Calculations now work correctly beyond that threshold.

</details>

<details>
<summary><strong>v1.0.1</strong></summary>

<br>

- **Fixed:** Panel could load with its header above the viewport if the saved position no longer fit the current window size or zoom level, making it impossible to minimize. Position is now clamped on load, on window resize, and after dragging.
- **Added:** Reset position button (the corner arrow icon) in the panel header.
- **Added:** "Reset panel position" button in the Setup tab.
- **Changed:** Reset Everything now also resets panel position.

</details>

---

<div align="center">

Made for Torn by **Rowage [3926289]** &nbsp;|&nbsp; GPL-3.0 &nbsp;|&nbsp; [Install on Greasy Fork](https://greasyfork.org/scripts/575551)

</div>
