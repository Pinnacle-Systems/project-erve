# @erve/tokens

## Purpose

Defines shared design tokens for the ERP UI/UX platform.

Tokens are UI-library agnostic. They are plain typed TypeScript values that can be mapped later into CSS variables, a theme provider, a native app theme, or another rendering system.

## What Belongs Here

- Color, typography, spacing, density, radius, elevation, motion, focus, and semantic status tokens.
- Token names and token documentation.
- Desktop and mobile density concepts.
- Generic document and workflow status token names.

## What Does Not Belong Here

- Components.
- Runtime theme loading.
- Client-specific branding implementations.
- Business-specific statuses.
- Client-specific colors, logos, or brand assets.

## Allowed Dependencies

- None. This package must not import from anything.

## Current Exports

- `colorTokens`
- `semanticColorTokens`
- `typographyTokens`
- `spacingTokens`
- `radiusTokens`
- `shadowTokens`
- `densityTokens`
- `statusTokens`
- `zIndexTokens`

## Consumption Examples

Use tokens directly when building platform wrappers:

```ts
import { semanticColorTokens, spacingTokens } from "@erve/tokens";

export const buttonStyles = {
  background: semanticColorTokens.info.accent,
  color: semanticColorTokens.foreground.inverse,
  paddingInline: spacingTokens[3],
};
```

Use density tokens to keep desktop and mobile interaction models distinct:

```ts
import { densityTokens } from "@erve/tokens";

const desktopGridRowHeight = densityTokens.desktop.compact.gridRowHeight;
const mobileTouchTarget = densityTokens.mobile.comfortable.touchTarget;
```

Map generic workflow statuses to semantic colors:

```ts
import {
  semanticColorTokens,
  statusTokens,
  type WorkflowStatusName,
} from "@erve/tokens";

export function getStatusColors(status: WorkflowStatusName) {
  const statusToken = statusTokens[status];
  return semanticColorTokens[statusToken.semantic];
}
```

## Branding Overrides

Do not put client branding directly in this package.

Client-specific colors, logos, fonts, and brand assets should be applied later through a theme mapping layer. The token names in this package are the stable platform contract; consuming apps can map those names to approved client brand values through a theme provider.
