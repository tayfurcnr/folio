# Folio UI design

## Brief-led visual plan

Folio is a presentation editor for people arranging slides, media and visual stories. Its work surface should keep the slide stage prominent while making the navigation and editing tools easy to reach.

### Tokens

| Role | Value | Use |
|---|---|---|
| Folio navy | `#1F2A37` | Main text and controls |
| Folio orange | `#FF6F3C` | Brand mark, active navigation and primary actions |
| Warm white | `#FAF8F4` | App background |
| Panel white | `#FFFFFF` | Header, panels, menus and slide surface |
| Mist | `#E9E7E2` | Borders and dividers |
| Canvas gray | `#F4F5F7` | Workspace around the slide |

Typography uses the existing locally licensed Inter files. Controls use the existing Folio scale and icon sprite; no new display face or icon family is introduced.

### Layout

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ Folio mark · File / Edit / View       Presentation       Team / Share / ▶ │
├────────┬──────────────────────┬─────────────────────────────────────────┤
│        │                      │ Top ruler                               │
│ Rail   │ Context panel        │                                         │
│ 8 tabs │                      │                 Slide stage             │
│        │                      │                                         │
│ Help   │                      │                         View controls    │
│        │                      ├─────────────────────────────────────────┤
│        │                      │ Filmstrip, limited to the stage column  │
└────────┴──────────────────────┴─────────────────────────────────────────┘
```

Navigation and panel content are left aligned. The slide is centered in the remaining stage. Filmstrip and status controls belong to the stage column only.

### Principles

- Keep the slide as the largest quiet surface.
- Use orange only to identify the Folio brand and active/action states.
- Use the supplied logo lockup and app icon without redrawing them.
- Keep state changes legible: active rail state, disabled motor actions, focus ring and panel visibility each have a non-color cue.
- Keep motion short and action-led; honor reduced-motion preferences.

## Review against the brief

The initial direction follows the existing `atlas/DESIGN.md`, `tokens.css`, and the supplied `ref-editor.png`. A new palette, display typeface, gradient-led hero, decorative card system, or alternative editor layout would make Folio look like a different product, so those ideas were removed before implementation. The reference image informs proportions, light surfaces, orange selection states, menu placement and the eight-item rail. Its example presentation content is not reproduced as live document data; WP1 uses a clearly labelled static slide surface.

## Source notes

- Main design authority: `atlas/DESIGN.md` and `atlas/apps/editor/src/ui/tokens.css`.
- Additional visual reference: `ref-editor.png` in this directory.
- Local Inter source and license: `apps/editor/public/fonts/`.
- App mark and icon: `../logo/folio_logo.svg` and `../logo/folio-icon.svg`.
