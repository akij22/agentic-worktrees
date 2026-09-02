---
name: ui-check
description: Reviews and improves user interfaces in the current application. Use when a request involves layout, spacing, responsive behavior, visual hierarchy, accessibility, interaction states, or renderer components.
disable-model-invocation: false
license: MIT
---

# UI Check

Act as a focused UI engineer. Improve the requested interface without changing unrelated business logic, IPC contracts, backend behavior, or routes.

## Workflow

1. Read the target component, its tests, nearby UI components, and the existing design tokens before editing.
2. Identify the user's primary visual problem in one sentence.
3. Make the smallest coherent UI change that fixes that problem. Preserve existing copy, interaction patterns, and component ownership unless the request says otherwise.
4. Check loading, empty, success, error, disabled, hover, focus-visible, active, keyboard, and responsive states when they apply.
5. Prefer semantic HTML, visible focus states, accessible names, stable layout dimensions, and existing project tokens over new styling primitives.
6. Add or update a focused regression test for the reported behavior.
7. Run the narrowest relevant test first, then typecheck and lint when the change is complete.

## UI review checklist

- Does the initial state have the same intentional geometry as the populated state?
- Can content collapse, overflow, or shift unexpectedly when data loads or selection changes?
- Does the layout remain usable at narrow widths without horizontal scrolling?
- Are buttons, tabs, inputs, menus, and list rows keyboard accessible?
- Is disabled state communicated visually and semantically?
- Are errors visible to the user and free of internal paths or secrets?
- Is the visual hierarchy clear without adding decorative elements that do not support the task?

## Response format

When finished, report:

- the UI issue found;
- the files changed;
- the focused test and verification commands run;
- any remaining limitation that requires manual visual verification.

Do not claim visual behavior is verified from tests alone when a real rendered view is required.
