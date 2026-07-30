# @erve/theme

Shared theme tokens and `ThemeProvider` for ERP UI platform packages.

Themes control visual tokens only: color, font, radius, shadow, focus, status tones, and density variables. They do not control permissions, workflow state, routes, field visibility, or business rules.

Import `@erve/theme/theme.css` once in an app shell or design workbench when using Tailwind-powered platform components.

## Density

Applications select density at their identity boundary with `ThemeProvider` (`touch` for the mobile application and `compact` for the web application). Shared controls resolve density in this order: an explicit component override, an inherited compound-component override, and then the ambient provider density. With no provider, the existing `ThemeProvider` context fallback remains `comfortable`.

Density is never inferred from viewport width. `ThemeProvider` writes `data-density` and the matching CSS variables to `<html>`, allowing body-level portal content to inherit the same application density. Compound controls also carry explicit overrides through their React tree so portaled options and menu rows match their trigger.
