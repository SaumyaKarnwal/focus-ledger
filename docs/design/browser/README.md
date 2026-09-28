# Browser app mocks

The web app's look, from the owner's design canvas ("Direction C, the one to build", 1440 × 900). One file per screen. Each is plain HTML with inline styles; it needs the canvas runtime (`support.js`) to render, but the markup and styles read directly.

| File | Screen |
|---|---|
| `C-Desk-Empty.dc.html`, `C-Desk-Empty-Set.dc.html` | First run, untouched and after a few taps |
| `C-Desk-Today.dc.html`, `C-Desk-Today-Edit.dc.html` | Today, estimate at rest and while editing |
| `C-Desk-Log.dc.html` | Today, logging an entry by hand |
| `C-Desk-Running.dc.html` | Running |
| `C-Desk-Bell.dc.html` | The bell (extend, break, new cycle) |
| `C-Desk-Break.dc.html` | Break |
| `C-Desk-Tree.dc.html`, `C-Desk-Edit.dc.html` | Tree and node detail, adding a node |
| `C-Desk-Report.dc.html` | Report |
| `C-Desk-Settings.dc.html` | Settings |
| `C-Desk-Confirm.dc.html` | "Your default is wrong" prompt |
| `C-Desk-SignUp.dc.html` | Create an account |
| `Flow.dc.html` | How the screens connect |

Rules for building from them:
- **The mocks decide the look** (fonts, colors, spacing, components). **The design docs decide the behavior.** Where they differ, the docs win.
- The product name in the mocks ("Time Ledger", "Cycle Journal") comes from the product-name constant, not from the mocks.
- Sign-in is required and uses Google only. The sign-in screen follows the look of `C-Desk-SignUp.dc.html` with a single "Sign in with Google" action; the "Sign in" link on first run is not a skip.
- The bell never re-asks the mode (PRD FR-4.3). Ignore copy that says the mode is confirmed at the bell.
- `C-Desk-Confirm.dc.html` ("Your default is wrong") is not in v1.
