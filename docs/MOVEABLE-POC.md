# Moveable selection PoC

Start Folio's editor, then open the editor URL with `?moveablePoc=1` appended. For example:

```text
http://localhost:5173/?moveablePoc=1
```

Select a slide object to see Moveable's resize handles and rotation control. The existing move button remains the drag target. Moveable supplies the DOM controls; Folio continues to own hit testing, preview, snapping, and committed geometry through its Rust engine.

The PoC is opt-in through the URL parameter. Opening Folio without it keeps the existing selection controls. The `moveable` package is dynamically imported only when a selection is active in PoC mode.
