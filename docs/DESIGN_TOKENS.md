# BusGo Track — Design Tokens (Claymorphism)

**For:** the API dashboard, so it looks like it belongs to the same product as the BusGo Track app.
**Source of truth:** `BusGo_Track/frontend/src/index.css` (the live frontend). This doc + `tega-clay-tokens.css` are a self-contained mirror — no need to pull the frontend build.
**Drop-in file:** `docs/tega-clay-tokens.css` (sits right next to this file).

---

## The vibe in one line

**Claymorphism** — soft 3D on a **warm ivory ground** (`#FBF3EA`, not white), teal-green brand, terracotta secondary, chunky rounded corners, and a signature "double shadow" (outer drop + inner highlight) that makes surfaces look pressed out of clay. Playful but calm. Fonts: **Fraunces** (display/serif) + **DM Sans** (body).

The single most important thing: **don't put dashboard content on pure white or grey.** Use the cream `--clay-bg` canvas with white `--clay-surface` cards on top. That warmth is what makes it read as "BusGo Track."

---

## How to use it (Next.js + Tailwind)

1. Copy `tega-clay-tokens.css` into the project (e.g. `app/tega-clay-tokens.css`).
2. Import it at the very top of `app/globals.css`, above the Tailwind directives:
   ```css
   @import "./tega-clay-tokens.css";
   @tailwind base;
   @tailwind components;
   @tailwind utilities;
   ```
3. **Dark mode** toggles on the `.dark` class on `<html>` or `<body>` — matches Tailwind's `darkMode: 'class'`. All tokens flip automatically; you write the variable once.
4. Use either the **CSS variables** directly, or the **ready-made classes** (`.clay-card`, `.btn-primary`, `.btn-secondary`, `.clay-surface`, `.glass-panel-heavy`, `.clay-pill`).

### Wiring into Tailwind (optional but nice)
Map the tokens in `tailwind.config` so you can write `bg-surface`, `text-primary`, `rounded-card`, etc.:
```js
theme: {
  extend: {
    colors: {
      canvas:  'var(--clay-bg)',
      surface: 'var(--clay-surface)',
      primary: 'var(--clay-teal)',
      'primary-deep': 'var(--clay-teal-deep)',
      ink:     'var(--clay-text)',
      'ink-2': 'var(--clay-text-secondary)',
      'ink-3': 'var(--clay-text-muted)',
    },
    borderRadius: { card: 'var(--clay-radius)', pill: 'var(--clay-radius-pill)' },
    boxShadow: {
      clay:   'var(--clay-shadow-double)',
      float:  'var(--clay-shadow-float)',
    },
    fontFamily: {
      display: ['Fraunces', 'Georgia', 'serif'],
      body:    ['DM Sans', 'sans-serif'],
    },
  },
}
```

---

## Token reference

### Surfaces (light → dark)
| Token | Light | Dark | Use |
|---|---|---|---|
| `--clay-bg` | `#FBF3EA` | `#1E1A17` | Page canvas — the warm ground |
| `--clay-surface` | `#FFFFFF` | `#292320` | Cards, panels sitting on the canvas |
| `--clay-surface-alt` | `#F7EFE6` | `#322A25` | Nested / elevated surface |
| `--clay-surface-press` | `#EFE3D6` | `#201B18` | Pressed / active state |

### Brand & accents
| Token | Light | Dark | Use |
|---|---|---|---|
| `--clay-teal` | `#3DB5A2` | `#58CDB8` | **Primary brand** — CTAs, active, links |
| `--clay-teal-deep` | `#2C8E7E` | `#3DB5A2` | Hover, borders, emphasis text |
| `--clay-terracotta` | `#E1876C` | `#EC9E86` | **Secondary** accent |
| `--clay-blue` / `-deep` | `#8FB8C9` / `#6E9DAE` | — | Info accents |
| `--clay-mint` / `-deep` | `#8FD3A8` / `#6FBE8C` | — | Positive accents |
| `--clay-yellow` | `#E7B84E` | — | Highlight |
| `--clay-lilac`, `-coral`, `-pink`, `-peach` | see CSS | — | Extra categorical hues |

### Text
| Token | Light | Dark |
|---|---|---|
| `--clay-text` | `#29251F` | `#ECE6DE` |
| `--clay-text-secondary` | `#6C6157` | `#B0A498` |
| `--clay-text-muted` | `#A99E92` | `#7A7065` |

### Status (semantic — keep separate from brand)
| Token | Value |
|---|---|
| `--color-success` | `#4FA46A` |
| `--color-warning` | `#E0A63C` |
| `--color-error` / `--color-danger` | `#DD5F54` |

### Borders
`--clay-border` (subtle) · `--clay-border-strong` (medium) · `--clay-border-accent` (teal-tinted).
Border **widths**: `--clay-border-width: 3px` (chunky, for tactile/focal) · `--clay-border-hair: 1.5px` (informational).

### Radius
`--clay-radius: 20px` (cards) · `--clay-radius-sm: 14px` (inputs, buttons) · `--clay-radius-lg: 24px` (hero) · `--clay-radius-pill: 9999px`.

### Shadows — the clay look
| Token | What it's for |
|---|---|
| `--clay-shadow-double` | **The signature.** Outer drop + inner highlight → looks pressed from clay. Use on focal cards. |
| `--clay-shadow-outer` | Plain outer drop |
| `--clay-shadow-inner` | Inner highlight only (inset) |
| `--clay-shadow-soft` | Barely-there resting shadow |
| `--clay-shadow-float` | Lifted / hovered |
| `--clay-shadow-press` | Inset, for `:active` pressed state |

**Elevation tiers** — let depth signal importance, not decorate everything:
- `--elev-0` (none) → text, info rows, nav
- `--elev-1` (soft) → resting cards, panels, chips
- `--elev-2` (double) → tactile CTAs and focal cards **only**

### Motion
`--clay-bounce: cubic-bezier(0.34, 1.56, 0.64, 1)` (overshoot — buttons, pop-ins) ·
`--clay-ease: cubic-bezier(0.16, 1, 0.3, 1)` (smooth — sheets, fades).

---

## Do / Don't

**Do**
- Cream canvas → white cards → chunky rounded corners. That's 80% of the look.
- Use `--clay-teal` for anything interactive/primary; terracotta for secondary emphasis.
- Reserve the double shadow (`--elev-2`) for focal elements; most panels are `--elev-1`.
- Use the semantic status colors for success/warning/error — **not** the accent palette.
- Serif (Fraunces) for headings/numbers, sans (DM Sans) for body.

**Don't**
- Don't drop content on pure `#FFF` or cool grey — it kills the warmth.
- Don't put shadows on everything — flat is the default; depth is earned.
- Don't invent one-off hexes; pull from these tokens so the two products stay in sync.

---

## Data-viz / dashboard palette (categorical)

For charts and multi-series tiles, use the accent family in this order (all distinguishable, all on-brand):

`--clay-teal` → `--clay-terracotta` → `--clay-yellow` → `--clay-blue` → `--clay-mint` → `--clay-lilac` → `--clay-coral` → `--clay-pink`

Sequential (one metric, low→high): tint from `--clay-surface-alt` to `--clay-teal-deep`.

---

*Questions on intent → the frontend `index.css` is the canon; ping the frontend side if a token seems missing. Keep this file and `tega-clay-tokens.css` together.*
