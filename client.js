window.__ModuleLoader__.load({
  id: '@local/dsh-workspace-colors',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Dictionary namespace owned by this plugin. */
    const NS = 'workspaceColors';
    /** Browser-local storage key holding the workspaceId → #rrggbb map. */
    const STORAGE_KEY = 'dsh.workspace-colors.v1';
    /** Stable id of the package-owned stylesheet that tints sidebar rows. */
    const ROW_STYLE_ID = '@local/dsh-workspace-colors/rows';
    /** Stable id of the package-owned stylesheet for this plugin's own controls. */
    const UI_STYLE_ID = '@local/dsh-workspace-colors/ui';
    /** Amount of the chosen color mixed into a workspace header row. */
    const ROW_TINT = 0.18;
    /** Amount used for the row's inline-start accent bar. */
    const ROW_ACCENT = 0.9;
    /** Palette presets offered for quick assignment, readable on light and dark. */
    const PALETTE = [
      '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16',
      '#22c55e', '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9',
      '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
      '#ec4899', '#f43f5e', '#64748b', '#71717a', '#78716c',
    ];
    /**
     * Trailing delay before the sidebar rows follow a color change. A picker can
     * emit dozens of changes per second; one repaint after the interaction
     * settles costs a fraction of repainting on every event.
     */
    const ROW_PAINT_DELAY_MS = 150;
    /** Debounce before the color map reaches browser storage. */
    const PERSIST_DELAY_MS = 250;

    //#region locales
    const en = {
      section: 'Workspace colors',
      intro: 'Pick a color for a workspace to tint its row in the sidebar. Colors are stored in this browser.',
      empty: 'No workspaces yet. Add a workspace from the sidebar to give it a color.',
      reset: 'Reset',
      unset: 'No color',
      clearAll: 'Reset all colors',
      picker: 'Color for {name}',
      palette: 'Palette',
      custom: 'Custom color',
      apply: 'Apply',
      invalid: 'Use a hex color such as #3b82f6',
    };
    const fa = {
      section: 'رنگ فضاهای کاری',
      intro: 'برای هر فضای کاری یک رنگ انتخاب کنید تا ردیف آن در نوار کناری رنگ بگیرد. رنگ‌ها در همین مرورگر ذخیره می‌شوند.',
      empty: 'هنوز فضای کاری‌ای وجود ندارد. از نوار کناری یک فضای کاری اضافه کنید تا رنگ بگیرد.',
      reset: 'حذف رنگ',
      unset: 'بدون رنگ',
      clearAll: 'پاک کردن همه رنگ‌ها',
      picker: 'رنگ {name}',
      palette: 'پالت رنگ',
      custom: 'رنگ دلخواه',
      apply: 'اعمال',
      invalid: 'یک رنگ هگز مانند ‎#3b82f6‎ وارد کنید',
    };
    //#endregion

    //#region color store

    /** Valid stored values are plain six-digit hex colors. */
    const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

    /** @returns {Record<string, string>} the accepted persisted color map. */
    function readStoredColors() {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw === null || raw === '') return Object.freeze({});
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return Object.freeze({});
        /** @type {Record<string, string>} */
        const clean = {};
        for (const key of Object.keys(parsed)) {
          const value = parsed[key];
          if (typeof key === 'string' && key !== '' && typeof value === 'string' && COLOR_PATTERN.test(value)) {
            clean[key] = value.toLowerCase();
          }
        }
        return Object.freeze(clean);
      } catch {
        return Object.freeze({});
      }
    }

    /** One immutable snapshot; identity changes only when the map changes. */
    let colors = readStoredColors();
    /** Color-map subscribers; the settings page and the row stylesheet read here. */
    const subscribers = new Set();
    /** Package-owned row stylesheet element while mounted. */
    let rowStyleTag = null;
    let rowStylesMounted = false;
    /** Colored workspace ids in stylesheet order, parallel to `rowRules`. */
    let rowRuleIds = [];
    /** CSSOM handles for one colored workspace: its row rule and icon rule. */
    let rowRules = [];
    /** Pending frame/timer handles, so a burst of picker events costs one update. */
    let rowPaintTimer = 0;
    let notifyFrame = 0;
    let persistTimer = 0;

    /** @returns {Record<string, string>} the current immutable color map. */
    function getColors() {
      return colors;
    }

    /**
     * Subscribe to color-map changes.
     * @param {() => void} listener change callback.
     * @returns {() => void} unsubscribe.
     */
    function subscribeColors(listener) {
      subscribers.add(listener);
      return () => {
        subscribers.delete(listener);
      };
    }

    /** @param {string} id workspace id. @param {string} hex accepted color. */
    function setWorkspaceColor(id, hex) {
      if (typeof id !== 'string' || id === '') return;
      if (typeof hex !== 'string' || !COLOR_PATTERN.test(hex)) return;
      const normalized = hex.toLowerCase();
      if (colors[id] === normalized) return;
      commitColors({ ...colors, [id]: normalized });
    }

    /** @param {string} id workspace id whose color is removed. */
    function clearWorkspaceColor(id) {
      if (!Object.prototype.hasOwnProperty.call(colors, id)) return;
      const next = { ...colors };
      delete next[id];
      commitColors(next);
    }

    /** Remove every assigned color. */
    function clearAllWorkspaceColors() {
      if (Object.keys(colors).length === 0) return;
      commitColors({});
    }

    /**
     * Publish one new color map. A color picker fires continuously while the
     * user drags, so nothing here may run synchronously per event: persistence
     * and the sidebar repaint are debounced, and the settings page updates at
     * most once per frame.
     * @param {Record<string, string>} next complete map.
     */
    function commitColors(next) {
      colors = Object.freeze(next);
      schedulePersist();
      scheduleRowPaint();
      scheduleNotify();
    }

    /** Write the current map to browser storage, coalescing rapid changes. */
    function schedulePersist() {
      if (persistTimer !== 0) window.clearTimeout(persistTimer);
      persistTimer = window.setTimeout(() => {
        persistTimer = 0;
        writeStoredColors();
      }, PERSIST_DELAY_MS);
    }

    /** @returns {boolean} whether the pending storage write was flushed now. */
    function flushPersist() {
      if (persistTimer === 0) return false;
      window.clearTimeout(persistTimer);
      persistTimer = 0;
      writeStoredColors();
      return true;
    }

    /** Persist the color map synchronously; storage failures stay non-fatal. */
    function writeStoredColors() {
      try {
        if (Object.keys(colors).length === 0) window.localStorage.removeItem(STORAGE_KEY);
        else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(colors));
      } catch {
        /* Storage may be unavailable; the colors still apply for this page. */
      }
    }

    /** Notify color subscribers at most once per frame. */
    function scheduleNotify() {
      if (notifyFrame !== 0) return;
      notifyFrame = window.requestAnimationFrame(() => {
        notifyFrame = 0;
        for (const listener of [...subscribers]) {
          try {
            listener();
          } catch (error) {
            console.error('workspace-colors subscriber crashed:', error);
          }
        }
      });
    }

    /**
     * Repaint the sidebar rows after the color settles. A picker emits many
     * changes per second, so a drag resolves to one repaint instead of one per
     * event.
     */
    function scheduleRowPaint() {
      if (!rowStylesMounted) return;
      if (rowPaintTimer !== 0) window.clearTimeout(rowPaintTimer);
      rowPaintTimer = window.setTimeout(() => {
        rowPaintTimer = 0;
        paintRowStyles();
      }, ROW_PAINT_DELAY_MS);
    }

    /** Cancel scheduled row work and notify the pending removal. */
    function cancelScheduledRowWork() {
      if (rowPaintTimer !== 0) {
        window.clearTimeout(rowPaintTimer);
        rowPaintTimer = 0;
      }
      if (notifyFrame !== 0) {
        window.cancelAnimationFrame(notifyFrame);
        notifyFrame = 0;
      }
    }

    //#endregion

    //#region row stylesheet

    /**
     * Insert or find one package-owned stylesheet.
     * @param {string} id stable stylesheet id.
     * @returns {HTMLStyleElement} the inserted or reused element.
     */
    function ensureStyleTag(id) {
      const selector = 'style[data-plugin-css=' + JSON.stringify(id) + ']';
      const existing = document.querySelector(selector);
      if (existing !== null) return /** @type {HTMLStyleElement} */ (existing);
      const tag = document.createElement('style');
      tag.dataset.plugin = '@local/dsh-workspace-colors';
      tag.dataset.pluginCss = id;
      document.head.appendChild(tag);
      return tag;
    }

    /**
     * Parse one #rrggbb color.
     * @param {string} hex color text.
     * @returns {[number, number, number] | null} channels, or null.
     */
    function parseHex(hex) {
      if (typeof hex !== 'string' || !COLOR_PATTERN.test(hex)) return null;
      const value = Number.parseInt(hex.slice(1), 16);
      return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
    }

    /**
     * Escape an attribute value for a double-quoted CSS attribute selector.
     * @param {string} value raw value.
     * @returns {string} escaped value.
     */
    function escapeAttribute(value) {
      return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    }

    /**
     * Build the rules that tint every colored workspace header row. This is the
     * fallback for a browser that exposes no CSSOM on the inserted element; the
     * live path edits declarations through CSSOM instead.
     * @param {Record<string, string>} map current color map.
     * @returns {string} stylesheet text.
     */
    function buildRowCss(map) {
      const rules = [];
      for (const workspaceId of Object.keys(map)) {
        const rgb = parseHex(map[workspaceId]);
        if (rgb === null) continue;
        const channels = rgb[0] + ', ' + rgb[1] + ', ' + rgb[2];
        const selector = rowSelector(workspaceId);
        rules.push(
          selector + '{background-color:rgba(' + channels + ', ' + String(ROW_TINT) + ');' +
            'border-inline-start-color:rgba(' + channels + ', ' + String(ROW_ACCENT) + ');}',
          selector + ' span[class*="folder"]{color:rgb(' + channels + ');}',
        );
      }
      return rules.join('\n');
    }

    /**
     * Selector for one workspace's sidebar header row.
     * @param {string} workspaceId workspace id.
     * @returns {string} CSS attribute selector.
     */
    function rowSelector(workspaceId) {
      return '[data-row-key="' + escapeAttribute('workspace:' + workspaceId) + '"]';
    }

    /**
     * Write one workspace's color into its live CSSOM rules. Only the affected
     * declarations change, so the page avoids the document-wide style
     * invalidation a full stylesheet replacement causes.
     * @param {{row: CSSStyleRule, folder: CSSStyleRule}} entry rule handles.
     * @param {string} hex accepted color.
     */
    function applyRuleColors(entry, hex) {
      const rgb = parseHex(hex);
      if (rgb === null) return;
      const channels = rgb[0] + ', ' + rgb[1] + ', ' + rgb[2];
      entry.row.style.setProperty('background-color', 'rgba(' + channels + ', ' + String(ROW_TINT) + ')');
      entry.row.style.setProperty('border-inline-start-color', 'rgba(' + channels + ', ' + String(ROW_ACCENT) + ')');
      entry.folder.style.setProperty('color', 'rgb(' + channels + ')');
    }

    /**
     * Rebuild the stylesheet rules for a new list of colored workspaces.
     * Structural changes are rare (a color is added or removed), unlike value
     * changes, which only rewrite declarations.
     * @param {CSSStyleSheet} sheet the package stylesheet.
     * @param {string[]} ids colored workspace ids in stylesheet order.
     */
    function rebuildRowRules(sheet, ids) {
      while (sheet.cssRules.length > 0) sheet.deleteRule(0);
      rowRuleIds = ids.slice();
      rowRules = [];
      for (const id of ids) {
        const selector = rowSelector(id);
        const rowIndex = sheet.insertRule(selector + '{}', sheet.cssRules.length);
        const rowRule = sheet.cssRules[rowIndex];
        const folderIndex = sheet.insertRule(selector + ' span[class*="folder"]{}', sheet.cssRules.length);
        const folderRule = sheet.cssRules[folderIndex];
        applyRuleColors({ row: rowRule, folder: folderRule }, colors[id]);
        rowRules.push({ row: rowRule, folder: folderRule });
      }
    }

    /** Refresh the mounted row stylesheet from the current color map. */
    function paintRowStyles() {
      if (!rowStylesMounted || rowStyleTag === null) return;
      const ids = Object.keys(colors).filter((id) => parseHex(colors[id]) !== null);
      const sheet = rowStyleTag.sheet;
      if (sheet === null) {
        rowStyleTag.textContent = buildRowCss(colors);
        return;
      }
      try {
        const sameIds = ids.length === rowRuleIds.length && ids.every((id, index) => id === rowRuleIds[index]);
        if (!sameIds) {
          rebuildRowRules(sheet, ids);
          return;
        }
        for (let index = 0; index < ids.length; index += 1) applyRuleColors(rowRules[index], colors[ids[index]]);
      } catch (error) {
        /* A selector the engine rejects falls back to one plain stylesheet write. */
        console.error('workspace-colors: row stylesheet rewrite failed:', error);
        rowRuleIds = [];
        rowRules = [];
        rowStyleTag.textContent = buildRowCss(colors);
      }
    }

    /** Mount the row stylesheet; called once from the plugin's apply. */
    function mountRowStyles() {
      if (rowStylesMounted) return;
      rowStylesMounted = true;
      rowStyleTag = ensureStyleTag(ROW_STYLE_ID);
      rowRuleIds = [];
      rowRules = [];
      paintRowStyles();
    }

    /** Remove the row stylesheet and flush pending color work. */
    function unmountRowStyles() {
      cancelScheduledRowWork();
      flushPersist();
      rowStylesMounted = false;
      rowRuleIds = [];
      rowRules = [];
      if (rowStyleTag !== null) rowStyleTag.remove();
      rowStyleTag = null;
      const stale = document.querySelector('style[data-plugin-css=' + JSON.stringify(ROW_STYLE_ID) + ']');
      if (stale !== null) stale.remove();
    }

    //#endregion

    //#region workspace list

    /** @type {readonly {id: string, title: string, path: string}[]} */
    const NO_WORKSPACES = Object.freeze([]);

    /**
     * Stable selector for the workspace snapshot's Workspace list.
     * @param {unknown} snapshot the workspaces snapshot.
     * @returns {unknown} the snapshot's own items array.
     */
    function selectWorkspaceItems(snapshot) {
      return snapshot === null || snapshot === undefined ? undefined : snapshot.items;
    }

    /**
     * Last path segment, used when a workspace has no title.
     * @param {unknown} path workspace path.
     * @returns {string} display fallback.
     */
    function pathTail(path) {
      if (typeof path !== 'string') return '';
      const trimmed = path.replace(/[\\/]+$/, '');
      const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
      return index >= 0 ? trimmed.slice(index + 1) : trimmed;
    }

    /**
     * Project workspace values to the plain rows the page needs.
     * @param {unknown} items snapshot items.
     * @returns {{id: string, title: string, path: string}[]} normalized rows.
     */
    function normalizeWorkspaceItems(items) {
      if (!Array.isArray(items)) return NO_WORKSPACES;
      const rows = [];
      for (const item of items) {
        if (item === null || typeof item !== 'object') continue;
        const id = typeof item.workspaceId === 'string' ? item.workspaceId
          : typeof item.id === 'string' ? item.id : '';
        if (id === '') continue;
        const path = typeof item.path === 'string' ? item.path : '';
        const title = typeof item.title === 'string' && item.title.trim() !== '' ? item.title : pathTail(path) || id;
        rows.push({ id, title, path });
      }
      return rows;
    }

    /**
     * Read the sidebar's rendered workspace rows when the snapshot hook is absent.
     * @returns {{id: string, title: string, path: string}[]} discovered rows.
     */
    function scanWorkspaceRows() {
      /** @type {{id: string, title: string, path: string}[]} */
      const rows = [];
      const seen = new Set();
      for (const element of document.querySelectorAll('[data-row-key^="workspace:"]')) {
        const key = element.getAttribute('data-row-key') ?? '';
        const id = key.slice('workspace:'.length);
        if (id === '' || seen.has(id)) continue;
        seen.add(id);
        const titleElement = element.querySelector('[class*="title"]');
        const title = titleElement !== null && typeof titleElement.textContent === 'string'
          ? titleElement.textContent.trim()
          : '';
        rows.push({ id, title: title !== '' ? title : id, path: '' });
      }
      return rows;
    }

    /**
     * Compare two discovered lists by identity fields.
     * @param {{id: string, title: string}[]} left previous rows.
     * @param {{id: string, title: string}[]} right next rows.
     * @returns {boolean} whether they describe the same list.
     */
    function sameWorkspaceRows(left, right) {
      if (left.length !== right.length) return false;
      for (let index = 0; index < left.length; index += 1) {
        if (left[index].id !== right[index].id || left[index].title !== right[index].title) return false;
      }
      return true;
    }

    //#endregion

    //#region components

    /** Controls stylesheet: only theme tokens, so light and dark both follow the host. */
    const UI_CSS = [
      '.wsc-root{padding-bottom:32px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column}',
      '.wsc-intro{margin:0 0 4px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
      '.wsc-item{border-bottom:.5px solid var(--dsw-alias-border-l2)}',
      '.wsc-row{display:flex;align-items:center;gap:16px;padding:16px 0}',
      '.wsc-info{flex:1;min-width:0}',
      '.wsc-name{font-size:14px;line-height:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.wsc-path{margin-top:2px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.wsc-swatch{position:relative;display:inline-flex;flex:none;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);cursor:pointer}',
      '.wsc-swatch:hover{border-color:var(--dsw-alias-label-secondary)}',
      '.wsc-swatch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.wsc-swatchFace{position:absolute;inset:2px;border-radius:6px;pointer-events:none}',
      '.wsc-swatchPlus{font-size:15px;line-height:1;color:var(--dsw-alias-label-secondary);pointer-events:none}',
      '.wsc-side{display:flex;align-items:center;gap:8px;flex:none}',
      '.wsc-action{border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;padding:3px 8px;cursor:pointer}',
      '.wsc-action:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}',
      '.wsc-action:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.wsc-unset{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);min-width:56px;text-align:end}',
      '.wsc-footer{display:flex;justify-content:flex-end;padding-top:16px}',
      '.wsc-empty{padding:16px 0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}',
      '.wsc-picker{display:flex;flex-direction:column;gap:10px;margin:0 0 14px;padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}',
      '.wsc-palette{display:grid;grid-template-columns:repeat(10,minmax(0,1fr));gap:6px}',
      '.wsc-chip{width:100%;aspect-ratio:1;padding:0;border:1px solid transparent;border-radius:6px;cursor:pointer}',
      '.wsc-chip:hover{outline:1px solid var(--dsw-alias-label-secondary);outline-offset:1px}',
      '.wsc-chip:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.wsc-chipSelected{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.wsc-custom{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.wsc-customLabel{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
      '.wsc-hex{width:110px;height:28px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;padding:0 8px}',
      '.wsc-hex:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.wsc-hexInvalid{border-color:var(--dsw-alias-state-error-primary)}',
      '.wsc-invalid{font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary)}',
    ].join('\n');

    /**
     * Fallback translator used only if the slot does not hand one over.
     * @param {string} key dictionary key.
     * @param {Record<string, unknown>} [params] interpolation values.
     * @returns {string} display text.
     */
    function fallbackTranslate(key, params) {
      const template = Object.prototype.hasOwnProperty.call(en, key) ? en[key] : key;
      if (params === undefined || params === null) return template;
      return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
    }

    /**
     * One palette chip.
     * @param {{hex: string, selected: boolean, label: string, onPick: Function}} props chip input.
     * @returns {import('react').ReactElement} the chip element.
     */
    function PaletteChip(props) {
      const { hex, selected, label, onPick } = props;
      return h('button', {
        type: 'button',
        className: 'wsc-chip' + (selected ? ' wsc-chipSelected' : ''),
        style: { background: hex },
        title: hex,
        'aria-label': label,
        'aria-pressed': selected ? 'true' : 'false',
        onClick: () => onPick(hex),
      });
    }

    /**
     * Inline palette plus custom hex input. It replaces a native color input so
     * no operating-system color dialog opens and no continuous input event
     * stream has to be absorbed.
     * @param {{color: string | undefined, t: Function, onPick: Function, onDismiss: Function}} props picker input.
     * @returns {import('react').ReactElement} the picker element.
     */
    function PalettePicker(props) {
      const { color, t, onPick, onDismiss } = props;
      const [draft, setDraft] = React.useState(color !== undefined ? color : '');
      const [invalid, setInvalid] = React.useState(false);
      const panel = React.useRef(null);

      React.useEffect(() => {
        const onPointerDown = (event) => {
          const element = panel.current;
          if (element === null || !(event.target instanceof Node)) return;
          const item = element.parentElement;
          if (element.contains(event.target)) return;
          if (item !== null && item.contains(event.target)) return;
          onDismiss();
        };
        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return;
          event.stopPropagation();
          onDismiss();
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('keydown', onKeyDown, true);
        return () => {
          document.removeEventListener('pointerdown', onPointerDown, true);
          document.removeEventListener('keydown', onKeyDown, true);
        };
      }, [onDismiss]);

      const submit = () => {
        const text = draft.trim().replace(/^#/, '').toLowerCase();
        if (!/^[0-9a-f]{6}$/.test(text)) {
          setInvalid(true);
          return;
        }
        setInvalid(false);
        onPick('#' + text);
      };

      return h('div', { className: 'wsc-picker', ref: panel, role: 'group', 'aria-label': t('palette') },
        h('div', { className: 'wsc-palette' },
          PALETTE.map((hex) => h(PaletteChip, {
            key: hex,
            hex,
            selected: color === hex,
            label: hex,
            onPick,
          })),
        ),
        h('div', { className: 'wsc-custom' },
          h('span', { className: 'wsc-customLabel' }, t('custom')),
          h('input', {
            className: 'wsc-hex' + (invalid ? ' wsc-hexInvalid' : ''),
            type: 'text',
            inputMode: 'text',
            spellCheck: false,
            autoComplete: 'off',
            value: draft,
            placeholder: '#3b82f6',
            'aria-label': t('custom'),
            'aria-invalid': invalid ? 'true' : undefined,
            onChange: (event) => {
              setDraft(event.target.value);
              if (invalid) setInvalid(false);
            },
            onKeyDown: (event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              submit();
            },
          }),
          h('button', { type: 'button', className: 'wsc-action', onClick: submit }, t('apply')),
          invalid ? h('span', { className: 'wsc-invalid', role: 'alert' }, t('invalid')) : null,
        ),
      );
    }

    /**
     * Render one workspace color row and, while it is open, its inline picker.
     * @param {{row: {id: string, title: string, path: string}, color: string | undefined, t: Function, open: boolean, onToggle: Function, onPick: Function, onDismiss: Function}} props row input.
     * @returns {import('react').ReactElement} the row element.
     */
    function WorkspaceColorRow(props) {
      const { row, color, t, open, onToggle, onPick, onDismiss } = props;
      const pickerLabel = t('picker', { name: row.title });
      return h('div', { className: 'wsc-item' },
        h('div', { className: 'wsc-row' },
          h('div', { className: 'wsc-info' },
            h('div', { className: 'wsc-name', title: row.path !== '' ? row.path : row.title }, row.title),
            row.path !== '' ? h('div', { className: 'wsc-path', title: row.path }, row.path) : null,
          ),
          h('button', {
            type: 'button',
            className: 'wsc-swatch',
            title: pickerLabel,
            'aria-label': pickerLabel,
            'aria-expanded': open ? 'true' : 'false',
            onClick: () => onToggle(row.id),
          },
          color !== undefined
            ? h('span', { className: 'wsc-swatchFace', 'aria-hidden': 'true', style: { background: color } })
            : h('span', { className: 'wsc-swatchPlus', 'aria-hidden': 'true' }, '+'),
          ),
          h('div', { className: 'wsc-side' },
            color !== undefined
              ? h('button', {
                type: 'button',
                className: 'wsc-action',
                onClick: () => onPick(row.id, undefined),
              }, t('reset'))
              : h('span', { className: 'wsc-unset' }, t('unset')),
          ),
        ),
        open ? h(PalettePicker, {
          color,
          t,
          onPick: (hex) => onPick(row.id, hex),
          onDismiss,
        }) : null,
      );
    }

    /** Memoized row: a color change re-renders only the row whose color changed. */
    const WorkspaceColorRowMemo = React.memo(WorkspaceColorRow);

    /**
     * Section body: rows plus the reset-all action.
     * @param {{t: Function, colors: Record<string, string>, items: unknown}} props section props.
     * @returns {import('react').ReactElement} the section element.
     */
    function WorkspaceColorsBody(props) {
      const { t, colors, items } = props;
      const snapshotRows = React.useMemo(() => normalizeWorkspaceItems(items), [items]);
      const needsFallback = snapshotRows.length === 0;
      const [scanned, setScanned] = React.useState(scanWorkspaceRows);
      const [openId, setOpenId] = React.useState(null);
      const toggleRow = React.useCallback((id) => {
        setOpenId((previous) => (previous === id ? null : id));
      }, []);
      const pickColor = React.useCallback((id, hex) => {
        if (typeof hex === 'string') setWorkspaceColor(id, hex);
        else clearWorkspaceColor(id);
        setOpenId(null);
      }, []);
      const dismissPicker = React.useCallback(() => {
        setOpenId(null);
      }, []);

      React.useEffect(() => {
        if (!needsFallback) return undefined;
        let live = true;
        const refresh = () => {
          if (!live || document.visibilityState === 'hidden') return;
          setScanned((previous) => {
            const next = scanWorkspaceRows();
            return sameWorkspaceRows(previous, next) ? previous : next;
          });
        };
        refresh();
        const timer = window.setInterval(refresh, 1200);
        return () => {
          live = false;
          window.clearInterval(timer);
        };
      }, [needsFallback]);

      /* Prefer the snapshot; before it loads, or if its shape ever changes, the
         rendered sidebar rows still list every workspace the browser shows. */
      const rows = needsFallback ? scanned : snapshotRows;
      const assigned = Object.keys(colors).length;

      return h('div', { className: 'wsc-root' },
        h('p', { className: 'wsc-intro' }, t('intro')),
        rows.length === 0
          ? h('div', { className: 'wsc-empty' }, t('empty'))
          : rows.map((row) => h(WorkspaceColorRowMemo, {
            key: row.id,
            row,
            color: colors[row.id],
            t,
            open: openId === row.id,
            onToggle: toggleRow,
            onPick: pickColor,
            onDismiss: dismissPicker,
          })),
        assigned > 0
          ? h('div', { className: 'wsc-footer' },
            h('button', {
              type: 'button',
              className: 'wsc-action',
              onClick: () => clearAllWorkspaceColors(),
            }, t('clearAll')),
          )
          : null,
      );
    }

    /**
     * The settings section; standard slot props carry the workspace snapshot hook.
     * @param {Record<string, unknown>} props composed slot props.
     * @returns {import('react').ReactElement} the section element.
     */
    function WorkspaceColorsSection(props) {
      const t = typeof props.t === 'function' ? props.t : fallbackTranslate;
      const colorsNow = React.useSyncExternalStore(subscribeColors, getColors);
      const workspaceHook = typeof props.useWorkspaces === 'function' ? props.useWorkspaces : null;
      const items = workspaceHook === null ? undefined : workspaceHook(selectWorkspaceItems);
      return h(WorkspaceColorsBody, { t, colors: colorsNow, items });
    }

    /** @param {{size?: number}} props nav icon geometry. */
    function WorkspaceColorsIcon(props) {
      const size = typeof props.size === 'number' ? props.size : 16;
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        fill: 'none',
        'aria-hidden': 'true',
        focusable: 'false',
      },
      h('path', {
        d: 'M8 1.75a6.25 6.25 0 1 0 0 12.5c.9 0 1.4-.62 1.4-1.32 0-.6-.32-.92-.32-1.5 0-.66.54-1.2 1.2-1.2h1.02c1.5 0 2.55-1.05 2.55-2.55A5.93 5.93 0 0 0 8 1.75Z',
        stroke: 'currentColor',
        strokeWidth: '1.2',
        strokeLinejoin: 'round',
      }),
      h('circle', { cx: '5.15', cy: '7.2', r: '1', fill: 'currentColor' }),
      h('circle', { cx: '7.3', cy: '4.7', r: '1', fill: 'currentColor' }),
      h('circle', { cx: '9.9', cy: '5.4', r: '1', fill: 'currentColor' }));
    }

    //#endregion

    //#region plugin

    /** Services the browser half needs. */
    const inject = ['slots', 'locale'];

    /**
     * Mount the row stylesheet, the settings page, and its navigation icon.
     * @param {import('@deepseek-ai/cordis').Context} ctx browser plugin context.
     */
    function apply(ctx) {
      const t = ctx.locale.bind(NS);
      ctx.effect(() => ctx.locale.register(NS, { en, fa }), 'workspace-colors: dictionaries');
      ctx.effect(() => {
        const uiStyleTag = ensureStyleTag(UI_STYLE_ID);
        uiStyleTag.textContent = UI_CSS;
        mountRowStyles();
        return () => {
          unmountRowStyles();
          uiStyleTag.remove();
        };
      }, 'workspace-colors: stylesheets');
      ctx.effect(() => {
        const flush = () => {
          flushPersist();
        };
        window.addEventListener('pagehide', flush);
        return () => window.removeEventListener('pagehide', flush);
      }, 'workspace-colors: flush pending colors');
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'workspace-colors',
        order: 17,
        label: () => t('section'),
        locale: NS,
      }, WorkspaceColorsSection));
      ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
        name: 'settings.section.icon',
        id: 'workspace-colors',
        order: 17,
        locale: NS,
      }, WorkspaceColorsIcon));
    }

    //#endregion

    return { inject, apply };
  },
});
