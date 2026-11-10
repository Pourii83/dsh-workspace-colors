# DSH Workspace Colors

**English** | [فارسی](README.fa.md)

A persistent [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that gives
every workspace in the sidebar its own color, so projects are recognizable at a glance.

<img src="icon.svg" width="72" height="72" alt="Plugin icon">

## Why

The sidebar groups sessions under workspace names, so with several projects open the list reads as
one uniform block. This plugin adds one reversible layer on top of the host: a settings page, a
stored color per workspace, and a tiny package-owned stylesheet that tints those header rows — no
fork, no edits to DSH itself.

## Features

- **A color per workspace** — the header row gets a tinted background, a colored inline-start
  accent bar, and a colored folder icon; sessions underneath stay untouched.
- **Built-in palette picker** — preset colors plus a custom `#rrggbb` field; no operating-system
  color dialog opens.
- **Settings page** — Settings → **Workspace colors** lists every workspace with its current color,
  a per-row Reset, and Reset all colors.
- **Light and dark** — the page and rows use only host theme tokens (`--dsw-alias-*`).
- **Browser-local**, like the sidebar's own per-browser view order: the choice lives in
  `localStorage` and needs no Host state.
- **Cheap updates** — debounced persistence, frame-coalesced renders, and CSSOM rule edits instead
  of stylesheet replacement, so picking colors stays light on CPU and GPU.
- **Clean lifecycle** — disabling the bundle removes its stylesheet, settings page, and nav icon.

## Install

Clone this repository, then install the checkout as a bundle:

```
git clone https://github.com/Pourii83/dsh-workspace-colors.git
plugin_manager install_bundle  (target: <path>/dsh-workspace-colors)
```

or, in the Harness UI, Settings → Plugins → install the directory as a bundle. After installation
the settings page appears under Settings → Workspace colors.

## How it works

- **Client half** (`client.js`): reads the workspace list from the sidebar slot's `useWorkspaces`
  snapshot hook (falling back to the rendered workspace rows), renders the settings page into the
  `settings.section` slot and its navigation icon into `settings.section.icon`, and keeps one
  package-owned stylesheet whose rules tint `[data-row-key="workspace:<workspaceId>"]` rows.
- **Host half** (`index.js`): empty. The feature is browser-local, like the sidebar's own
  per-browser view order, so it needs no host state.
- **Storage**: the `workspaceId → #rrggbb` map lives in this browser's `localStorage` under
  `dsh.workspace-colors.v1`. It survives page reloads and Harness restarts that reuse the same Web
  GUI origin; a different origin starts with no colors.
- Styling uses only theme tokens (`--dsw-alias-*`), so the page and rows follow light and dark
  themes.

## Performance

A color change never does per-event global work:

- the picker is an in-app palette plus hex field, not a native `<input type=color>`: no
  operating-system color dialog opens, and no continuous native input stream has to be absorbed;
- color writes are debounced (250 ms) before touching `localStorage`;
- the color store and the React subscribers update at most once per animation frame
  (`requestAnimationFrame`); memoized rows mean only the changed row re-renders;
- the row stylesheet is edited through CSSOM (one rule per colored workspace, declarations updated
  in place) instead of replacing the `<style>` element's whole text — replacing it invalidates
  styles for the entire document on every change, which is what made palette changes expensive;
- the sidebar repaint itself is a trailing 150 ms debounce, so a burst of changes costs one repaint;
- an added or removed color rebuilds the small rule list once; only value changes rewrite
  declarations;
- the workspace list comes from the reactive snapshot, so no DOM polling runs while that snapshot
  is available.

## Compatibility

Row tinting depends on the sidebar's stable row attribute `data-row-key="workspace:<id>"` and the
row's `folder`/`title` class suffixes that `dsh-client-ui-workspace` renders. If a future DSH
release renames them, the page and stored colors keep working but rows stop being tinted — nothing
breaks. Uninstall (`plugin_manager remove_bundle`) removes the stylesheet, the page, and the icon.

## Files

- `package.json` — bundle manifest (`dsh.bundle.patch`, `dsh.client`).
- `cordis.patch.yml` — inserts the `workspace-colors` Loader row.
- `index.js` — empty Host half.
- `client.js` — settings page, palette picker, color store, row stylesheet.
- `locale/{en,fa}.json` — Plugin Manager title and description.
- `icon.svg` — palette icon.

## License

[MIT](LICENSE)
