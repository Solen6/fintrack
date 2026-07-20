/* Shared types + pure helpers for custom heatmap-view sectors.
   A view's `groups` is a shallow tree (max 2 levels):
     · a LEAF group holds holdings directly (`ids`, no `children`)
     · a BRANCH group holds sub-sectors (`children`), and any `ids` on the
       branch itself are "loose" holdings not yet filed into a sub-sector.
   Deeper nesting is not supported — a sub-sector is always a leaf. */

export interface HeatmapGroup {
  name: string;               // "" = unnamed (renders flat / no label at top level)
  ids: string[];              // holdings directly in this node, in display order
  children?: HeatmapGroup[];  // sub-sectors (one level deep); present ⇒ branch
}

/** Every holding id anywhere in the tree, in reading order (loose ids of a
 *  branch come before its sub-sectors). Used to keep the flat `ordering` in
 *  sync as a fallback. */
export function flattenGroupIds(groups: HeatmapGroup[]): string[] {
  const out: string[] = [];
  for (const g of groups) {
    out.push(...g.ids);
    if (g.children) for (const c of g.children) out.push(...c.ids);
  }
  return out;
}

/** Coerce arbitrary JSON into a clean 2-level HeatmapGroup[] (children beyond
 *  depth 1 are flattened away). */
export function coerceGroups(raw: unknown, depth = 0): HeatmapGroup[] {
  if (!Array.isArray(raw)) return [];
  const out: HeatmapGroup[] = [];
  for (const g of raw) {
    if (g && typeof g === "object" && !Array.isArray(g)) {
      const name = typeof (g as { name?: unknown }).name === "string" ? (g as { name: string }).name : "";
      const idsRaw = (g as { ids?: unknown }).ids;
      const ids = Array.isArray(idsRaw) ? idsRaw.filter((v): v is string => typeof v === "string") : [];
      const node: HeatmapGroup = { name, ids };
      if (depth === 0) {
        const kids = coerceGroups((g as { children?: unknown }).children, depth + 1);
        if (kids.length) node.children = kids;
      }
      out.push(node);
    }
  }
  return out;
}

/** Drop empty leaves/sub-sectors after an edit; never return fewer than one
 *  top-level group. A branch left with no sub-sectors collapses to a leaf. */
export function pruneGroups(groups: HeatmapGroup[]): HeatmapGroup[] {
  const tops: HeatmapGroup[] = [];
  for (const g of groups) {
    if (g.children?.length) {
      const kids = g.children.filter((c) => c.ids.length > 0);
      if (kids.length) tops.push({ name: g.name, ids: g.ids, children: kids });
      else if (g.ids.length) tops.push({ name: g.name, ids: g.ids }); // collapse to leaf
    } else if (g.ids.length) {
      tops.push({ name: g.name, ids: g.ids });
    }
  }
  return tops.length ? tops : groups;
}
